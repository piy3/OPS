/**
 * Position Manager
 * Handles player positions, validation, spawn positions, and path calculations
 */

import { GAME_CONFIG, MAZE_CONFIG } from '../../config/constants.js';
import log from '../../utils/logger.js';

const TILE_SIZE = MAZE_CONFIG.TILE_SIZE;

class PositionManager {
    constructor() {
        // Store player positions: roomCode -> { playerId -> { x, y, timestamp, row, col, ... } }
        this.playerPositions = new Map();
        
        // Throttle tracking: socketId -> lastUpdateTime
        this.lastUpdateTime = new Map();
        
        // Track recently respawned players: playerId -> timestamp (ignore their position updates briefly)
        this.respawnedPlayers = new Map();

        this.lastMoveWasTeleport = new Map(); // roomCode -> set of PlyerId
    }

    /**
     * Initialize room positions map
     * @param {string} roomCode - Room code
     */
    initializeRoom(roomCode) {
        if (!this.playerPositions.has(roomCode)) {
            this.playerPositions.set(roomCode, new Map());
        }
    }

    /**
     * Assign spawn positions to players
     * @param {string} roomCode - Room code
     * @param {Array} players - Array of player objects
     * @param {Object} mapConfig - Optional map configuration with spawnPositions
     */
    assignSpawnPositions(roomCode, players, mapConfig = null) {
        this.initializeRoom(roomCode);
        
        // Use mapConfig spawn positions if available, otherwise fall back to default
        const spawnPositions = mapConfig?.spawnPositions || GAME_CONFIG.SPAWN_POSITIONS;
        const mapSize = mapConfig?.width || 30;
        const maxCoord = mapSize - 6; // Leave border room
        
        const roomPositions = this.playerPositions.get(roomCode);

        // Track which spawn positions are already used
        const usedSpawnPositions = new Set();

        // Mark positions that are already occupied
        roomPositions.forEach((position) => {
            const posKey = `${position.row},${position.col}`;
            usedSpawnPositions.add(posKey);
        });

        // Assign unique spawn positions to each player
        players.forEach((player) => {
            // Skip if player already has a position
            if (roomPositions.has(player.id)) {
                return;
            }

            // Find first available spawn position
            let spawnPos = null;
            for (const pos of spawnPositions) {
                const posKey = `${pos.row},${pos.col}`;
                if (!usedSpawnPositions.has(posKey)) {
                    spawnPos = pos;
                    usedSpawnPositions.add(posKey);
                    break;
                }
            }

            // Fallback if all predefined positions are used: pick next valid road intersection (row,col multiples of 4)
            if (!spawnPos) {
                const MIN_COORD = 4;
                for (let r = MIN_COORD; r <= maxCoord; r += 4) {
                    for (let c = MIN_COORD; c <= maxCoord; c += 4) {
                        const posKey = `${r},${c}`;
                        if (!usedSpawnPositions.has(posKey)) {
                            spawnPos = { row: r, col: c };
                            usedSpawnPositions.add(posKey);
                            break;
                        }
                    }
                    if (spawnPos) break;
                }
                if (!spawnPos) {
                    // Extremely unlikely: reuse first predefined spawn
                    spawnPos = spawnPositions[0];
                    usedSpawnPositions.add(`${spawnPos.row},${spawnPos.col}`);
                }
            }

            // Initialize player position
            const positionState = {
                x: null,
                y: null,
                row: spawnPos.row,
                col: spawnPos.col,
                playerId: player.id,
                timestamp: Date.now(),
            };

            roomPositions.set(player.id, positionState);
        });
    }

