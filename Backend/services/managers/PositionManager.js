/**
 * Position Manager
 * Handles player positions, validation, spawn positions, and path calculations
 */

import { GAME_CONFIG, MAZE_CONFIG, hasWrapAround } from '../../config/constants.js';
import log from '../../utils/logger.js';

class PositionManager {
    constructor() {
        // Store player positions: roomCode -> { playerId -> { x, y, timestamp, row, col, ... } }
        this.playerPositions = new Map();
        
        // Throttle tracking: socketId -> lastUpdateTime
        this.lastUpdateTime = new Map();
        
        // Track last grid positions for wrap-around detection: playerId -> { row, col }
        this.lastGridPositions = new Map();
        
        // Track recently respawned players: playerId -> timestamp (ignore their position updates briefly)
        this.respawnedPlayers = new Map();
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
     */
    assignSpawnPositions(roomCode, players) {
        this.initializeRoom(roomCode);
        
        const spawnPositions = GAME_CONFIG.SPAWN_POSITIONS;
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

            // Fallback if all predefined positions are used
            if (!spawnPos) {
                const fallbackIndex = usedSpawnPositions.size % spawnPositions.length;
                const basePos = spawnPositions[fallbackIndex];
                const offset = Math.floor(usedSpawnPositions.size / spawnPositions.length) * 2;
                spawnPos = {
                    row: Math.min(26, basePos.row + offset),
                    col: Math.min(30, basePos.col + (offset % 2 === 0 ? 1 : -1))
                };
                usedSpawnPositions.add(`${spawnPos.row},${spawnPos.col}`);
            }

            // Initialize player position
            const positionState = {
                x: 0,
                y: 0,
                row: spawnPos.row,
                col: spawnPos.col,
                playerId: player.id,
                timestamp: Date.now(),
                isWrap: false
            };

            roomPositions.set(player.id, positionState);
            this.lastGridPositions.set(player.id, { row: spawnPos.row, col: spawnPos.col });
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
            if (timeSinceRespawn < 500) {
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
            if (timeSinceRespawn < 500) {
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

        // Get last position for wrap detection
        const lastGridPos = this.lastGridPositions.get(playerId) || { 
            row: validatedPosition.row, 
            col: validatedPosition.col 
        };
        
        // Detect wrap-around
        let isWrap = false;
        if (typeof validatedPosition.row === 'number' && typeof validatedPosition.col === 'number') {
            const colDiff = validatedPosition.col - lastGridPos.col;
            if (Math.abs(colDiff) > 16) {
                isWrap = true;
            }
        }

        // Store position
        const positionState = {
            ...validatedPosition,
            playerId: playerId,
            timestamp: now,
            isWrap: isWrap,
            isUnicorn: isUnicorn
        };

        roomPositions.set(playerId, positionState);
        this.lastUpdateTime.set(playerId, now);
        
        // Update last grid position
        if (typeof validatedPosition.row === 'number' && typeof validatedPosition.col === 'number') {
            this.lastGridPositions.set(playerId, { 
                row: validatedPosition.row, 
                col: validatedPosition.col 
            });
        }

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

        if (typeof row === 'number') validated.row = row;
        if (typeof col === 'number') validated.col = col;

        return validated;
    }

    /**
     * Get all cells in a path from old position to new position
     * Uses Bresenham's line algorithm, with special handling for tunnel wrap-around
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
        
        // Special handling for tunnel wrap-around rows
        // When moving horizontally on a wrap-around row and the shortest path is through the tunnel,
        // only return the start and end positions (they are adjacent through the tunnel)
        if (startRow === endRow && hasWrapAround(startRow)) {
            const colDiff = Math.abs(endCol - startCol);
            // If colDiff > half the maze width, the shortest path is through the tunnel
            if (colDiff > MAZE_CONFIG.MAZE_COLS / 2) {
                // Movement is through the tunnel - only the two cells are in the path
                return [
                    { row: startRow, col: startCol },
                    { row: endRow, col: endCol }
                ];
            }
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
     * Handles wrap-around adjacency for tunnel rows (col 0 and col 31 are adjacent)
     * @param {Object} pos1 - First position
     * @param {Object} pos2 - Second position
     * @returns {boolean} True if adjacent
     */
    isAdjacent(pos1, pos2) {
        if (!pos1 || !pos2) return false;
        
        const rowDiff = Math.abs(pos1.row - pos2.row);
        let colDiff = Math.abs(pos1.col - pos2.col);
        
        // Check for wrap-around adjacency on tunnel rows
        // If both positions are on the same wrap-around row and one is at col 0 and the other at col 31
        if (rowDiff === 0 && hasWrapAround(pos1.row)) {
            // Calculate wrapped column difference
            const wrappedColDiff = MAZE_CONFIG.MAZE_COLS - colDiff;
            colDiff = Math.min(colDiff, wrappedColDiff);
        }
        
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
        
        if (position.row !== undefined && position.col !== undefined) {
            this.lastGridPositions.set(playerId, { row: position.row, col: position.col });
        }
        
        // Mark as recently respawned
        this.respawnedPlayers.set(playerId, Date.now());
    }

    /**
     * Find a free spawn position not occupied by any player
     * @param {string} roomCode - Room code
     * @param {string} excludePlayerId - Player ID to exclude
     * @param {Array} players - Array of players in room
     * @returns {Object} Free spawn position { row, col }
     */
    findFreeSpawnPosition(roomCode, excludePlayerId = null, players = []) {
        const spawnPositions = GAME_CONFIG.SPAWN_POSITIONS;
        
        // Collect occupied positions
        const occupiedPositions = new Set();
        for (const player of players) {
            if (player.id === excludePlayerId) continue;
            
            const playerPos = this.getPlayerPosition(roomCode, player.id);
            if (playerPos) {
                occupiedPositions.add(`${playerPos.row},${playerPos.col}`);
            }
        }
        
        // Try each spawn position
        for (const spawnPos of spawnPositions) {
            const posKey = `${spawnPos.row},${spawnPos.col}`;
            if (!occupiedPositions.has(posKey)) {
                return spawnPos;
            }
        }
        
        // Fallback positions
        const fallbackPositions = [
            { row: 1, col: 8 }, { row: 1, col: 12 }, { row: 1, col: 20 }, { row: 1, col: 24 },
            { row: 4, col: 1 }, { row: 4, col: 12 }, { row: 4, col: 19 }, { row: 4, col: 30 },
            { row: 22, col: 8 }, { row: 22, col: 12 }, { row: 22, col: 20 }, { row: 22, col: 24 },
            { row: 26, col: 8 }, { row: 26, col: 12 }, { row: 26, col: 20 }, { row: 26, col: 24 }
        ];
        
        for (const fallbackPos of fallbackPositions) {
            const posKey = `${fallbackPos.row},${fallbackPos.col}`;
            if (!occupiedPositions.has(posKey)) {
                return fallbackPos;
            }
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
        this.lastGridPositions.delete(playerId);
        this.respawnedPlayers.delete(playerId);
    }

    /**
     * Clean up room data
     * @param {string} roomCode - Room code
     */
    cleanupRoom(roomCode) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            roomPositions.forEach((_, playerId) => {
                this.lastUpdateTime.delete(playerId);
                this.lastGridPositions.delete(playerId);
                this.respawnedPlayers.delete(playerId);
            });
        }
        this.playerPositions.delete(roomCode);
    }
}

export default new PositionManager();
