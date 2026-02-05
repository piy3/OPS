/**
 * Game State Management Service - Facade
 * 
 * Thin coordination layer that delegates to domain-specific managers:
 * - PositionManager: Player positions, validation, spawn logic
 * - CombatManager: Combat, health, i-frames, knockback
 * - CoinManager: Coin spawning and collection
 * - PowerupManager: Powerup spawning, collection, activation
 * - QuizManager: Tag quiz handling
 * - GameLoopManager: Game phases, blitz quiz, hunt timing
 * 
 * Keeps the same public API for backward compatibility with handlers.
 */

import roomManager from './RoomManager.js';
import quizizzService from './QuizizzService.js';
import { SOCKET_EVENTS, GAME_PHASE, GAME_LOOP_CONFIG, COMBAT_CONFIG, PLAYER_STATE, UNFREEZE_QUIZ_CONFIG, ROOM_STATUS } from '../config/constants.js';
import { getRandomQuestions } from '../config/questions.js';
import log from '../utils/logger.js';

// Import domain managers
import positionManager from './managers/PositionManager.js';
import combatManager from './managers/CombatManager.js';
import coinManager from './managers/CoinManager.js';
import powerupManager from './managers/PowerupManager.js';
import quizManager from './managers/QuizManager.js';
import gameLoopManager from './managers/GameLoopManager.js';
import sinkholeManager from './managers/SinkholeManager.js';
import sinkTrapManager from './managers/SinkTrapManager.js';
import RoomManager from './RoomManager.js';

class GameStateManager {
    constructor() {
        // Bind methods for callbacks
        this._onBlitzEnd = this._onBlitzEnd.bind(this);
        this._onStartHunt = this._onStartHunt.bind(this);
        this._onQuizComplete = this._onQuizComplete.bind(this);
        
        // Unfreeze quiz state: Map<roomCode, Map<playerId, { questions, answers, startTime }>>
        this.unfreezeQuizzes = new Map();
    }

    // ==================== PUBLIC API (called by handlers) ====================

    /**
     * Get current game phase for a room
     */
    getGamePhase(roomCode) {
        return gameLoopManager.getGamePhase(roomCode);
    }

    /**
     * Initialize game state for a room and assign spawn positions
     */
    initializeRoom(roomCode) {
        positionManager.initializeRoom(roomCode);
        
        const room = roomManager.getRoom(roomCode);
        if (room?.players) {
            // Pass mapConfig for dynamic spawn positions based on player count
            positionManager.assignSpawnPositions(roomCode, room.players, room.mapConfig);
        }
    }

    /**
     * Clean up game state for a room
     */
    cleanupRoom(roomCode) {
        const room = roomManager.getRoom(roomCode);
        if (room) room.quizQuestionPool = null;

        positionManager.cleanupRoom(roomCode);
        // Clean up combat state for each player
        if (room?.players) {
            room.players.forEach(player => {
                combatManager.cleanupPlayer(player.id);
            });
        }
        coinManager.cleanupRoom(roomCode);
        powerupManager.cleanupRoom(roomCode);
        quizManager.clearQuizState(roomCode);
        gameLoopManager.cleanupRoom(roomCode);
        sinkholeManager.cleanupRoom(roomCode);
        sinkTrapManager.cleanupRoom(roomCode);
        // Clean up unfreeze quiz state
        this.unfreezeQuizzes.delete(roomCode);
    }

    /**
     * Clear quiz state for a room
     */
    clearQuizState(roomCode) {
        quizManager.clearQuizState(roomCode);
    }

    /**
     * Get full game state for synchronization
     * Includes player states (frozen/active) and unfreeze quiz data for reconnection recovery
     */
    getGameState(roomCode) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return null;

        // Get frozen players and their quiz data for reconnection recovery
        const roomQuizzes = this.unfreezeQuizzes.get(roomCode);
        const frozenPlayers = [];
        
        room.players.forEach(player => {
            if (player.state === PLAYER_STATE.FROZEN) {
                const quizState = roomQuizzes?.get(player.id);
                frozenPlayers.push({
                    playerId: player.id,
                    hasActiveQuiz: !!quizState,
                    // Don't include full quiz data here - client will request via REQUEST_UNFREEZE_QUIZ
                });
            }
        });

