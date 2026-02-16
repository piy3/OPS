/**
 * Game State Management Service - Facade
 * 
 * Thin coordination layer that delegates to domain-specific managers:
 * - PositionManager: Player positions, validation, spawn logic
 * - CombatManager: Combat, health, i-frames, knockback
 * - CoinManager: Coin spawning and collection
 * - QuizManager: Tag quiz handling
 * - GameLoopManager: Game phases, blitz quiz, hunt timing
 * 
 * Keeps the same public API for backward compatibility with handlers.
 */

import roomManager from './RoomManager.js';
import quizizzService from './QuizizzService.js';
import { SOCKET_EVENTS, GAME_PHASE, GAME_LOOP_CONFIG, COMBAT_CONFIG, PLAYER_STATE, UNFREEZE_QUIZ_CONFIG, ROOM_STATUS, MAZE_CONFIG } from '../config/constants.js';

const TILE_SIZE = MAZE_CONFIG.TILE_SIZE;
import { getRandomQuestions } from '../config/questions.js';
import log from '../utils/logger.js';

// Import domain managers
import positionManager from './managers/PositionManager.js';
import combatManager from './managers/CombatManager.js';
import coinManager from './managers/CoinManager.js';
import quizManager from './managers/QuizManager.js';
import gameLoopManager from './managers/GameLoopManager.js';
import sinkholeManager from './managers/SinkholeManager.js';
import sinkTrapManager from './managers/SinkTrapManager.js';
import RoomManager from './RoomManager.js';

