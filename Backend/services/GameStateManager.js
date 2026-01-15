/**
 * Game State Management Service
 * Handles player positions and game state synchronization
 */

import roomManager from './RoomManager.js';
import { GAME_CONFIG } from '../config/constants.js';

class GameStateManager {
    constructor() {
        // Store player positions: roomCode -> { playerId -> { x, y, timestamp, ... } }
        this.playerPositions = new Map();
        
        // Throttle tracking: socketId -> lastUpdateTime
        this.lastUpdateTime = new Map();
    }

    /**
     * Initialize game state for a room
     * @param {string} roomCode - Room code
     */
    initializeRoom(roomCode) {
        if (!this.playerPositions.has(roomCode)) {
            this.playerPositions.set(roomCode, new Map());
        }
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

        // Store position with timestamp
        const positionState = {
            ...validatedPosition,
            playerId: playerId,
            timestamp: now
        };

        const roomPositions = this.playerPositions.get(roomCode);
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

        const { x, y } = positionData;
        const { MIN_X, MAX_X, MIN_Y, MAX_Y } = GAME_CONFIG.POSITION_VALIDATION;

        // Clamp position to valid range
        const validated = {
            x: Math.max(MIN_X, Math.min(MAX_X, x)),
            y: Math.max(MIN_Y, Math.min(MAX_Y, y))
        };

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
