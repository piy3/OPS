/**
 * Powerup Manager
 * Handles powerup spawning, collection, activation, and expiration
 */

import { SOCKET_EVENTS, POWERUP_CONFIG, GAME_PHASE } from '../../config/constants.js';
import log from '../../utils/logger.js';

class PowerupManager {
    constructor() {
        // Track powerups in each room: roomCode -> Map<powerupId, { row, col, type, collected }>
        this.roomPowerups = new Map();
        
        // Track powerup spawn timers: roomCode -> timeoutId
        this.powerupSpawnTimers = new Map();
        
        // Track active immunity effects: playerId -> { endTime, timeoutId }
        this.playerImmunity = new Map();
        
        // Track powerup pickup locks: `roomCode:powerupId` -> playerId
        this.powerupLocks = new Map();
        
        // Store mapConfig per room for spawn filtering
        this.roomMapConfigs = new Map();
    }

    /**
     * Start spawning powerups for a room
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {Function} getGamePhase - Callback to get current game phase
     * @param {Object} mapConfig - Room's map configuration (optional)
     */
    startSpawning(roomCode, io, getGamePhase, mapConfig = null) {
        this.roomPowerups.set(roomCode, new Map());
        this.roomMapConfigs.set(roomCode, mapConfig);
        this.schedulePowerupSpawn(roomCode, io, getGamePhase);
    }

    /**
     * Schedule next powerup spawn
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {Function} getGamePhase - Callback to get current game phase
     */
    schedulePowerupSpawn(roomCode, io, getGamePhase) {
        // Clear existing timer
        if (this.powerupSpawnTimers.has(roomCode)) {
            clearTimeout(this.powerupSpawnTimers.get(roomCode));
        }

        // Random interval
        const interval = POWERUP_CONFIG.SPAWN_INTERVAL_MIN + 
            Math.random() * (POWERUP_CONFIG.SPAWN_INTERVAL_MAX - POWERUP_CONFIG.SPAWN_INTERVAL_MIN);

        const timeoutId = setTimeout(() => {
            this.spawnPowerup(roomCode, io, getGamePhase);
        }, interval);

        this.powerupSpawnTimers.set(roomCode, timeoutId);
    }

    /**
     * Spawn a powerup
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {Function} getGamePhase - Callback to get current game phase
     */
    spawnPowerup(roomCode, io, getGamePhase) {
        // Check if still in Hunt phase
        if (getGamePhase(roomCode) !== GAME_PHASE.HUNT) {
            return;
        }

        const powerupMap = this.roomPowerups.get(roomCode);
        if (!powerupMap) return;

        // Check max powerups
        const activePowerups = Array.from(powerupMap.values()).filter(p => !p.collected);
        if (activePowerups.length >= POWERUP_CONFIG.MAX_POWERUPS) {
            this.schedulePowerupSpawn(roomCode, io, getGamePhase);
            return;
        }

        // Get stored mapConfig for this room
        const mapConfig = this.roomMapConfigs.get(roomCode);
        const mapWidth = mapConfig?.width ?? 30;
        const mapHeight = mapConfig?.height ?? 30;

        // Find available slot
        const usedPositions = new Set();
        powerupMap.forEach(p => {
            if (!p.collected) {
                usedPositions.add(`${p.row},${p.col}`);
            }
        });

        // Filter slots to be within map bounds, then exclude used positions
        const validSlots = (mapConfig?.powerupSpawnSlots ?? POWERUP_CONFIG.SPAWN_SLOTS).filter(
            slot => slot.row < mapHeight - 1 && slot.col < mapWidth - 1
        );
        
        const availableSlots = validSlots.filter(
            slot => !usedPositions.has(`${slot.row},${slot.col}`)
        );

        if (availableSlots.length === 0) {
            this.schedulePowerupSpawn(roomCode, io, getGamePhase);
            return;
        }

        // Pick random slot
        const slot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
        
        // Create powerup
        const powerupId = `powerup_${Date.now()}`;
        const powerup = {
            id: powerupId,
            row: slot.row,
            col: slot.col,
            type: 'immunity',
            collected: false
        };

        powerupMap.set(powerupId, powerup);

        // Notify clients
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.POWERUP_SPAWNED, {
            id: powerupId,
            row: slot.row,
            col: slot.col,
            type: 'immunity'
        });