class GameStateManager {
    constructor() {
        // Bind methods for callbacks (so "this" is correct when invoked by timers/other modules)
        this._onBlitzEnd = this._onBlitzEnd.bind(this);
        this._onStartHunt = this._onStartHunt.bind(this);
        this._onQuizComplete = this._onQuizComplete.bind(this);
        this._onBlitzFinished = this._onBlitzFinished.bind(this);
        this._onHuntEndForPlayer = this._onHuntEndForPlayer.bind(this);

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
        // Clean up combat state for each player (using persistent playerId)
        if (room?.players) {
            room.players.forEach(player => {
                combatManager.cleanupPlayer(player.playerId);
            });
        }
        coinManager.cleanupRoom(roomCode);
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
     * End the game immediately (e.g. when host/teacher clicks "End game").
     * Validation is done in the handler; this just runs the same end-game path as natural completion.
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     */
    endGameNow(roomCode, io) {
        this._endGame(roomCode, io);
    }

    /**
     * Get full game state for synchronization
     * Includes player states (frozen/active) and unfreeze quiz data for reconnection recovery
     */
    getGameState(roomCode, requesterId = null) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return null;

        // Get frozen players and their quiz data for reconnection recovery
        const roomQuizzes = this.unfreezeQuizzes.get(roomCode);
        const frozenPlayers = [];
        
        room.players.forEach(player => {
            if (player.state === PLAYER_STATE.FROZEN) {
                const quizState = roomQuizzes?.get(player.playerId);
                frozenPlayers.push({
                    playerId: player.playerId,
                    hasActiveQuiz: !!quizState,
                    // Don't include full quiz data here - client will request via REQUEST_UNFREEZE_QUIZ
                });
            }
        });

        return {
            roomCode: roomCode,
            teacherId: room.teacherId,
            isTeacher: requesterId == room.teacherId,
            totalRounds: room?.totalRounds ?? GAME_LOOP_CONFIG.TOTAL_GAME_ROUNDS,
            players: room.players.map(player => {
                const inMaze = gameLoopManager.getPlayerPhase(roomCode, player.playerId) === 'hunt';
                return {
                    id: player.playerId,  // Use persistent playerId for player identification
                    name: player.name,
                    isUnicorn: player.isUnicorn,
                    coins: player.coins,
                    sinkInventory: sinkTrapManager.getPlayerInventory(roomCode, player.playerId),
                    state: player.state || PLAYER_STATE.ACTIVE, // Include player state for frozen detection
                    position: positionManager.getPlayerPosition(roomCode, player.id),  // Position manager still uses socket ID internally
                    questions_attempted: Number(player.questions_attempted) || 0,
                    questions_correctly_answered: Number(player.questions_correctly_answered) || 0,
                    timeLeftInMaze: player.timeLeftInMaze,
                    inMaze, // true only when player has finished entry quiz and is in hunt (visible to others)
                };
            }),
            unicornIds: room.unicornIds ?? (room.unicornId ? [room.unicornId] : []),
            unicornId: room.unicornIds?.[0] ?? room.unicornId ?? null, // not necessary to send it, but kept due to support legacy frontend code
            leaderboard: roomManager.getLeaderboard(roomCode),
            coins: coinManager.getActiveCoins(roomCode),
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
        const room = roomManager.getRoom(roomCode);
        gameLoopManager.initRoomRounds(roomCode, room?.totalRounds ?? GAME_LOOP_CONFIG.TOTAL_GAME_ROUNDS);

        await gameLoopManager.startGameLoop(roomCode, io, (code) => {
            quizManager.freezeRoom(code);
        });

        if (room) {
            gameLoopManager.sendBlitzQuiz(
                roomCode,
                room.players.length,
                io,
                this._onBlitzEnd
            );
        }
    }

    async startGameLoopForEachPlayer(roomCode, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;
        gameLoopManager.setGamePhase(roomCode, GAME_PHASE.HUNT, io); 
        gameLoopManager.initGameTimer(roomCode, io, (code, socket) => this._endGame(code, socket));
        await gameLoopManager.prepQuestionsInRoom(roomCode);

        const mapConfig = room.mapConfig;
        coinManager.initializeCoins(roomCode, io, mapConfig);
        sinkholeManager.initializeSinkholes(roomCode, io, mapConfig);
        sinkTrapManager.initializeSinkTraps(roomCode, io, mapConfig);

        const players = room.players ?? [];
        for (const p of players) {
            await gameLoopManager.sendBlitzQuizToPlayer(roomCode, p.playerId, io);
        }
    }

    /**
     * Submit a Blitz Quiz answer (per-player flow: one of 3 questions)
     */
    submitBlitzAnswer(roomCode, playerId, questionIndex, answerIndex, io) {
        return gameLoopManager.submitBlitzAnswerForPlayer(
            roomCode,
            playerId,
            questionIndex,
            answerIndex,
            io,
            this._onBlitzFinished
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

        // Check if room is frozen -- helpful while the blitz-quiz -- cheap lookup
        if (quizManager.isRoomFrozen(roomCode)) {
            return null;
        }

        // Now do the heavier room/player lookup
        const room = roomManager.getRoom(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return null;

        // Per-player flow: allow move only when this player is in hunt phase (not in blitz)
        const playerPhase = gameLoopManager.getPlayerPhase(roomCode, player.playerId);
        if (playerPhase !== GAME_PHASE.HUNT && playerPhase !== 'hunt') {
            return null;
        }
        
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

        // Only process collisions when room is in HUNT or this player is in hunt (per-player flow)
        if (io && (gameLoopManager.getGamePhase(roomCode) === GAME_PHASE.HUNT || playerPhase === 'hunt')) {
            const validatedPosition = { row: updatedPosition.row, col: updatedPosition.col };
            
            // Check coin collection (survivors only)
            if (!isUnicorn) {
                this._checkCoinCollection(roomCode, playerId, validatedPosition, io);
            }

            // Check tag collision
            this._checkTagCollision(roomCode, playerId, oldPosition, validatedPosition, isUnicorn, io);

            // Check if any unicorn stepped on a sink trap (moving player's position + all other unicorns' positions)
            // unicornIds now contains persistent playerIds
            const unicornIds = room.unicornIds ?? (room.unicornId ? [room.unicornId] : []);
            const deployedCount = (sinkTrapManager.getDeployedTraps(roomCode) || []).length;
            if (isUnicorn && deployedCount > 0 && !this._lastSinkTrapLog) this._lastSinkTrapLog = 0;
            const now = Date.now();
            const shouldLogSinkTrap = isUnicorn && deployedCount > 0 && (now - (this._lastSinkTrapLog || 0) > 2000);
            if (shouldLogSinkTrap) this._lastSinkTrapLog = now;

            // Get current player's persistent playerId for comparison
            const currentPlayer = room.players.find(p => p.id === playerId);
            const currentPersistentId = currentPlayer?.playerId;

            for (const uid of unicornIds) {
                // uid is persistent playerId, need to get socket ID for position lookups
                const unicornPlayer = roomManager.getPlayerByPlayerId(roomCode, uid);
                if (!unicornPlayer) continue;
                const unicornSocketId = unicornPlayer.id;
                
                // Check if this is the current moving player
                const isCurrentPlayer = uid === currentPersistentId;
                
                const pos = isCurrentPlayer
                    ? { row: updatedPosition.row, col: updatedPosition.col, x: updatedPosition.x, y: updatedPosition.y }
                    : positionManager.getPlayerPosition(roomCode, unicornSocketId);
                if (!pos) continue;
                const gridRow = typeof pos.row === 'number' && !Number.isNaN(pos.row)
                    ? pos.row
                    : Math.floor((pos.y ?? 0) / TILE_SIZE);
                const gridCol = typeof pos.col === 'number' && !Number.isNaN(pos.col)
                    ? pos.col
                    : Math.floor((pos.x ?? 0) / TILE_SIZE);

                // For the moving unicorn: check every cell along the path so we don't miss a trap when updates are throttled
                let triggeredTrapId = null;
                let pathLength = 0;
                if (isCurrentPlayer && isUnicorn && oldPosition) {
                    const oldRow = typeof oldPosition.row === 'number' && !Number.isNaN(oldPosition.row)
                        ? oldPosition.row
                        : Math.floor((oldPosition.y ?? 0) / TILE_SIZE);
                    const oldCol = typeof oldPosition.col === 'number' && !Number.isNaN(oldPosition.col)
                        ? oldPosition.col
                        : Math.floor((oldPosition.x ?? 0) / TILE_SIZE);
                    const path = positionManager.getCellsInPath(
                        { row: oldRow, col: oldCol },
                        { row: gridRow, col: gridCol }
                    );
                    pathLength = path.length;
                    for (const cell of path) {
                        triggeredTrapId = sinkTrapManager.checkTrapTrigger(roomCode, cell, false);
                        if (triggeredTrapId) break;
                    }
                }
                if (!triggeredTrapId) {
                    triggeredTrapId = sinkTrapManager.checkTrapTrigger(roomCode, { row: gridRow, col: gridCol }, shouldLogSinkTrap);
                }

                if (shouldLogSinkTrap && isCurrentPlayer) {
                    log.info({ roomCode, phase: 'HUNT', unicornId: uid, grid: `${gridRow},${gridCol}`, pathCells: pathLength, deployedTraps: deployedCount, triggered: !!triggeredTrapId }, 'SinkTrap position check');
                }

                if (triggeredTrapId) {
                    // Use socket ID for position operations
                    const destinationPosition = positionManager.findFreeSpawnPosition(roomCode, unicornSocketId, room.players, room.mapConfig);
                    // Pass both socket ID (for position updates) and persistent playerId (for events)
                    sinkTrapManager.triggerTrap(
                        roomCode, triggeredTrapId, unicornSocketId, uid, unicornPlayer.name || 'Unicorn', io,
                        (code, id, position) => positionManager.setPlayerPosition(code, id, position),
                        (code, pId) => positionManager.setLastMoveWasTeleport(code, pId),
                        destinationPosition,
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
     * @param {string} roomCode - Room code
     * @param {string} socketId - Player socket ID (for position manager)
     * @param {string} persistentPlayerId - Persistent player ID (for combat manager, optional - defaults to socketId)
     */
    removePlayerPosition(roomCode, socketId, persistentPlayerId = null) {
        positionManager.removePlayerPosition(roomCode, socketId);
        // Use persistent playerId for combat cleanup if provided, otherwise fall back to socketId
        combatManager.cleanupPlayer(persistentPlayerId || socketId);
        this.cleanupUnfreezeQuiz(roomCode, persistentPlayerId || socketId);
    }

    /**
     * Update player's socket ID in position tracking (on reconnection)
     * @param {string} roomCode - Room code
     * @param {string} oldSocketId - Old socket ID
     * @param {string} newSocketId - New socket ID
     */
    updatePlayerSocketId(roomCode, oldSocketId, newSocketId) {
        positionManager.updatePlayerSocketId(roomCode, oldSocketId, newSocketId);
    }

    /**
     * Clear all positions for a room
     */
    clearRoomState(roomCode) {
        positionManager.cleanupRoom(roomCode);
        gameLoopManager.cleanupRoom(roomCode);
        coinManager.cleanupRoom(roomCode);
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
     * Get active sinkholes in a room
     */
    getActiveSinkholes(roomCode) {
        return sinkholeManager.getActiveSinkholes(roomCode);
    }

    /**
     * Enter a sinkhole to teleport to another sinkhole
     * @param {string} roomCode - Room code
     * @param {string} socketId - Player socket ID (for position updates)
     * @param {string} persistentPlayerId - Persistent player ID (for events)
     * @param {string} playerName - Player name
     * @param {string} sinkholeId - Sinkhole ID
     * @param {Object} io - Socket.IO server
     */
    enterSinkhole(roomCode, socketId, persistentPlayerId, playerName, sinkholeId, io) {
        return sinkholeManager.enterSinkhole(
            roomCode, socketId, persistentPlayerId, playerName, sinkholeId, io,
            (code, id, position) => positionManager.setPlayerPosition(code, id, position),
            (code, pId) => positionManager.setLastMoveWasTeleport(code, pId)
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
     * Callback when a single player has submitted all 3 blitz answers (per-player flow). Assign enforcer (20%), start hunt for this player.
     */
    _onBlitzFinished(roomCode, io, playerId) {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== ROOM_STATUS.PLAYING) return;
        const player = room.players.find(p => p.playerId === playerId);
        if (!player) return;
        const enforcerChance = GAME_LOOP_CONFIG.ENFORCER_CHANCE ?? 0.2;
        const isEnforcer = Math.random() < enforcerChance;
        const currentIds = room.unicornIds ?? [];
        
        // Update unicornIds: add if becoming enforcer, remove if not
        let unicornIdsChanged = false;
        if (isEnforcer) {
            if (!currentIds.includes(playerId)) {
                roomManager.setUnicorns(roomCode, [...currentIds, playerId]);
                unicornIdsChanged = true;
            }
        } else {
            // Remove player from unicornIds if they're no longer an enforcer
            if (currentIds.includes(playerId)) {
                roomManager.setUnicorns(roomCode, currentIds.filter(id => id !== playerId));
                unicornIdsChanged = true;
            }
        }
        
        const updatedRoom = roomManager.getRoom(roomCode);
        const socketId = player.id;
        const now = Date.now();
        const huntEndTime = now + GAME_LOOP_CONFIG.HUNT_DURATION;
        gameLoopManager.startHuntForPlayer(roomCode, playerId, io, (code, pid, socket) => this._onHuntEndForPlayer(code, socket, pid));
        io.to(socketId).emit(SOCKET_EVENTS.SERVER.HUNT_START, {
            duration: GAME_LOOP_CONFIG.HUNT_DURATION,
            endTime: huntEndTime,
            isEnforcer: isEnforcer,
            unicornIds: updatedRoom?.unicornIds ?? room.unicornIds ?? [],
            timestamp: now
        });
        
        // Broadcast enforcer status change to all players so they update their remotePlayersRef
        if (unicornIdsChanged) {
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                newUnicornIds: updatedRoom?.unicornIds ?? [],
                reason: 'role_change'
            });
        }
        
        // Broadcast this player's position so others see them in the maze
        const pos = positionManager.getPlayerPosition(roomCode, socketId);
        if (pos) {
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
                playerId: playerId,
                position: pos
            });
        }
    }

    /**
     * Callback when a single player's hunt 30s expires (per-player flow). Send next 3 questions and set phase back to blitz.
     * If the player was frozen (in unfreeze quiz), cancel their quiz and clear frozen state first.
     */
    async _onHuntEndForPlayer(roomCode, io, playerId) {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== ROOM_STATUS.PLAYING) return;
        
        // Check if this player has an active unfreeze quiz (they were tagged during hunt)
        // If so, cancel their quiz and clear their frozen state before starting blitz
        if (this.hasUnfreezeQuiz(roomCode, playerId)) {
            log.info({ roomCode, playerId }, 'Player hunt timer expired while in unfreeze quiz - cancelling quiz');
            
            // Clear frozen state in combat manager
            combatManager.clearFrozenState(playerId);
            
            // Find player to get socket ID for emitting and state reset
            const player = room.players.find(p => p.playerId === playerId);
            if (player) {
                // Reset player state to ACTIVE
                roomManager.setPlayerState(roomCode, player.id, PLAYER_STATE.ACTIVE);
                
                // Notify player their quiz was cancelled
                io.to(player.id).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_CANCELLED, {
                    reason: 'hunt_timer_expired',
                    message: 'Hunt timer expired - starting blitz quiz!'
                });
            }
            
            // Clean up quiz state
            this.cleanupUnfreezeQuiz(roomCode, playerId);
        }
        
        await gameLoopManager.sendBlitzQuizToPlayer(roomCode, playerId, io);
    }

    /**
     * Callback when hunt phase should start
     */
    _onStartHunt(roomCode, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== 'playing') return;

        // Reset player health for new round
        roomManager.resetPlayersHealth(roomCode);
        
        // Clean up combat states (using persistent playerId)
        room.players.forEach(player => {
            combatManager.cleanupPlayer(player.playerId);
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
            log.info({ roomCode }, 'All rounds complete, ending game');
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
        log.info({ roomCode }, '=== GAME ENDING ===');
        
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
        
        log.info({ roomCode, leaderboard: leaderboard.map(p => ({ name: p.name, coins: p.coins })) }, 'Final leaderboard');
        
        // 5. Set phase to GAME_END
        gameLoopManager.setGamePhase(roomCode, GAME_PHASE.GAME_END, io);
        
        // 6. Emit game end event to all players
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_END, {
            roomCode,
            leaderboard,
            totalRounds,
            message: `Game over after ${totalRounds} rounds!`
        });
        
        log.info({ roomCode }, 'Game end event emitted');
        
        // 7. Clean up ALL manager state including spawners
        positionManager.cleanupRoom(roomCode);
        if (room?.players) {
            room.players.forEach(player => {
                combatManager.cleanupPlayer(player.playerId);
            });
        }
        coinManager.cleanupRoom(roomCode);
        quizManager.clearQuizState(roomCode);
        gameLoopManager.cleanupRoom(roomCode);
        sinkholeManager.cleanupRoom(roomCode);
        sinkTrapManager.cleanupRoom(roomCode);
        this.unfreezeQuizzes.delete(roomCode);
        
        log.info({ roomCode }, '=== GAME ENDED ===');
        // Room is not deleted on game end; it stays so the teacher can restart with same quiz and players.
        // Room is removed only when the last person leaves (existing leave logic).
    }

    /**
     * Delete room after game has ended (called after delay)
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     */
    _deleteRoomAfterGameEnd(roomCode, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
            log.info({ roomCode }, 'Room already deleted');
            return;
        }

        // Only delete if game is finished (not restarted)
        if (room.status !== ROOM_STATUS.FINISHED) {
            log.info({ roomCode }, 'Status changed from FINISHED, not deleting');
            return;
        }

        log.info({ roomCode }, 'Deleting room and removing all players');

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
        
        log.info({ roomCode }, 'Room deleted successfully');
    }

    /**
     * Callback when tag quiz completes
     * Note: caughtId and unicornId are now persistent playerIds
     */
    _onQuizComplete(results) {
        const { roomCode, caughtPlayerWins, caughtId, unicornId, scorePercentage, isTimeout } = results;
        
        // Get socket IDs from persistent playerIds for internal operations
        const caughtPlayer = roomManager.getPlayerByPlayerId(roomCode, caughtId);
        const unicornPlayer = roomManager.getPlayerByPlayerId(roomCode, unicornId);
        const caughtSocketId = caughtPlayer?.id;
        const unicornSocketId = unicornPlayer?.id;
        
        if (!caughtSocketId || !unicornSocketId) {
            log.warn(`Quiz complete but players not found: caught=${caughtId}, unicorn=${unicornId}`);
            return;
        }
        
        if (caughtPlayerWins) {
            // Use socket IDs for internal coin operations
            roomManager.updatePlayerCoins(roomCode, caughtSocketId, 20);
            roomManager.updatePlayerCoins(roomCode, unicornSocketId, -20);
            const room = roomManager.getRoom(roomCode);
            // unicornIds now contains persistent playerIds
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
            // Use socket IDs for internal coin operations
            roomManager.updatePlayerCoins(roomCode, unicornSocketId, 20);
            roomManager.updatePlayerCoins(roomCode, caughtSocketId, -20);
        }
    }

    // ==================== INTERNAL COLLISION HANDLING ====================

    /**
     * Check for tag collision between players (multiple unicorns: any unicorn can tag any survivor)
     * Note: unicornIds now contains persistent playerIds, but positionManager uses socket IDs
     */
    _checkTagCollision(roomCode, playerId, oldPosition, newPosition, isUnicorn, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        // unicornIds now contains persistent playerIds
        const unicornIds = room.unicornIds ?? (room.unicornId ? [room.unicornId] : []);
        if (unicornIds.length === 0) return;

        const isTeleport = positionManager.getLastMoveWasTeleport(roomCode, playerId);
        if (isTeleport) {
            positionManager.clearLastMoveWasTeleport(roomCode, playerId);
            return;
        };

        const oldPos = oldPosition || newPosition;
        const pathCells = positionManager.getCellsInPath(oldPos, newPosition);

        if (!isUnicorn) {
            // Current player is survivor, check collision with unicorns
            for (const uid of unicornIds) {
                // uid is persistent playerId, need to get socket ID for position lookup
                const unicornPlayer = roomManager.getPlayerByPlayerId(roomCode, uid);
                if (!unicornPlayer) continue;
                // Skip unicorns in blitz quiz (not in maze yet)
                if (gameLoopManager.getPlayerPhase(roomCode, uid) !== 'hunt') continue;
                const unicornPos = positionManager.getPlayerPosition(roomCode, unicornPlayer.id);
                if (!unicornPos) continue;
                const crossed = pathCells.some(cell =>
                    cell.row === unicornPos.row && cell.col === unicornPos.col
                ) || (newPosition.row === unicornPos.row && newPosition.col === unicornPos.col);
                if (crossed) {
                    // Pass socket IDs to _handleTag for internal processing
                    this._handleTag(roomCode, unicornPlayer.id, playerId, io);
                    return;
                }
            }
        } else {
            const caughtPlayers = [];
            for (const p of room.players) {
                if (p.id === playerId || p.isUnicorn) continue;
                // Don't tag players still in blitz (not in maze yet)
                if (gameLoopManager.getPlayerPhase(roomCode, p.playerId) !== 'hunt') continue;
                const playerPos = positionManager.getPlayerPosition(roomCode, p.id);
                if (!playerPos) continue;
                const caught = pathCells.some(cell =>
                    cell.row === playerPos.row && cell.col === playerPos.col
                ) || (playerPos.row === newPosition.row && playerPos.col === newPosition.col);

                if (caught) caughtPlayers.push(p);
            }
            for (const caughtPlayer of caughtPlayers) {
                // Pass socket IDs to _handleTag for internal processing
                this._handleTag(roomCode, playerId, caughtPlayer.id, io);
            }
        }
    }

    /**
     * Handle unicorn tagging a survivor
     * Uses freeze + unfreeze quiz mode (player is frozen and must answer quiz to respawn)
     * Note: Parameters are socket IDs for internal processing, events emit persistent playerIds
     */
    _handleTag(roomCode, unicornSocketId, survivorSocketId, io) {
        const room = roomManager.getRoom(roomCode);
        // unicornIds now contains persistent playerIds
        const unicornIds = room?.unicornIds ?? (room?.unicornId ? [room.unicornId] : []);

        const unicornPlayer = room?.players.find(p => p.id === unicornSocketId);
        const survivorPlayer = room?.players.find(p => p.id === survivorSocketId);
        if (!unicornPlayer || !survivorPlayer) return;

        // Check if this player is actually a unicorn (compare persistent playerId)
        if (!unicornIds.includes(unicornPlayer.playerId)) return;

        // Rate limit collision (uses socket IDs internally)
        if (!combatManager.shouldProcessCollision(unicornSocketId, survivorSocketId)) {
            return;
        }

        // Check if survivor can be hit (not already frozen, not in i-frames)
        // Use persistent playerId for combat state tracking
        const hitCheck = combatManager.canHitPlayer(survivorPlayer, survivorPlayer.playerId);
        if (!hitCheck.canHit) {
            log.debug({ roomCode, player: survivorPlayer.name, reason: hitCheck.reason }, 'Cannot tag player');
            return;
        }

        combatManager.setCollisionCooldown(unicornSocketId, survivorSocketId);

        // FREEZE + UNFREEZE QUIZ MODE
        // Award points to unicorn (uses socket ID internally)
        roomManager.updatePlayerCoins(roomCode, unicornSocketId, GAME_LOOP_CONFIG.TAG_SCORE_STEAL);
        
        // Handle freeze and start unfreeze quiz
        this._handleZeroHealth(roomCode, survivorSocketId, survivorPlayer.name, io);

        const updatedUnicorn = roomManager.getPlayer(roomCode, unicornSocketId);

        // Emit tagged event for visual feedback - use persistent playerIds
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_TAGGED, {
            unicornId: unicornPlayer.playerId,
            unicornName: unicornPlayer.name,
            caughtId: survivorPlayer.playerId,
            caughtName: survivorPlayer.name,
            coinsGained: GAME_LOOP_CONFIG.TAG_SCORE_STEAL,
            timestamp: Date.now()
        });

        // Update leaderboard - use persistent playerIds
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SCORE_UPDATE, {
            unicornId: unicornPlayer.playerId,
            caughtId: survivorPlayer.playerId,
            unicornCoins: updatedUnicorn?.coins || 0,
            caughtCoins: survivorPlayer.coins || 0,
            room: roomManager.getRoom(roomCode),
            leaderboard: roomManager.getLeaderboard(roomCode)
        });

        log.info({ roomCode, player: survivorPlayer.name, frozenBy: unicornPlayer.name }, 'Player frozen');
    }

    /**
     * Handle player reaching zero health
     * Freezes the player and starts a personal unfreeze quiz
     * @param {string} roomCode - Room code
     * @param {string} socketId - Player socket ID
     * @param {string} playerName - Player name
     * @param {Object} io - Socket.IO server
     */
    _handleZeroHealth(roomCode, socketId, playerName, io) {
        // Get player to access persistent playerId
        const player = roomManager.getPlayer(roomCode, socketId);
        const persistentPlayerId = player?.playerId || socketId;
        
        // Freeze the player (no respawn timer - quiz handles unfreeze)
        combatManager.handleZeroHealth(
            roomCode,
            socketId,
            persistentPlayerId,
            playerName,
            io,
            (code, id, state) => roomManager.setPlayerState(code, id, state),
            (code, id, value) => roomManager.setPlayerIFrames(code, id, value)
        );
        
        // Start personal unfreeze quiz for this player (uses persistent playerId)
        this._startUnfreezeQuiz(roomCode, persistentPlayerId, io);
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
        log.info({ roomCode, player: playerName }, 'Handling lava death');
        
        // Use the same freeze + quiz logic as being tagged
        this._handleZeroHealth(roomCode, playerId, playerName, io);
    }

    /**
     * Respawn player after freeze duration
     * BATCHED: Single PLAYER_RESPAWN event includes position + health + state
     * @param {string} roomCode - Room code
     * @param {string} persistentPlayerId - Persistent player ID
     * @param {Object} io - Socket.IO server
     */
    _respawnAfterFreeze(roomCode, persistentPlayerId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        // Find player by persistent playerId
        const player = room.players.find(p => p.playerId === persistentPlayerId);
        if (!player) return;

        const socketId = player.id;

        // Set state to ACTIVE (uses socket ID for internal operation)
        roomManager.setPlayerState(roomCode, socketId, PLAYER_STATE.ACTIVE);
        
        // Restore health
        roomManager.setPlayerHealth(roomCode, socketId, COMBAT_CONFIG.RESPAWN_HEALTH);
        
        // Get new spawn position (pass mapConfig for dynamic map sizing)
        const spawnPos = positionManager.findFreeSpawnPosition(roomCode, socketId, room.players, room.mapConfig);
        
        // Update position
        const newPos = {
            row: spawnPos.row,
            col: spawnPos.col,
            x: null, // sending null instead of (0,0) so that fronted would use row and col for first render of player at respawn position.
            y: null,
            timestamp: Date.now()
        };
        positionManager.setPlayerPosition(roomCode, socketId, newPos);

        // Grant i-frames (pass both socket ID and persistent playerId)
        combatManager.grantIFrames(
            roomCode, 
            socketId,
            persistentPlayerId,
            io, 
            (code, id, value) => roomManager.setPlayerIFrames(code, id, value)
        );

        const updatedPlayer = roomManager.getPlayer(roomCode, socketId);

        // BATCHED: Single event with all respawn data (position + health + state)
        // Use persistent playerId for player identification in events
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_RESPAWN, {
            playerId: persistentPlayerId,
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

        // playerId here is the persistent player ID - find player by playerId field
        const player = room.players.find(p => p.playerId === playerId);
        if (!player) return;

        // Prevent starting multiple quizzes for the same player (keyed by persistent playerId)
        if (this.hasUnfreezeQuiz(roomCode, playerId)) {
            log.warn({ roomCode, playerId, playerName: player.name }, 'Unfreeze quiz already exists, skipping duplicate start');
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

        // Store quiz state for this player (keyed by persistent playerId)
        this.unfreezeQuizzes.get(roomCode).set(playerId, {
            questions: questions,           // Full questions with correct answers
            answers: [],                    // Player's submitted answers
            startTime: Date.now()
        });

        log.info({ roomCode, playerId, playerName: player.name }, 'Unfreeze quiz started');

        // Emit to player's socket (player.id is the socket ID)
        io.to(player.id).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_START, {
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
            log.warn({ roomCode }, 'No unfreeze quizzes for room');
            return null;
        }

        const quizState = roomQuizzes.get(playerId);
        if (!quizState) {
            log.warn({ roomCode, playerId }, 'No unfreeze quiz for player');
            return null;
        }

        // Get player by persistent playerId to access their socket ID for emitting
        const room = roomManager.getRoom(roomCode);
        const player = room?.players.find(p => p.playerId === playerId);
        const socketId = player?.id || playerId; // Fallback to playerId if player not found

        // Validate question index
        if (questionIndex < 0 || questionIndex >= quizState.questions.length) {
            log.warn({ roomCode, playerId, questionIndex }, 'Invalid question index for unfreeze quiz');
            return null;
        }

        // Check if already answered this question
        const alreadyAnswered = quizState.answers.some(a => a.questionIndex === questionIndex);
        if (alreadyAnswered) {
            log.warn({ roomCode, playerId, questionIndex }, 'Question already answered');
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

        // Send answer result to the player (use socket ID)
        io.to(socketId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_ANSWER_RESULT, {
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

            log.info({ roomCode, playerId, correctCount, totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT, passed }, 'Unfreeze quiz complete');

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

                // Notify player quiz is complete (use socket ID)
                io.to(socketId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_COMPLETE, {
                    passed: true,
                    correctCount,
                    totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT
                });
            } else {
                // Failed - generate new questions and restart the quiz
                // This allows the player to try again
                log.info({ roomCode, playerId }, 'Player failed unfreeze quiz, restarting with new questions');
                
                // Clear current quiz state
                roomQuizzes.delete(playerId);
                if (roomQuizzes.size === 0) {
                    this.unfreezeQuizzes.delete(roomCode);
                }

                // Notify player they failed and will get new questions (use socket ID)
                io.to(socketId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_COMPLETE, {
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
                    const retryPlayer = room?.players.find(p => p.playerId === playerId);
                    
                    if (!room || !retryPlayer) {
                        // Player left the room - no action needed
                        log.info({ roomCode, playerId }, 'Player left room during quiz retry delay');
                        return;
                    }
                    
                    if (retryPlayer.state === PLAYER_STATE.FROZEN) {
                        // Player still frozen - start new quiz (playerId is persistent ID)
                        this._startUnfreezeQuiz(roomCode, playerId, io);
                    } else {
                        // Player no longer frozen (unfrozen via blitz cancel or other means)
                        // Notify client so they don't wait forever (use socket ID)
                        log.info({ roomCode, playerId, playerName: retryPlayer.name, state: retryPlayer.state }, 'Player no longer frozen during retry delay');
                        io.to(retryPlayer.id).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_CANCELLED, {
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

        log.info({ roomCode, count: roomQuizzes.size }, 'Cancelling unfreeze quizzes due to blitz start');

        // Process each player with an active unfreeze quiz
        const room = roomManager.getRoom(roomCode);
        for (const [playerId, quizState] of roomQuizzes) {
            // Clear frozen state in combat manager (playerId is persistent ID)
            combatManager.clearFrozenState(playerId);

            // Respawn the player (playerId is persistent ID)
            this._respawnAfterFreeze(roomCode, playerId, io);

            // Find player to get socket ID for emitting
            const player = room?.players.find(p => p.playerId === playerId);
            const socketId = player?.id || playerId;

            // Notify player their quiz was cancelled (use socket ID)
            io.to(socketId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_CANCELLED, {
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
     * @param {string} socketId - Player socket ID
     * @param {Object} io - Socket.IO server
     * @returns {boolean} True if quiz was sent/started
     */
    requestUnfreezeQuiz(roomCode, socketId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
            log.warn({ roomCode }, 'Request unfreeze quiz failed: room not found');
            return false;
        }

        const player = room.players.find(p => p.id === socketId);
        if (!player) {
            log.warn({ roomCode, socketId }, 'Request unfreeze quiz failed: player not found');
            return false;
        }

        // Get persistent playerId for quiz storage lookup
        const persistentPlayerId = player.playerId || socketId;

        // Only process if player is actually frozen
        if (player.state !== PLAYER_STATE.FROZEN) {
            log.info({ roomCode, socketId, playerName: player.name, state: player.state }, 'Request unfreeze quiz: player not frozen');
            return false;
        }

        // Check if player already has an active quiz (keyed by persistent playerId)
        const roomQuizzes = this.unfreezeQuizzes.get(roomCode);
        const existingQuiz = roomQuizzes?.get(persistentPlayerId);

        if (existingQuiz) {
            // Resend existing quiz data
            log.info({ roomCode, persistentPlayerId, playerName: player.name }, 'Resending existing unfreeze quiz');
            const questionsForClient = existingQuiz.questions.map(q => ({
                id: q.id,
                question: q.question,
                options: q.options
            }));

            io.to(socketId).emit(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_START, {
                questions: questionsForClient,
                totalQuestions: UNFREEZE_QUIZ_CONFIG.QUESTIONS_COUNT,
                passThreshold: UNFREEZE_QUIZ_CONFIG.PASS_THRESHOLD
            });
            return true;
        } else {
            // No quiz exists - start a new one (pass persistent playerId)
            log.info({ roomCode, persistentPlayerId, playerName: player.name }, 'Starting new unfreeze quiz for reconnection recovery');
            this._startUnfreezeQuiz(roomCode, persistentPlayerId, io);
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
            playerId,           // socket ID for internal operations
            player.playerId,    // persistent playerId for events
            coinId,
            player.name,
            io,
            (code, id, amount) => roomManager.updatePlayerCoins(code, id, amount),
            (code) => roomManager.getLeaderboard(code)
        );
    }

}

// Export singleton instance
export default new GameStateManager();
