/**
 * Combat Manager
 * Handles combat, health, i-frames, knockback, freeze and respawn mechanics
 */

import { SOCKET_EVENTS, COMBAT_CONFIG, PLAYER_STATE } from '../../config/constants.js';
import log from '../../utils/logger.js';

class CombatManager {
    constructor() {
        // Track i-frames: playerId -> { endTime, timeoutId }
        this.playerIFrames = new Map();
        
        // Track frozen players: playerId -> { endTime, timeoutId }
        this.frozenPlayers = new Map();
        
        // Track knockback: playerId -> { direction, endTime }
        this.playerKnockbacks = new Map();

        // Track collision cooldowns: `${attackerId}-${victimId}` -> timestamp
        this.collisionCooldowns = new Map();
    }

    /**
     * Check if collision should be processed (rate limited)
     * @param {string} attackerId - Attacker player ID
     * @param {string} victimId - Victim player ID
     * @returns {boolean} True if collision should be processed
     */
    shouldProcessCollision(attackerId, victimId) {
        const collisionKey = `${attackerId}-${victimId}`;
        const now = Date.now();
        const lastCollision = this.collisionCooldowns.get(collisionKey);
        
        const COLLISION_COOLDOWN = 500;
        if (lastCollision && (now - lastCollision) < COLLISION_COOLDOWN) {
            return false;
        }
        
        // Cleanup old cooldowns
        if (this.collisionCooldowns.size > 100) {
            const cutoff = now - 5000;
            for (const [key, timestamp] of this.collisionCooldowns) {
                if (timestamp < cutoff) {
                    this.collisionCooldowns.delete(key);
                }
            }
        }
        
        return true;
    }

    /**
     * Set collision cooldown for a pair (call after a successful tag)
     * @param {string} attackerId - Attacker player ID
     * @param {string} victimId - Victim player ID
     */
    setCollisionCooldown(attackerId, victimId) {
        const collisionKey = `${attackerId}-${victimId}`;
        this.collisionCooldowns.set(collisionKey, Date.now());
    }

    /**
     * Validate if target can be hit
     * @param {Object} targetPlayer - Target player object
     * @param {string} targetPersistentId - Target persistent player ID
     * @returns {Object} { canHit: boolean, reason?: string }
     */
    canHitPlayer(targetPlayer, targetPersistentId) {
        if (targetPlayer.inIFrames || this.playerIFrames.has(targetPersistentId)) {
            return { canHit: false, reason: 'iframes' };
        }
        
        if (targetPlayer.state === PLAYER_STATE.FROZEN || this.frozenPlayers.has(targetPersistentId)) {
            return { canHit: false, reason: 'frozen' };
        }
        
        return { canHit: true };
    }

    /**
     * Grant invincibility frames to a player
     * @param {string} roomCode - Room code
     * @param {string} socketId - Player socket ID (for internal operations)
     * @param {string} persistentPlayerId - Persistent player ID (for events and tracking)
     * @param {Object} io - Socket.IO server
     * @param {Function} setPlayerIFrames - Callback to set player i-frames in room manager
     */
    grantIFrames(roomCode, socketId, persistentPlayerId, io, setPlayerIFrames) {
        setPlayerIFrames(roomCode, socketId, true);
        
        // Clear existing timeout (track by persistent playerId)
        const existing = this.playerIFrames.get(persistentPlayerId);
        if (existing?.timeoutId) {
            clearTimeout(existing.timeoutId);
        }

        const timeoutId = setTimeout(() => {
            setPlayerIFrames(roomCode, socketId, false);
            this.playerIFrames.delete(persistentPlayerId);
            
            if (io) {
                // Emit with persistent playerId for frontend identification
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_STATE_CHANGE, {
                    playerId: persistentPlayerId,
                    state: PLAYER_STATE.ACTIVE,
                    inIFrames: false
                });
            }
        }, COMBAT_CONFIG.IFRAME_DURATION);

