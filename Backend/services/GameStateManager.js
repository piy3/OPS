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
import { SOCKET_EVENTS, GAME_PHASE, COMBAT_CONFIG, PLAYER_STATE } from '../config/constants.js';
import log from '../utils/logger.js';

// Import domain managers
import positionManager from './managers/PositionManager.js';
import combatManager from './managers/CombatManager.js';
import coinManager from './managers/CoinManager.js';
import powerupManager from './managers/PowerupManager.js';
import quizManager from './managers/QuizManager.js';
import gameLoopManager from './managers/GameLoopManager.js';

class GameStateManager {
    constructor() {
        // Bind methods for callbacks
        this._onBlitzEnd = this._onBlitzEnd.bind(this);
        this._onStartHunt = this._onStartHunt.bind(this);
        this._onQuizComplete = this._onQuizComplete.bind(this);
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
            positionManager.assignSpawnPositions(roomCode, room.players);
        }
    }

    /**
     * Clean up game state for a room
     */
    cleanupRoom(roomCode) {
        positionManager.cleanupRoom(roomCode);
        combatManager.cleanupRoom([]);
        coinManager.cleanupRoom(roomCode);
        powerupManager.cleanupRoom(roomCode);
        quizManager.clearQuizState(roomCode);
        gameLoopManager.cleanupRoom(roomCode);
    }

    /**
     * Clear quiz state for a room
     */
    clearQuizState(roomCode) {
        quizManager.clearQuizState(roomCode);
    }

    /**
     * Get full game state for synchronization
     */
    getGameState(roomCode) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return null;

        return {
            roomCode: roomCode,
            players: room.players.map(player => ({
                id: player.id,
                name: player.name,
                isUnicorn: player.isUnicorn,
                coins: player.coins,
                position: positionManager.getPlayerPosition(roomCode, player.id)
            })),
            unicornId: room.unicornId,
            leaderboard: roomManager.getLeaderboard(roomCode),
            timestamp: Date.now()
        };
    }

    /**
     * Start the game loop for a room
     */
    startGameLoop(roomCode, io) {
        gameLoopManager.startGameLoop(roomCode, io, (code) => {
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
     * Check if player leaving is the unicorn and handle
     */
    checkAndHandleUnicornLeave(roomCode, playerId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return false;

        if (room.unicornId === playerId) {
            gameLoopManager.handleUnicornDisconnect(
                roomCode, 
                playerId, 
                io,
                (code, newId) => roomManager.setUnicorn(code, newId),
                (code, socket) => {
                    // Clean up map interactions and restart blitz
                    coinManager.cleanupRoom(code);
                    powerupManager.cleanupRoom(code);
                    setTimeout(() => {
                        this._startNewBlitz(code, socket);
                    }, 2000);
                }
            );
            return true;
        }

        // Check if reserve
        gameLoopManager.handleReserveDisconnect(roomCode, playerId, io);
        return false;
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
            (code, newId) => roomManager.transferUnicorn(code, newId),
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
                coinManager.initializeCoins(code, socket);
                powerupManager.startSpawning(code, socket, (c) => gameLoopManager.getGamePhase(c));
            },
            (code, socket) => this._startNewBlitz(code, socket)
        );
    }

    /**
     * Start a new blitz quiz
     */
    _startNewBlitz(roomCode, io) {
        gameLoopManager.startBlitzQuiz(roomCode, io, (code) => {
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
     * Callback when tag quiz completes
     */
    _onQuizComplete(results) {
        const { roomCode, caughtPlayerWins, caughtId, unicornId, scorePercentage, isTimeout } = results;
        
        if (caughtPlayerWins) {
            // Caught player wins
            roomManager.updatePlayerCoins(roomCode, caughtId, 20);
            roomManager.updatePlayerCoins(roomCode, unicornId, -20);
            roomManager.transferUnicorn(roomCode, caughtId);
        } else {
            // Unicorn wins
            roomManager.updatePlayerCoins(roomCode, unicornId, 20);
            roomManager.updatePlayerCoins(roomCode, caughtId, -20);
        }
    }

    // ==================== INTERNAL COLLISION HANDLING ====================

    /**
     * Check for tag collision between players
     */
    _checkTagCollision(roomCode, playerId, oldPosition, newPosition, isUnicorn, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        const unicornPlayer = room.players.find(p => p.isUnicorn);
        if (!unicornPlayer) return;

        const oldPos = oldPosition || newPosition;
        const pathCells = positionManager.getCellsInPath(oldPos, newPosition);

        if (!isUnicorn) {
            // Survivor checking if crossed unicorn
            const unicornPos = positionManager.getPlayerPosition(roomCode, unicornPlayer.id);
            if (!unicornPos) return;

            const crossedUnicorn = pathCells.some(cell => 
                cell.row === unicornPos.row && cell.col === unicornPos.col
            ) || (newPosition.row === unicornPos.row && newPosition.col === unicornPos.col);
            
            if (crossedUnicorn) {
                this._handleTag(roomCode, unicornPlayer.id, playerId, io);
            }
        } else {
            // Unicorn checking if crossed any survivor
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
     */
    _handleTag(roomCode, unicornId, survivorId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.unicornId !== unicornId) return;

        // Rate limit collision
        if (!combatManager.shouldProcessCollision(unicornId, survivorId)) {
            return;
        }

        const unicornPlayer = room.players.find(p => p.id === unicornId);
        const survivorPlayer = room.players.find(p => p.id === survivorId);
        if (!unicornPlayer || !survivorPlayer) return;

        // Validate hit
        const hitCheck = combatManager.canHitPlayer(survivorPlayer, survivorId);
        if (!hitCheck.canHit) return;

        // Deal damage
        roomManager.updatePlayerHealth(roomCode, survivorId, -COMBAT_CONFIG.TAG_DAMAGE);
        roomManager.updatePlayerCoins(roomCode, unicornId, COMBAT_CONFIG.TAG_HEAL);

        const updatedSurvivor = roomManager.getPlayer(roomCode, survivorId);
        const updatedUnicorn = roomManager.getPlayer(roomCode, unicornId);

        // Apply knockback
        const victimPos = positionManager.getPlayerPosition(roomCode, survivorId);
        const attackerPos = positionManager.getPlayerPosition(roomCode, unicornId);
        const knockbackData = combatManager.applyKnockback(victimPos, attackerPos, survivorId);

        // Grant i-frames
        combatManager.grantIFrames(
            roomCode, 
            survivorId, 
            io, 
            (code, id, value) => roomManager.setPlayerIFrames(code, id, value)
        );

        // Broadcast hit event
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_HIT, {
            attackerId: unicornId,
            attackerName: unicornPlayer.name,
            victimId: survivorId,
            victimName: survivorPlayer.name,
            damage: COMBAT_CONFIG.TAG_DAMAGE,
            newHealth: updatedSurvivor.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH,
            knockback: knockbackData,
            iframeDuration: COMBAT_CONFIG.IFRAME_DURATION
        });

        // Check for zero health
        if (updatedSurvivor.health <= 0) {
            this._handleZeroHealth(roomCode, survivorId, survivorPlayer.name, io);
        }

        // Update leaderboard
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SCORE_UPDATE, {
            unicornId: unicornId,
            caughtId: survivorId,
            unicornCoins: updatedUnicorn.coins,
            caughtCoins: updatedSurvivor.coins,
            room: roomManager.getRoom(roomCode),
            leaderboard: roomManager.getLeaderboard(roomCode)
        });
    }

    /**
     * Handle player reaching zero health
     */
    _handleZeroHealth(roomCode, playerId, playerName, io) {
        combatManager.handleZeroHealth(
            roomCode,
            playerId,
            playerName,
            io,
            (code, id, state) => roomManager.setPlayerState(code, id, state),
            (code, id, value) => roomManager.setPlayerIFrames(code, id, value),
            () => this._respawnAfterFreeze(roomCode, playerId, io)
        );
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
        
        // Get new spawn position
        const spawnPos = positionManager.findFreeSpawnPosition(roomCode, playerId, room.players);
        
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