        // Schedule next spawn
        this.schedulePowerupSpawn(roomCode, io, getGamePhase);
    }

    /**
     * Check if player can collect a powerup at position
     * @param {string} roomCode - Room code
     * @param {Object} position - Player position { row, col }
     * @returns {string|null} Powerup ID if collectible, null otherwise
     */
    getCollectiblePowerupAtPosition(roomCode, position) {
        const powerupMap = this.roomPowerups.get(roomCode);
        if (!powerupMap) return null;

        for (const [powerupId, powerup] of powerupMap) {
            if (powerup.collected) continue;

            const rowDiff = Math.abs(position.row - powerup.row);
            const colDiff = Math.abs(position.col - powerup.col);
            
            if (rowDiff <= POWERUP_CONFIG.COLLECTION_RADIUS && colDiff <= POWERUP_CONFIG.COLLECTION_RADIUS) {
                return powerupId;
            }
        }

        return null;
    }

    /**
     * Collect a powerup with race condition prevention
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} powerupId - Powerup ID
     * @param {string} playerName - Player name
     * @param {Object} io - Socket.IO server
     * @param {Function} setPlayerImmunity - Callback to set player immunity
     * @returns {boolean} True if collection was successful
     */
    collectPowerup(roomCode, playerId, powerupId, playerName, io, setPlayerImmunity) {
        const lockKey = `${roomCode}:${powerupId}`;
        
        // Race condition check
        if (this.powerupLocks.has(lockKey)) {
            return false;
        }

        const powerupMap = this.roomPowerups.get(roomCode);
        if (!powerupMap) return false;

        const powerup = powerupMap.get(powerupId);
        if (!powerup || powerup.collected) return false;

        // Acquire lock
        this.powerupLocks.set(lockKey, playerId);

        try {
            if (powerup.collected) {
                return false;
            }

            powerup.collected = true;

            // Notify clients
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.POWERUP_COLLECTED, {
                powerupId: powerupId,
                playerId: playerId,
                playerName: playerName,
                type: powerup.type,
                row: powerup.row,
                col: powerup.col
            });

            // Activate effect
            this.activatePowerup(roomCode, playerId, playerName, powerup.type, io, setPlayerImmunity);

            // Remove from map
            powerupMap.delete(powerupId);

            return true;
        } finally {
            this.powerupLocks.delete(lockKey);
        }
    }

    /**
     * Activate a powerup effect
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} playerName - Player name
     * @param {string} type - Powerup type
     * @param {Object} io - Socket.IO server
     * @param {Function} setPlayerImmunity - Callback to set player immunity
     */
    activatePowerup(roomCode, playerId, playerName, type, io, setPlayerImmunity) {
        if (type === 'immunity') {
            const duration = POWERUP_CONFIG.TYPES.IMMUNITY.duration;

            // Clear existing immunity
            const existingImmunity = this.playerImmunity.get(playerId);
            if (existingImmunity?.timeoutId) {
                clearTimeout(existingImmunity.timeoutId);
            }

            // Set immunity
            setPlayerImmunity(roomCode, playerId, true);

            // Notify clients
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.POWERUP_ACTIVATED, {
                playerId: playerId,
                playerName: playerName,
                type: 'immunity',
                duration: duration,
                visual: POWERUP_CONFIG.TYPES.IMMUNITY.visual
            });

            // Set expiration timer
            const timeoutId = setTimeout(() => {
                this.expirePowerup(roomCode, playerId, 'immunity', io, setPlayerImmunity);
            }, duration);

            this.playerImmunity.set(playerId, {
                endTime: Date.now() + duration,
                timeoutId: timeoutId
            });
        }
    }

    /**
     * Expire a powerup effect
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} type - Powerup type
     * @param {Object} io - Socket.IO server
     * @param {Function} setPlayerImmunity - Callback to set player immunity
     */
    expirePowerup(roomCode, playerId, type, io, setPlayerImmunity) {
        if (type === 'immunity') {
            setPlayerImmunity(roomCode, playerId, false);
            this.playerImmunity.delete(playerId);

            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.POWERUP_EXPIRED, {
                playerId: playerId,
                playerName: 'Unknown', // Will be overwritten by caller if needed
                type: 'immunity'
            });
        }
    }

    /**
     * Get all active powerups in a room
     * @param {string} roomCode - Room code
     * @returns {Array} Array of powerup objects
     */
    getActivePowerups(roomCode) {
        const powerupMap = this.roomPowerups.get(roomCode);
        if (!powerupMap) return [];

        return Array.from(powerupMap.values())
            .filter(powerup => !powerup.collected)
            .map(powerup => ({
                id: powerup.id,
                row: powerup.row,
                col: powerup.col,
                type: powerup.type
            }));
    }

    /**
     * Clean up player's immunity effect
     * @param {string} playerId - Player ID
     */
    cleanupPlayerImmunity(playerId) {
        const immunity = this.playerImmunity.get(playerId);
        if (immunity?.timeoutId) {
            clearTimeout(immunity.timeoutId);
        }
        this.playerImmunity.delete(playerId);
    }

    /**
     * Clean up powerups for a room
     * @param {string} roomCode - Room code
     */
    cleanupRoom(roomCode) {
        // Clear spawn timer
        const timerId = this.powerupSpawnTimers.get(roomCode);
        if (timerId) {
            clearTimeout(timerId);
            this.powerupSpawnTimers.delete(roomCode);
        }

        // Clear powerup map
        this.roomPowerups.delete(roomCode);
        this.roomMapConfigs.delete(roomCode);

        // Clear locks
        for (const lockKey of this.powerupLocks.keys()) {
            if (lockKey.startsWith(`${roomCode}:`)) {
                this.powerupLocks.delete(lockKey);
            }
        }
    }
}

export default new PowerupManager();