        this.playerIFrames.set(persistentPlayerId, {
            endTime: Date.now() + COMBAT_CONFIG.IFRAME_DURATION,
            timeoutId: timeoutId,
            socketId: socketId  // Store socket ID for potential updates
        });
    }

    /**
     * Apply knockback to a player
     * @param {Object} victimPos - Victim position { row, col }
     * @param {Object} attackerPos - Attacker position { row, col }
     * @param {string} victimPersistentId - Victim persistent player ID
     * @returns {Object|null} Knockback data or null
     */
    applyKnockback(victimPos, attackerPos, victimPersistentId) {
        if (!victimPos || !attackerPos) return null;
        if (!COMBAT_CONFIG.KNOCKBACK_ENABLED) return null;

        // Calculate knockback direction (away from attacker)
        let knockbackDirection = { row: 0, col: 0 };
        
        if (victimPos.row !== attackerPos.row) {
            knockbackDirection.row = victimPos.row > attackerPos.row ? 1 : -1;
        }
        if (victimPos.col !== attackerPos.col) {
            knockbackDirection.col = victimPos.col > attackerPos.col ? 1 : -1;
        }
        
        // Default direction if same position
        if (knockbackDirection.row === 0 && knockbackDirection.col === 0) {
            knockbackDirection.col = 1;
        }

        // Calculate new position
        const newRow = victimPos.row + (knockbackDirection.row * COMBAT_CONFIG.KNOCKBACK_DISTANCE);
        const newCol = victimPos.col + (knockbackDirection.col * COMBAT_CONFIG.KNOCKBACK_DISTANCE);

        const knockbackData = {
            direction: knockbackDirection,
            fromRow: victimPos.row,
            fromCol: victimPos.col,
            toRow: newRow,
            toCol: newCol,
            duration: COMBAT_CONFIG.KNOCKBACK_DURATION
        };

        // Track knockback by persistent playerId
        this.playerKnockbacks.set(victimPersistentId, {
            direction: knockbackDirection,
            endTime: Date.now() + COMBAT_CONFIG.KNOCKBACK_DURATION
        });

        // Clear knockback after duration
        setTimeout(() => {
            this.playerKnockbacks.delete(victimPersistentId);
        }, COMBAT_CONFIG.KNOCKBACK_DURATION);

        return knockbackData;
    }

    /**
     * Handle player reaching zero health - freeze them
     * No longer starts a respawn timer - GameStateManager will start an unfreeze quiz instead
     * @param {string} roomCode - Room code
     * @param {string} socketId - Player socket ID (for internal operations)
     * @param {string} persistentPlayerId - Persistent player ID (for events and tracking)
     * @param {string} playerName - Player name
     * @param {Object} io - Socket.IO server
     * @param {Function} setPlayerState - Callback to set player state
     * @param {Function} setPlayerIFrames - Callback to set player i-frames
     */
    handleZeroHealth(roomCode, socketId, persistentPlayerId, playerName, io, setPlayerState, setPlayerIFrames) {
        // Set state to FROZEN (using socket ID for internal operation)
        setPlayerState(roomCode, socketId, PLAYER_STATE.FROZEN);
        
        // Clear i-frames (track by persistent playerId)
        const existingIFrames = this.playerIFrames.get(persistentPlayerId);
        if (existingIFrames?.timeoutId) {
            clearTimeout(existingIFrames.timeoutId);
            this.playerIFrames.delete(persistentPlayerId);
        }
        setPlayerIFrames(roomCode, socketId, false);

        // Notify clients - emit with persistent playerId for frontend identification
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_STATE_CHANGE, {
            playerId: persistentPlayerId,
            playerName: playerName,
            state: PLAYER_STATE.FROZEN
            // No freezeDuration - player must pass unfreeze quiz to respawn
        });

        // Track frozen state by persistent playerId (no timeout - quiz handles unfreeze)
        this.frozenPlayers.set(persistentPlayerId, {
            startTime: Date.now(),
            socketId: socketId
        });
    }

    /**
     * Clear frozen state for a player (called when unfreeze quiz passed or cancelled)
     * @param {string} persistentPlayerId - Persistent player ID
     */
    clearFrozenState(persistentPlayerId) {
        this.frozenPlayers.delete(persistentPlayerId);
    }

    /**
     * Check if player can move (not frozen)
     * @param {Object} player - Player object
     * @param {string} persistentPlayerId - Persistent player ID
     * @returns {boolean} True if player can move
     */
    canPlayerMove(player, persistentPlayerId) {
        if (!player) return false;
        
        if (player.state === PLAYER_STATE.FROZEN || this.frozenPlayers.has(persistentPlayerId)) {
            return false;
        }
        
        return true;
    }

    /**
     * Check if player is in knockback
     * @param {string} persistentPlayerId - Persistent player ID
     * @returns {boolean} True if in knockback
     */
    isInKnockback(persistentPlayerId) {
        return this.playerKnockbacks.has(persistentPlayerId);
    }

    /**
     * Clean up combat state for a player
     * @param {string} persistentPlayerId - Persistent player ID
     */
    cleanupPlayer(persistentPlayerId) {
        // Clear i-frames
        const iframes = this.playerIFrames.get(persistentPlayerId);
        if (iframes?.timeoutId) {
            clearTimeout(iframes.timeoutId);
        }
        this.playerIFrames.delete(persistentPlayerId);

        // Clear frozen state
        const frozen = this.frozenPlayers.get(persistentPlayerId);
        if (frozen?.timeoutId) {
            clearTimeout(frozen.timeoutId);
        }
        this.frozenPlayers.delete(persistentPlayerId);

        // Clear knockback
        this.playerKnockbacks.delete(persistentPlayerId);
    }

    /**
     * Clean up all combat state for a room's players
     * @param {Array} players - Array of players in room
     */
    cleanupRoom(players) {
        players.forEach(player => {
            // Use persistent playerId for cleanup
            this.cleanupPlayer(player.playerId);
        });
    }
}

export default new CombatManager();