        return {
            roomCode: roomCode,
            players: room.players.map(player => ({
                id: player.id,
                name: player.name,
                isUnicorn: player.isUnicorn,
                coins: player.coins,
                characterId: player.characterId, // Include character ID for avatar rendering
                state: player.state || PLAYER_STATE.ACTIVE, // Include player state for frozen detection
                position: positionManager.getPlayerPosition(roomCode, player.id)
            })),
            unicornIds: room.unicornIds ?? (room.unicornId ? [room.unicornId] : []),
            unicornId: room.unicornIds?.[0] ?? room.unicornId ?? null,
            leaderboard: roomManager.getLeaderboard(roomCode),
            sinkholes: sinkholeManager.getActiveSinkholes(roomCode),
            sinkTraps: sinkTrapManager.getActiveCollectibles(roomCode),
            deployedSinkTraps: sinkTrapManager.getDeployedTraps(roomCode),
            frozenPlayers: frozenPlayers, // Include frozen players info for reconnection
            timestamp: Date.now()
        };
    }

    /**
     * Start the game loop for a room
     */
    async startGameLoop(roomCode, io) {
        // Initialize round tracking for this game
        gameLoopManager.initRoomRounds(roomCode);

        await gameLoopManager.startGameLoop(roomCode, io, (code) => {
            quizManager.freezeRoom(code);
        });

        const room = roomManager.getRoom(roomCode);
        if (room) {
            gameLoopManager.sendBlitzQuiz(
                roomCode,
                room.players.length,
                io,
                this._onBlitzEnd
            );
        }
    }

    /**
     * Submit a Blitz Quiz answer
     */
    submitBlitzAnswer(roomCode, playerId, answerIndex, io) {
        return gameLoopManager.submitBlitzAnswer(
            roomCode, 
            playerId, 
            answerIndex, 
            io,
            this._onBlitzEnd
        );
    }

    /**
     * Submit a quiz answer (tag quiz)
     */
    submitQuizAnswer(roomCode, playerId, questionId, answerIndex) {
        return quizManager.submitAnswer(roomCode, playerId, questionId, answerIndex);
    }

    /**
     * Complete the quiz
     */
    completeQuiz(roomCode, io, isTimeout = false) {
        quizManager.completeQuiz(roomCode, io, isTimeout, this._onQuizComplete);
    }

    /**
     * Update player position with validation and collision handling
     * 
     * OPTIMIZATION: Early throttle check prevents unnecessary work.
     * Order of checks (fastest rejection first):
     * 1. Throttle check - O(1) map lookup, no room data needed
     * 2. Room frozen check - O(1) set lookup
     * 3. Room/player lookup - More expensive
     * 4. Combat state check - Requires player data
     * 5. Position update and collision detection - Heavy work
     */
    updatePlayerPosition(roomCode, playerId, positionData, io = null) {
        // EARLY EXIT: Check throttle FIRST before any heavy work
        // Catches burst/duplicate updates without doing expensive room/collision work
        if (positionManager.isThrottled(playerId)) {
            return null;
        }

        // Check if room is frozen (cheap set lookup)
        if (quizManager.isRoomFrozen(roomCode)) {
            return null;
        }

        // Now do the heavier room/player lookup
        const room = roomManager.getRoom(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return null;
        
        // Check if player can move (not frozen from combat)
        if (!combatManager.canPlayerMove(player, playerId)) {
            return null;
        }

        // Get old position for path collision detection
        const oldPosition = positionManager.getPlayerPosition(roomCode, playerId);

        // Update position (throttle already checked, so this should succeed)
        const isUnicorn = player.isUnicorn;
        const updatedPosition = positionManager.updatePosition(
            roomCode, 
            playerId, 
            positionData, 
            isUnicorn
        );

        if (!updatedPosition) return null;

        // Only process collisions during HUNT phase
        if (io && gameLoopManager.getGamePhase(roomCode) === GAME_PHASE.HUNT) {
            const validatedPosition = { row: updatedPosition.row, col: updatedPosition.col };
            
            // Check coin collection (survivors only)
            if (!isUnicorn) {
                this._checkCoinCollection(roomCode, playerId, validatedPosition, io);
                this._checkPowerupCollection(roomCode, playerId, validatedPosition, io);
            }

            // Check tag collision
            this._checkTagCollision(roomCode, playerId, oldPosition, validatedPosition, isUnicorn, io);

            // Check if any unicorn stepped on a sink trap (moving player's position + all other unicorns' positions)
            const unicornIds = room.unicornIds ?? (room.unicornId ? [room.unicornId] : []);
            for (const uid of unicornIds) {
                const pos = uid === playerId
                    ? { row: updatedPosition.row, col: updatedPosition.col }
                    : positionManager.getPlayerPosition(roomCode, uid);
                if (!pos) continue;
                const triggeredTrapId = sinkTrapManager.checkTrapTrigger(roomCode, { row: pos.row, col: pos.col });
                if (triggeredTrapId) {
                    const uPlayer = room.players.find(p => p.id === uid);
                    // Teleport unicorn to a valid road with no other players (same as respawn)
                    const destinationPosition = positionManager.findFreeSpawnPosition(roomCode, uid, room.players, room.mapConfig);
                    sinkTrapManager.triggerTrap(
                        roomCode, triggeredTrapId, uid, uPlayer?.name || 'Unicorn', io,
                        (code, id, position) => positionManager.setPlayerPosition(code, id, position),
                        destinationPosition
                    );
                    break;
                }
            }
        }

        return updatedPosition;
    }

    /**
     * Get player position
     */
    getPlayerPosition(roomCode, playerId) {
        return positionManager.getPlayerPosition(roomCode, playerId);
    }

    /**
     * Get all room positions
     */
    getRoomPositions(roomCode) {
        return positionManager.getRoomPositions(roomCode);
    }

    /**
     * Remove player position (when they leave/disconnect)
     */
    removePlayerPosition(roomCode, playerId) {
        positionManager.removePlayerPosition(roomCode, playerId);
        combatManager.cleanupPlayer(playerId);
        powerupManager.cleanupPlayerImmunity(playerId);
        this.cleanupUnfreezeQuiz(roomCode, playerId);
    }

    /**
     * Clear all positions for a room
     */
    clearRoomState(roomCode) {
        positionManager.cleanupRoom(roomCode);
        gameLoopManager.cleanupRoom(roomCode);
        coinManager.cleanupRoom(roomCode);
        powerupManager.cleanupRoom(roomCode);
    }

    /**
     * Called when a unicorn left during active game (handler calls after removePlayerFromRoom).
     * Syncs clients via UNICORN_TRANSFERRED or triggers new blitz if zero unicorns remain.
     */
    checkAndHandleUnicornLeave(roomCode, playerId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return false;

        gameLoopManager.handleUnicornDisconnect(
            roomCode,
            playerId,
            io,
            (code) => roomManager.getRoom(code),
            (code, socket) => {
                coinManager.cleanupRoom(code);
                powerupManager.cleanupRoom(code);
                setTimeout(() => {
                    this._startNewBlitz(code, socket);
                }, 2000);
            }
        );
        return true;
    }

    /**
     * Get active quiz for a room
     */
    getActiveQuiz(roomCode) {
        return quizManager.getActiveQuiz(roomCode);
    }

    /**
     * Check if room has active quiz
     */
    hasActiveQuiz(roomCode) {
        return quizManager.hasActiveQuiz(roomCode);
    }

    /**
     * Get active coins in a room
     */
    getActiveCoins(roomCode) {
        return coinManager.getActiveCoins(roomCode);
    }

    /**
     * Get active powerups in a room
     */
    getActivePowerups(roomCode) {
        return powerupManager.getActivePowerups(roomCode);
    }

    /**
     * Get active sinkholes in a room
     */
    getActiveSinkholes(roomCode) {
        return sinkholeManager.getActiveSinkholes(roomCode);
    }

    /**
     * Enter a sinkhole to teleport to another sinkhole
     */
    enterSinkhole(roomCode, playerId, playerName, sinkholeId, io) {
        return sinkholeManager.enterSinkhole(
            roomCode, playerId, playerName, sinkholeId, io,
            (code, id, position) => positionManager.setPlayerPosition(code, id, position)
        );
    }

    /**
     * Collect a sink trap item
     */
    collectSinkTrap(roomCode, playerId, playerName, trapId, io) {
        return sinkTrapManager.collectTrap(roomCode, playerId, trapId, playerName, io);
    }

    /**
     * Deploy a sink trap
     */
    deploySinkTrap(roomCode, playerId, playerName, position, io) {
        return sinkTrapManager.deployTrap(roomCode, playerId, playerName, position, io);
    }

    /**
     * Get player's sink trap inventory count
     */
    getSinkTrapInventory(roomCode, playerId) {
        return sinkTrapManager.getPlayerInventory(roomCode, playerId);
    }

    // ==================== INTERNAL CALLBACKS ====================

    /**
     * Callback when blitz quiz ends
     */
    _onBlitzEnd(roomCode, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== 'playing') return;

        gameLoopManager.endBlitzQuiz(
            roomCode,
            room,
            io,
            (code, newUnicornIds) => roomManager.setUnicorns(code, newUnicornIds),
            (code, id, amount) => roomManager.updatePlayerCoins(code, id, amount),
            this._onStartHunt
        );
    }

    /**
     * Callback when hunt phase should start
     */
    _onStartHunt(roomCode, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== 'playing') return;

        // Reset player health for new round
        roomManager.resetPlayersHealth(roomCode);
        
        // Clean up combat states
        room.players.forEach(player => {
            combatManager.cleanupPlayer(player.id);
        });

        gameLoopManager.startHuntPhase(
            roomCode,
            room,
            io,
            (code) => quizManager.unfreezeRoom(code),
            (code, socket) => {
                // Pass mapConfig to managers so they filter spawn slots by map size
                const mapConfig = room.mapConfig;
                coinManager.initializeCoins(code, socket, mapConfig);
                powerupManager.startSpawning(code, socket, (c) => gameLoopManager.getGamePhase(c), mapConfig);
                sinkholeManager.initializeSinkholes(code, socket, mapConfig);
                sinkTrapManager.initializeSinkTraps(code, socket, mapConfig);
            },
            (code, socket) => this._startNewBlitz(code, socket)
        );
    }

    /**
     * Start a new blitz quiz
     * First checks if game should end (all rounds completed), then cancels unfreeze quizzes
     */
    async _startNewBlitz(roomCode, io) {
        // Decrement round counter and check if game should end
        const roundsRemaining = gameLoopManager.decrementRound(roomCode);
        
        if (roundsRemaining === 0) {
            // All rounds completed - end the game
            log.info(`🏁 Room ${roomCode}: All rounds complete, ending game`);
            this._endGame(roomCode, io);
            return;
        }
        
        // Cancel all unfreeze quizzes - those players respawn and join blitz
        this._cancelAllUnfreezeQuizzes(roomCode, io);

        await gameLoopManager.startBlitzQuiz(roomCode, io, (code) => {
            quizManager.freezeRoom(code);
        });

        const room = roomManager.getRoom(roomCode);
        if (room) {
            gameLoopManager.sendBlitzQuiz(
                roomCode,
                room.players.length,
                io,
                this._onBlitzEnd
            );
        }
    }

    /**
     * End the game - called when all rounds are completed
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     */
    _endGame(roomCode, io) {
        log.info(`🏆 Room ${roomCode}: === GAME ENDING ===`);
        
        // 1. Stop all timers for this room
        gameLoopManager.clearGameLoopTimers(roomCode);
        
        // 2. Get round data before cleanup
        const roundData = gameLoopManager.getRoomRounds(roomCode);
        const totalRounds = roundData?.totalRounds || GAME_LOOP_CONFIG.TOTAL_GAME_ROUNDS;
        
        // 3. Get the room and set status to finished
        const room = roomManager.getRoom(roomCode);
        if (room) {
            roomManager.setRoomStatus(roomCode, ROOM_STATUS.FINISHED);
        }
        
        // 4. Build final leaderboard
        const leaderboard = roomManager.getLeaderboard(roomCode);
        
        log.info(`🏆 Room ${roomCode}: Final leaderboard:`, leaderboard.map(p => `${p.name}: ${p.coins}`).join(', '));
        
        // 5. Set phase to GAME_END
        gameLoopManager.setGamePhase(roomCode, GAME_PHASE.GAME_END, io);
        
        // 6. Emit game end event to all players
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_END, {
            roomCode,
            leaderboard,
            totalRounds,
            message: `Game over after ${totalRounds} rounds!`
        });
        
        log.info(`🏆 Room ${roomCode}: Game end event emitted`);
        
        // 7. Clean up ALL manager state including spawners
        positionManager.cleanupRoom(roomCode);
        if (room?.players) {
            room.players.forEach(player => {
                combatManager.cleanupPlayer(player.id);
            });
        }
        coinManager.cleanupRoom(roomCode);
        powerupManager.cleanupRoom(roomCode);
        quizManager.clearQuizState(roomCode);
        gameLoopManager.cleanupRoom(roomCode);
        sinkholeManager.cleanupRoom(roomCode);
        sinkTrapManager.cleanupRoom(roomCode);
        this.unfreezeQuizzes.delete(roomCode);
        
        log.info(`🏆 Room ${roomCode}: === GAME ENDED ===`);
        
        // 8. Schedule room deletion after a delay (give clients time to see results)
        // After 30 seconds, the room will be deleted
        setTimeout(() => {
            this._deleteRoomAfterGameEnd(roomCode, io);
        }, 30000);
    }

    /**
     * Delete room after game has ended (called after delay)
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     */
    _deleteRoomAfterGameEnd(roomCode, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
            log.info(`🗑️ Room ${roomCode}: Already deleted`);
            return;
        }

        // Only delete if game is finished (not restarted)
        if (room.status !== ROOM_STATUS.FINISHED) {
            log.info(`🗑️ Room ${roomCode}: Status changed from FINISHED, not deleting`);
            return;
        }

        log.info(`🗑️ Room ${roomCode}: Deleting room and removing all players`);

        // Notify all players that they're being kicked (room closing)
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.ROOM_LEFT, {
            roomCode: roomCode,
            reason: 'game_ended',
            message: 'Game has ended. Room is closing.'
        });

        // Make all sockets leave the room
        const socketsInRoom = io.sockets.adapter.rooms.get(roomCode);
        if (socketsInRoom) {
            for (const socketId of socketsInRoom) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.leave(roomCode);
                }
            }
        }

        // Delete the room from RoomManager
        roomManager.deleteRoom(roomCode);
        
        log.info(`🗑️ Room ${roomCode}: Room deleted successfully`);
    }

    /**
     * Callback when tag quiz completes
     */
    _onQuizComplete(results) {
        const { roomCode, caughtPlayerWins, caughtId, unicornId, scorePercentage, isTimeout } = results;
        
        if (caughtPlayerWins) {
            roomManager.updatePlayerCoins(roomCode, caughtId, 20);
            roomManager.updatePlayerCoins(roomCode, unicornId, -20);
            const room = roomManager.getRoom(roomCode);
            const currentIds = room?.unicornIds ?? (room?.unicornId ? [room.unicornId] : []);
            const newSet = [...currentIds.filter(id => id !== unicornId), caughtId];
            roomManager.setUnicorns(roomCode, newSet);
            // Emit so frontend updates unicorn set
            const io = results.io;
            if (io) {
                const updatedRoom = roomManager.getRoom(roomCode);
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                    newUnicornIds: updatedRoom?.unicornIds ?? newSet,
                    newUnicornId: (updatedRoom?.unicornIds ?? newSet)[0] ?? null,
                    reason: 'tag_quiz_caught_wins',
                    room: updatedRoom
                });
            }
        } else {
            roomManager.updatePlayerCoins(roomCode, unicornId, 20);
            roomManager.updatePlayerCoins(roomCode, caughtId, -20);
        }
    }

    // ==================== INTERNAL COLLISION HANDLING ====================

    /**
     * Check for tag collision between players (multiple unicorns: any unicorn can tag any survivor)
     */
    _checkTagCollision(roomCode, playerId, oldPosition, newPosition, isUnicorn, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        const unicornIds = room.unicornIds ?? (room.unicornId ? [room.unicornId] : []);
        if (unicornIds.length === 0) return;

        const oldPos = oldPosition || newPosition;
        const pathCells = positionManager.getCellsInPath(oldPos, newPosition);

        if (!isUnicorn) {
            for (const uid of unicornIds) {
                const unicornPos = positionManager.getPlayerPosition(roomCode, uid);
                if (!unicornPos) continue;
                const crossed = pathCells.some(cell =>
                    cell.row === unicornPos.row && cell.col === unicornPos.col
                ) || (newPosition.row === unicornPos.row && newPosition.col === unicornPos.col);
                if (crossed) {
                    this._handleTag(roomCode, uid, playerId, io);
                    return;
                }
            }
        } else {
            const caughtPlayer = room.players.find(p => {
                if (p.id === playerId || p.isUnicorn) return false;
                const playerPos = positionManager.getPlayerPosition(roomCode, p.id);
                if (!playerPos) return false;
                const crossedPlayer = pathCells.some(cell =>
                    cell.row === playerPos.row && cell.col === playerPos.col
                );
                return crossedPlayer ||
                    (playerPos.row === newPosition.row && playerPos.col === newPosition.col);
            });
            if (caughtPlayer) {
                this._handleTag(roomCode, playerId, caughtPlayer.id, io);
            }
        }
    }

    /**
     * Handle unicorn tagging a survivor
     * Uses freeze + unfreeze quiz mode (player is frozen and must answer quiz to respawn)
     */
    _handleTag(roomCode, unicornId, survivorId, io) {
        const room = roomManager.getRoom(roomCode);
        const unicornIds = room?.unicornIds ?? (room?.unicornId ? [room.unicornId] : []);
        if (!room || !unicornIds.includes(unicornId)) return;

        // Rate limit collision
        if (!combatManager.shouldProcessCollision(unicornId, survivorId)) {
            return;
        }

        const unicornPlayer = room.players.find(p => p.id === unicornId);
        const survivorPlayer = room.players.find(p => p.id === survivorId);
        if (!unicornPlayer || !survivorPlayer) return;

        // Check if survivor can be hit (not already frozen, not immune, not in i-frames)
        const hitCheck = combatManager.canHitPlayer(survivorPlayer, survivorId);
        if (!hitCheck.canHit) {
            log.debug(`Cannot tag ${survivorPlayer.name}: ${hitCheck.reason}`);
            return;
        }

        // FREEZE + UNFREEZE QUIZ MODE
        // Award points to unicorn
        roomManager.updatePlayerCoins(roomCode, unicornId, GAME_LOOP_CONFIG.TAG_SCORE_STEAL);
        
        // Handle freeze and start unfreeze quiz
        this._handleZeroHealth(roomCode, survivorId, survivorPlayer.name, io);

        const updatedUnicorn = roomManager.getPlayer(roomCode, unicornId);

        // Emit tagged event for visual feedback
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_TAGGED, {
            unicornId: unicornId,
            unicornName: unicornPlayer.name,
            caughtId: survivorId,
            caughtName: survivorPlayer.name,
            coinsGained: GAME_LOOP_CONFIG.TAG_SCORE_STEAL,
            timestamp: Date.now()
        });

        // Update leaderboard
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SCORE_UPDATE, {
            unicornId: unicornId,
            caughtId: survivorId,
            unicornCoins: updatedUnicorn?.coins || 0,
            caughtCoins: survivorPlayer.coins || 0,
            room: roomManager.getRoom(roomCode),
            leaderboard: roomManager.getLeaderboard(roomCode)
        });

        log.info(`🧊 Player ${survivorPlayer.name} was frozen by ${unicornPlayer.name} in room ${roomCode}`);
    }

    /**
     * Handle player reaching zero health
     * Freezes the player and starts a personal unfreeze quiz
     */
    _handleZeroHealth(roomCode, playerId, playerName, io) {
        // Freeze the player (no respawn timer - quiz handles unfreeze)
        combatManager.handleZeroHealth(
            roomCode,
            playerId,
            playerName,
            io,
            (code, id, state) => roomManager.setPlayerState(code, id, state),
            (code, id, value) => roomManager.setPlayerIFrames(code, id, value)
        );
        
        // Start personal unfreeze quiz for this player
        this._startUnfreezeQuiz(roomCode, playerId, io);
    }

    /**
     * Handle player falling in lava (public method called from game handlers)
     * Freezes the player and starts a personal unfreeze quiz
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} playerName - Player name
     * @param {Object} io - Socket.IO server
     */
    handleLavaDeath(roomCode, playerId, playerName, io) {
        log.info(`🔥 Handling lava death for ${playerName} in room ${roomCode}`);
        
        // Use the same freeze + quiz logic as being tagged
        this._handleZeroHealth(roomCode, playerId, playerName, io);
    }

    /**
     * Respawn player after freeze duration
     * BATCHED: Single PLAYER_RESPAWN event includes position + health + state
     */
    _respawnAfterFreeze(roomCode, playerId, io) {
        const player = roomManager.getPlayer(roomCode, playerId);
        if (!player) return;

        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        // Set state to ACTIVE
        roomManager.setPlayerState(roomCode, playerId, PLAYER_STATE.ACTIVE);
        
        // Restore health
        roomManager.setPlayerHealth(roomCode, playerId, COMBAT_CONFIG.RESPAWN_HEALTH);
        
        // Get new spawn position (pass mapConfig for dynamic map sizing)
        const spawnPos = positionManager.findFreeSpawnPosition(roomCode, playerId, room.players, room.mapConfig);
        
        // Update position
        const newPos = {
            row: spawnPos.row,
            col: spawnPos.col,
            x: 0,
            y: 0,
            timestamp: Date.now()
        };
        positionManager.setPlayerPosition(roomCode, playerId, newPos);

        // Grant i-frames
        combatManager.grantIFrames(
            roomCode, 
            playerId, 
            io, 
            (code, id, value) => roomManager.setPlayerIFrames(code, id, value)
        );

        const updatedPlayer = roomManager.getPlayer(roomCode, playerId);

        // BATCHED: Single event with all respawn data (position + health + state)
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_RESPAWN, {
            playerId: playerId,
            playerName: player.name,
            health: updatedPlayer.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH,
            position: newPos,
            state: PLAYER_STATE.ACTIVE,
            inIFrames: true
        });
    }

    // ==================== UNFREEZE QUIZ METHODS ====================

    /**
     * Ensure room's Quizizz question pool is filled (lazy). No-op if no quizId or already filled.
     * @param {string} roomCode - Room code
     */
    async _ensureRoomQuizPool(roomCode) {
        const room = roomManager.getRoom(roomCode);
        if (!room?.quizId || room.quizQuestionPool !== null) return;
        const pool = await quizizzService.fetchAndNormalizeQuestions(room.quizId);
        room.quizQuestionPool = Array.isArray(pool) && pool.length > 0 ? pool : null;
    }

    /**
     * Start a personal unfreeze quiz for a frozen player
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} io - Socket.IO server
     */
    async _startUnfreezeQuiz(roomCode, playerId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return;

        // Prevent starting multiple quizzes for the same player
        if (this.hasUnfreezeQuiz(roomCode, playerId)) {
            log.warn(`⚠️ Unfreeze quiz already exists for player ${player.name}, skipping duplicate start`);
            return;
        }

        await this._ensureRoomQuizPool(roomCode);
        const pool = roomManager.getRoom(roomCode)?.quizQuestionPool;
        const needCount = UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT;
        let questions;
        if (Array.isArray(pool) && pool.length >= needCount) {
            const indices = new Set();
            while (indices.size < needCount) {
                indices.add(Math.floor(Math.random() * pool.length));
            }
            questions = [...indices].map(i => pool[i]);
        } else {
            questions = getRandomQuestions(needCount);
        }
        
        // Prepare questions for client (without correct answers); include images when present
        const questionsForClient = questions.map(q => ({
            id: q.id,
            question: q.question,
            options: q.options,
            questionImage: q.questionImage ?? null,
            optionImages: q.optionImages ?? []
        }));

        // Initialize unfreeze quiz state for this room if needed
        if (!this.unfreezeQuizzes.has(roomCode)) {
            this.unfreezeQuizzes.set(roomCode, new Map());
        }

        // Store quiz state for this player
        this.unfreezeQuizzes.get(roomCode).set(playerId, {
            questions: questions,           // Full questions with correct answers
            answers: [],                    // Player's submitted answers
            startTime: Date.now()
        });

        log.info(`🧊 Unfreeze quiz started for ${player.name} in room ${roomCode}`);

        // Emit to only this player's socket
        io.to(playerId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_START, {
            questions: questionsForClient,
            totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT,
            passThreshold: UNFREEZE_QUIZ_CONFIG.PASS_THRESHOLD
        });
    }

    /**
     * Submit an answer to the unfreeze quiz
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {number} questionIndex - Index of the question (0 or 1)
     * @param {number} answerIndex - Selected answer index
     * @param {Object} io - Socket.IO server
     * @returns {Object|null} Result of the answer submission
     */
    submitUnfreezeQuizAnswer(roomCode, playerId, questionIndex, answerIndex, io) {
        const roomQuizzes = this.unfreezeQuizzes.get(roomCode);
        if (!roomQuizzes) {
            log.warn(`No unfreeze quizzes for room ${roomCode}`);
            return null;
        }

        const quizState = roomQuizzes.get(playerId);
        if (!quizState) {
            log.warn(`No unfreeze quiz for player ${playerId} in room ${roomCode}`);
            return null;
        }

        // Validate question index
        if (questionIndex < 0 || questionIndex >= quizState.questions.length) {
            log.warn(`Invalid question index ${questionIndex} for unfreeze quiz`);
            return null;
        }

        // Check if already answered this question
        const alreadyAnswered = quizState.answers.some(a => a.questionIndex === questionIndex);
        if (alreadyAnswered) {
            log.warn(`Question ${questionIndex} already answered`);
            return null;
        }

        const question = quizState.questions[questionIndex];
        const isCorrect = answerIndex === question.correctAnswer;

        // Record the answer
        quizState.answers.push({
            questionIndex,
            answerIndex,
            correct: isCorrect
        });

        RoomManager.handlePlayerQuestionsAttempt(roomCode, playerId, isCorrect);

        // Send answer result to the player
        io.to(playerId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_ANSWER_RESULT, {
            questionIndex,
            isCorrect,
            correctAnswer: question.correctAnswer,
            totalAnswered: quizState.answers.length,
            totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT
        });

        // Check if all questions answered
        if (quizState.answers.length >= UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT) {
            const correctCount = quizState.answers.filter(a => a.correct).length;
            const passed = correctCount >= UNFREEZE_QUIZ_CONFIG.PASS_THRESHOLD;

            log.info(`🧊 Unfreeze quiz complete for player ${playerId}: ${correctCount}/${UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT} correct, passed: ${passed}`);

            if (passed) {
                // Clear quiz state
                roomQuizzes.delete(playerId);
                if (roomQuizzes.size === 0) {
                    this.unfreezeQuizzes.delete(roomCode);
                }

                // Clear frozen state in combat manager
                combatManager.clearFrozenState(playerId);

                // Respawn the player
                this._respawnAfterFreeze(roomCode, playerId, io);

                // Notify player quiz is complete
                io.to(playerId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_COMPLETE, {
                    passed: true,
                    correctCount,
                    totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT
                });
            } else {
                // Failed - generate new questions and restart the quiz
                // This allows the player to try again
                log.info(`🧊 Player ${playerId} failed unfreeze quiz, restarting with new questions`);
                
                // Clear current quiz state
                roomQuizzes.delete(playerId);
                if (roomQuizzes.size === 0) {
                    this.unfreezeQuizzes.delete(roomCode);
                }

                // Notify player they failed and will get new questions
                io.to(playerId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_COMPLETE, {
                    passed: false,
                    correctCount,
                    totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT,
                    retry: true
                });

                // Start new quiz with new questions after a brief delay
                // Use a more robust retry mechanism with fallback notification
                setTimeout(() => {
                    // Check player is still in room and still frozen
                    const room = roomManager.getRoom(roomCode);
                    const player = room?.players.find(p => p.id === playerId);
                    
                    if (!room || !player) {
                        // Player left the room - no action needed
                        log.info(`🧊 Player ${playerId} left room during quiz retry delay`);
                        return;
                    }
                    
                    if (player.state === PLAYER_STATE.FROZEN) {
                        // Player still frozen - start new quiz
                        this._startUnfreezeQuiz(roomCode, playerId, io);
                    } else {
                        // Player no longer frozen (unfrozen via blitz cancel or other means)
                        // Notify client so they don't wait forever
                        log.info(`🧊 Player ${player.name} is no longer frozen during retry delay (state: ${player.state})`);
                        io.to(playerId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_CANCELLED, {
                            reason: 'state_changed',
                            message: 'You are no longer frozen!'
                        });
                    }
                }, 1500);
            }
        }

        return {
            isCorrect,
            totalAnswered: quizState.answers.length,
            totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT
        };
    }

    /**
     * Cancel all unfreeze quizzes in a room (called when blitz starts)
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     */
    _cancelAllUnfreezeQuizzes(roomCode, io) {
        const roomQuizzes = this.unfreezeQuizzes.get(roomCode);
        if (!roomQuizzes || roomQuizzes.size === 0) {
            return;
        }

        log.info(`🧊 Cancelling ${roomQuizzes.size} unfreeze quizzes in room ${roomCode} due to blitz start`);

        // Process each player with an active unfreeze quiz
        for (const [playerId, quizState] of roomQuizzes) {
            // Clear frozen state in combat manager
            combatManager.clearFrozenState(playerId);

            // Respawn the player
            this._respawnAfterFreeze(roomCode, playerId, io);

            // Notify player their quiz was cancelled
            io.to(playerId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_CANCELLED, {
                reason: 'blitz_start',
                message: 'Blitz Quiz starting - you have been unfrozen!'
            });
        }

        // Clear all quiz state for this room
        this.unfreezeQuizzes.delete(roomCode);
    }

    /**
     * Check if a player has an active unfreeze quiz
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @returns {boolean} True if player has active unfreeze quiz
     */
    hasUnfreezeQuiz(roomCode, playerId) {
        const roomQuizzes = this.unfreezeQuizzes.get(roomCode);
        return roomQuizzes?.has(playerId) ?? false;
    }

    /**
     * Clean up unfreeze quiz state for a player (when they leave)
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     */
    cleanupUnfreezeQuiz(roomCode, playerId) {
        const roomQuizzes = this.unfreezeQuizzes.get(roomCode);
        if (roomQuizzes) {
            roomQuizzes.delete(playerId);
            if (roomQuizzes.size === 0) {
                this.unfreezeQuizzes.delete(roomCode);
            }
        }
    }

    /**
     * Request unfreeze quiz for a frozen player (for reconnection recovery)
     * If the player is frozen and has an active quiz, resend the quiz data.
     * If the player is frozen but has no quiz, start a new one.
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} io - Socket.IO server
     * @returns {boolean} True if quiz was sent/started
     */
    requestUnfreezeQuiz(roomCode, playerId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
            log.warn(`Request unfreeze quiz failed: Room ${roomCode} not found`);
            return false;
        }

        const player = room.players.find(p => p.id === playerId);
        if (!player) {
            log.warn(`Request unfreeze quiz failed: Player ${playerId} not found`);
            return false;
        }

        // Only process if player is actually frozen
        if (player.state !== PLAYER_STATE.FROZEN) {
            log.info(`Request unfreeze quiz: Player ${player.name} is not frozen (state: ${player.state})`);
            return false;
        }

        // Check if player already has an active quiz
        const roomQuizzes = this.unfreezeQuizzes.get(roomCode);
        const existingQuiz = roomQuizzes?.get(playerId);

        if (existingQuiz) {
            // Resend existing quiz data
            log.info(`🧊 Resending existing unfreeze quiz to ${player.name}`);
            const questionsForClient = existingQuiz.questions.map(q => ({
                id: q.id,
                question: q.question,
                options: q.options
            }));

            io.to(playerId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_START, {
                questions: questionsForClient,
                totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT,
                passThreshold: UNFREEZE_QUIZ_CONFIG.PASS_THRESHOLD
            });
            return true;
        } else {
            // No quiz exists - start a new one
            log.info(`🧊 Starting new unfreeze quiz for ${player.name} (reconnection recovery)`);
            this._startUnfreezeQuiz(roomCode, playerId, io);
            return true;
        }
    }

    /**
     * Check for coin collection
     */
    _checkCoinCollection(roomCode, playerId, position, io) {
        const coinId = coinManager.getCollectibleCoinAtPosition(roomCode, position);
        if (!coinId) return;

        const room = roomManager.getRoom(roomCode);
        const player = room?.players.find(p => p.id === playerId);
        if (!player) return;

        coinManager.collectCoin(
            roomCode,
            playerId,
            coinId,
            player.name,
            io,
            (code, id, amount) => roomManager.updatePlayerCoins(code, id, amount),
            (code) => roomManager.getLeaderboard(code)
        );
    }

    /**
     * Check for powerup collection
     */
    _checkPowerupCollection(roomCode, playerId, position, io) {
        const room = roomManager.getRoom(roomCode);
        const player = room?.players.find(p => p.id === playerId);
        if (!player) return;

        const powerupId = powerupManager.getCollectiblePowerupAtPosition(roomCode, position);
        if (!powerupId) return;

        powerupManager.collectPowerup(
            roomCode,
            playerId,
            powerupId,
            player.name,
            io,
            (code, id, value) => roomManager.setPlayerImmunity(code, id, value)
        );
    }
}

// Export singleton instance
export default new GameStateManager();