    /**
     * Quick check if position update would be throttled
     * Call this BEFORE doing any heavy work (room lookup, collision detection, etc.)
     * @param {string} playerId - Player ID
     * @returns {boolean} True if update would be throttled (should skip)
     */
    isThrottled(playerId) {
        const now = Date.now();
        const lastUpdate = this.lastUpdateTime.get(playerId) || 0;
        const timeSinceLastUpdate = now - lastUpdate;
        
        // Throttle check
        if (timeSinceLastUpdate < GAME_CONFIG.POSITION_UPDATE_INTERVAL) {
            return true;
        }
        
        // Check respawn cooldown
        const respawnTime = this.respawnedPlayers.get(playerId);
        if (respawnTime) {
            const timeSinceRespawn = now - respawnTime;
            if (timeSinceRespawn < 100) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Update player position with rate limiting
     * NOTE: Caller should use isThrottled() first to avoid unnecessary work
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} positionData - Position data
     * @param {boolean} isUnicorn - Whether player is unicorn
     * @returns {Object|null} Updated position or null if throttled/invalid
     */
    updatePosition(roomCode, playerId, positionData, isUnicorn = false) {
        // Rate limiting (redundant if caller used isThrottled, but kept for safety)
        const now = Date.now();
        const lastUpdate = this.lastUpdateTime.get(playerId) || 0;
        const timeSinceLastUpdate = now - lastUpdate;

        if (timeSinceLastUpdate < GAME_CONFIG.POSITION_UPDATE_INTERVAL) {
            return null; // Throttled
        }

        // Clear respawn cooldown if expired
        const respawnTime = this.respawnedPlayers.get(playerId);
        if (respawnTime) {
            const timeSinceRespawn = now - respawnTime;
            if (timeSinceRespawn < 100) {
                return null;
            }
            this.respawnedPlayers.delete(playerId);
        }

        // Validate position
        const validatedPosition = this.validatePosition(positionData);
        if (!validatedPosition) {
            return null;
        }

        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return null;

        // Store position
        const positionState = {
            ...validatedPosition,
            playerId: playerId,
            timestamp: now,
            isUnicorn: isUnicorn
        };

        roomPositions.set(playerId, positionState);
        this.lastUpdateTime.set(playerId, now);

        return positionState;
    }

    /**
     * Validate position data
     * @param {Object} positionData - Position data to validate
     * @returns {Object|null} Validated position or null
     */
    validatePosition(positionData) {
        if (!positionData || typeof positionData.x !== 'number' || typeof positionData.y !== 'number') {
            return null;
        }

        const { x, y, row, col } = positionData;
        const { MIN_Y, MAX_Y } = GAME_CONFIG.POSITION_VALIDATION;

        const validated = {
            x: x,
            y: Math.max(MIN_Y, Math.min(MAX_Y, y))
        };

        if (typeof row === 'number' && !Number.isNaN(row)) validated.row = row;
        if (typeof col === 'number' && !Number.isNaN(col)) validated.col = col;
        if (typeof validated.row !== 'number' || Number.isNaN(validated.row)) {
            validated.row = Math.floor(validated.y / TILE_SIZE);
        }
        if (typeof validated.col !== 'number' || Number.isNaN(validated.col)) {
            validated.col = Math.floor(validated.x / TILE_SIZE);
        }

        return validated;
    }

    /**
     * Get all cells in a path from old position to new position
     * @param {Object} oldPos - Old position { row, col }
     * @param {Object} newPos - New position { row, col }
     * @returns {Array} Array of cells in the path
     */
    getCellsInPath(oldPos, newPos) {
        const cells = [];
        
        if (!oldPos || !newPos) {
            return newPos ? [newPos] : [];
        }
        
        const startRow = oldPos.row;
        const startCol = oldPos.col;
        const endRow = newPos.row;
        const endCol = newPos.col;
        
        if (startRow === endRow && startCol === endCol) {
            return [{ row: endRow, col: endCol }];
        }
        
        // Bresenham's line algorithm for normal movement
        let row = startRow;
        let col = startCol;
        const dRow = Math.abs(endRow - startRow);
        const dCol = Math.abs(endCol - startCol);
        const sRow = startRow < endRow ? 1 : -1;
        const sCol = startCol < endCol ? 1 : -1;
        let err = dCol - dRow;
        
        while (true) {
            cells.push({ row, col });
            
            if (row === endRow && col === endCol) break;
            
            const e2 = 2 * err;
            if (e2 > -dRow) {
                err -= dRow;
                col += sCol;
            }
            if (e2 < dCol) {
                err += dCol;
                row += sRow;
            }
        }
        
        return cells;
    }

    /**
     * Check if two positions are adjacent
     * @param {Object} pos1 - First position
     * @param {Object} pos2 - Second position
     * @returns {boolean} True if adjacent
     */
    isAdjacent(pos1, pos2) {
        if (!pos1 || !pos2) return false;
        
        const rowDiff = Math.abs(pos1.row - pos2.row);
        let colDiff = Math.abs(pos1.col - pos2.col);
        
        return rowDiff <= 1 && colDiff <= 1 && !(rowDiff === 0 && colDiff === 0);
    }

    /**
     * Get player position
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @returns {Object|null} Player position or null
     */
    getPlayerPosition(roomCode, playerId) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return null;
        return roomPositions.get(playerId) || null;
    }
    
    getLastMoveWasTeleport(roomCode, playerId){
        const lastTeleportPlayers = this.lastMoveWasTeleport.get(roomCode);
        return lastTeleportPlayers ? lastTeleportPlayers.has(playerId) : false;
    }

    /**
     * Get all positions in a room
     * @param {string} roomCode - Room code
     * @returns {Object} Map of playerId -> position
     */
    getRoomPositions(roomCode) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return {};

        const positions = {};
        roomPositions.forEach((position, playerId) => {
            positions[playerId] = position;
        });

