/**
 * Game State Management Service
 * Handles player positions and game state synchronization
 */

import roomManager from './RoomManager.js';
import { GAME_CONFIG } from '../config/constants.js';

class GameStateManager {
    constructor() {
        // Store player positions: roomCode -> { playerId -> { x, y, timestamp, row, col, ... } }
        this.playerPositions = new Map();
        
        // Throttle tracking: socketId -> lastUpdateTime
        this.lastUpdateTime = new Map();
        
        // Track last grid positions for wrap-around detection: playerId -> { row, col }
        this.lastGridPositions = new Map();
    }

    /**
     * Initialize game state for a room and assign spawn positions
     * @param {string} roomCode - Room code
     */
    initializeRoom(roomCode) {
        if (!this.playerPositions.has(roomCode)) {
            this.playerPositions.set(roomCode, new Map());
        }

        // Assign fixed corner spawn positions to all players in the room
        const room = roomManager.getRoom(roomCode);
        if (!room || !room.players) {
            return;
        }

        const spawnPositions = GAME_CONFIG.SPAWN_POSITIONS;

        // Assign spawn positions to each player based on their index
        // Each player gets a different corner (cycles if more than 4 players)
        room.players.forEach((player, index) => {
            const spawnIndex = index % spawnPositions.length;
            const spawnPos = spawnPositions[spawnIndex];

            // Initialize player position at spawn point
            // Note: x, y will be calculated on the client side from row/col
            // We just store row/col here
            const positionState = {
                x: 0, // Will be calculated on client
                y: 0, // Will be calculated on client
                row: spawnPos.row,
                col: spawnPos.col,
                playerId: player.id,
                timestamp: Date.now(),
                isWrap: false
            };

            const roomPositions = this.playerPositions.get(roomCode);
            roomPositions.set(player.id, positionState);
            this.lastGridPositions.set(player.id, { row: spawnPos.row, col: spawnPos.col });
        });
    }

    /**
     * Clean up game state for a room
     * @param {string} roomCode - Room code
     */
    cleanupRoom(roomCode) {
        this.playerPositions.delete(roomCode);
    }

    /**
     * Update player position with rate limiting and validation
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {Object} positionData - Position data { x, y, angle?, velocity?, ... }
     * @returns {Object|null} Updated position or null if throttled/invalid
     */
    updatePlayerPosition(roomCode, playerId, positionData) {
        const room = roomManager.getRoom(roomCode); // redundant
        if (!room) return null;

        // Initialize room state if needed
        this.initializeRoom(roomCode);

        // Rate limiting: Check if update is too frequent
        const now = Date.now();
        const lastUpdate = this.lastUpdateTime.get(playerId) || 0;
        const timeSinceLastUpdate = now - lastUpdate;

        if (timeSinceLastUpdate < GAME_CONFIG.POSITION_UPDATE_INTERVAL) {
            return null; // Throttled
        }

        // Validate position data
        const validatedPosition = this.validatePosition(positionData);
        if (!validatedPosition) {
            return null; // Invalid position
        }

        // Get last grid position for wrap detection
        const lastGridPos = this.lastGridPositions.get(playerId) || { row: validatedPosition.row, col: validatedPosition.col };
        const currentGridPos = { row: validatedPosition.row, col: validatedPosition.col };
        
        // Detect wrap-around: if row/col are provided and changed significantly, it's a wrap
        // This helps remote clients detect wraps properly
        let isWrap = false;
        if (typeof validatedPosition.row === 'number' && typeof validatedPosition.col === 'number') {
            const colDiff = validatedPosition.col - lastGridPos.col;
            // Detect wrap: column jumps from high to low or low to high
            if (Math.abs(colDiff) > 16) { // More than half the maze width (32/2 = 16)
                isWrap = true;
            }
        }

        // Store position with timestamp and wrap flag
        const positionState = {
            ...validatedPosition,
            playerId: playerId,
            timestamp: now,
            isWrap: isWrap // Flag to help clients handle wrap smoothly
        };

        const roomPositions = this.playerPositions.get(roomCode);
        roomPositions.set(playerId, positionState);
        this.lastUpdateTime.set(playerId, now);
        
        // Update last grid position
        if (typeof validatedPosition.row === 'number' && typeof validatedPosition.col === 'number') {
            this.lastGridPositions.set(playerId, { row: validatedPosition.row, col: validatedPosition.col });
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
        const { MIN_X, MAX_X, MIN_Y, MAX_Y } = GAME_CONFIG.POSITION_VALIDATION;

        // For wrap-around positions, don't clamp X values as they may be outside normal range
        // The frontend sends adjusted X values for smooth wrap-around animation
        // Only clamp Y values and validate X is a number
        const validated = {
            x: x, // Preserve X value (may be outside normal range for wrap-around)
            y: Math.max(MIN_Y, Math.min(MAX_Y, y))
        };

        // Preserve row and col if provided (needed for wrap-around detection)
        if (typeof row === 'number') {
            validated.row = row;
        }
        if (typeof col === 'number') {
            validated.col = col;
        }

        return validated;
    }

    /**
     * Get all player positions in a room
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
     * Get position of a specific player
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @returns {Object|null} Player position or null
     */
    getPlayerPosition(roomCode, playerId) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return null;

        return roomPositions.get(playerId) || null;
    }

    /**
     * Remove player position (when they leave/disconnect)
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     */
    removePlayerPosition(roomCode, playerId) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            roomPositions.delete(playerId);
        }
        this.lastUpdateTime.delete(playerId);
        this.lastGridPositions.delete(playerId);
    }

    /**
     * Get full game state for synchronization
     * @param {string} roomCode - Room code
     * @returns {Object} Complete game state
     */
    getGameState(roomCode) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return null;

        return {
            roomCode: roomCode,
            players: room.players.map(player => ({
                id: player.id,
                name: player.name,
                position: this.getPlayerPosition(roomCode, player.id)
            })),
            timestamp: Date.now()
        };
    }

    /**
     * Clear all positions for a room (when game ends)
     * @param {string} roomCode - Room code
     */
    clearRoomState(roomCode) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            // Clear all player update times for this room
            roomPositions.forEach((_, playerId) => {
                this.lastUpdateTime.delete(playerId);
            });
        }
        this.playerPositions.delete(roomCode);
    }
}

// Export singleton instance
export default new GameStateManager();