        return positions;
    }

    /**
     * Set player position directly (for respawns)
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} position - Position object
     */
    setPlayerPosition(roomCode, playerId, position) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return;

        roomPositions.set(playerId, {
            ...position,
            playerId: playerId,
            timestamp: Date.now()
        });
        
        // Mark as recently respawned
        this.respawnedPlayers.set(playerId, Date.now());
    }

    setLastMoveWasTeleport(roomCode, playerId){
        let lastTeleportPlayers = this.lastMoveWasTeleport.get(roomCode);
        if (!lastTeleportPlayers) {
            lastTeleportPlayers = new Set();
            this.lastMoveWasTeleport.set(roomCode, lastTeleportPlayers);
        }
        lastTeleportPlayers.add(playerId);
    }

    clearLastMoveWasTeleport(roomCode, playerId){
        const lastMoveWasTeleport = this.lastMoveWasTeleport.get(roomCode);
        lastMoveWasTeleport.delete(playerId);
    }

    /**
     * Find a free spawn position not occupied by any player
     * @param {string} roomCode - Room code
     * @param {string} excludePlayerId - Player ID to exclude
     * @param {Array} players - Array of players in room
     * @param {Object} mapConfig - Optional map configuration with spawnPositions
     * @returns {Object} Free spawn position { row, col }
     */
    findFreeSpawnPosition(roomCode, excludePlayerId = null, players = [], mapConfig = null) {
        // Use mapConfig spawn positions if available, otherwise fall back to default
        const spawnPositions = mapConfig?.spawnPositions || GAME_CONFIG.SPAWN_POSITIONS;
        const mapSize = mapConfig?.width || 30;
        const maxCoord = mapSize - 6;
        
        // Collect occupied positions
        const occupiedPositions = new Set();
        for (const player of players) {
            if (player.id === excludePlayerId) continue;
            
            const playerPos = this.getPlayerPosition(roomCode, player.id);
            if (playerPos) {
                occupiedPositions.add(`${playerPos.row},${playerPos.col}`);
            }
        }
        
        // Collect all free predefined spawn positions, then pick one at random
        const freeSpawns = spawnPositions.filter(spawnPos => {
            const posKey = `${spawnPos.row},${spawnPos.col}`;
            return !occupiedPositions.has(posKey);
        });
        if (freeSpawns.length > 0) {
            return freeSpawns[Math.floor(Math.random() * freeSpawns.length)];
        }
        
        // Fallback: collect all free grid positions (road intersections), then pick one at random
        const freeGridPositions = [];
        for (let r = 8; r <= maxCoord; r += 4) {
            for (let c = 8; c <= maxCoord; c += 4) {
                const posKey = `${r},${c}`;
                if (!occupiedPositions.has(posKey)) {
                    freeGridPositions.push({ row: r, col: c });
                }
            }
        }
        if (freeGridPositions.length > 0) {
            return freeGridPositions[Math.floor(Math.random() * freeGridPositions.length)];
        }
        
        // Last resort: random predefined spawn
        return spawnPositions[Math.floor(Math.random() * spawnPositions.length)];
    }

    /**
     * Remove player position
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     */
    removePlayerPosition(roomCode, playerId) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            roomPositions.delete(playerId);
        }
        this.lastUpdateTime.delete(playerId);
        this.respawnedPlayers.delete(playerId);
    }

    /**
     * Update player's socket ID in position tracking (on reconnection)
     * Moves position data from old socket ID to new socket ID
     * @param {string} roomCode - Room code
     * @param {string} oldSocketId - Old socket ID
     * @param {string} newSocketId - New socket ID
     */
    updatePlayerSocketId(roomCode, oldSocketId, newSocketId) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return;

        // Move position data from old ID to new ID
        const position = roomPositions.get(oldSocketId);
        if (position) {
            roomPositions.delete(oldSocketId);
            roomPositions.set(newSocketId, position);
            log.info(`🔄 Updated position tracking: ${oldSocketId} -> ${newSocketId}`);
        }

        // Update throttle tracking
        const lastUpdate = this.lastUpdateTime.get(oldSocketId);
        if (lastUpdate !== undefined) {
            this.lastUpdateTime.delete(oldSocketId);
            this.lastUpdateTime.set(newSocketId, lastUpdate);
        }

        // Update respawned players tracking
        if (this.respawnedPlayers.has(oldSocketId)) {
            this.respawnedPlayers.delete(oldSocketId);
            this.respawnedPlayers.add(newSocketId);
        }
    }

    /**
     * Clean up room data
     * @param {string} roomCode - Room code
     */
    cleanupRoom(roomCode) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            roomPositions.forEach((_, playerId) => {
                this.respawnedPlayers.delete(playerId);
            });
        }
        this.playerPositions.delete(roomCode);
    }
}

export default new PositionManager();
