/**
 * Room Management Service
 * Handles all room-related business logic
 */

import { ROOM_CONFIG, ROOM_STATUS } from '../config/constants.js';
import { generateRoomCode, generateDefaultPlayerName } from '../utils/roomUtils.js';

class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomCode -> room object
    }

    /**
     * Create a new room
     * @param {string} socketId - Socket ID of the host
     * @param {Object} playerData - Player data (name, maxPlayers)
     * @returns {Object} Created room object
     */
    createRoom(socketId, playerData = {}) {
        const roomCode = generateRoomCode(this.rooms);
        const room = {
            code: roomCode,
            hostId: socketId,
            players: [{
                id: socketId,
                name: playerData?.name || generateDefaultPlayerName(socketId),
                isHost: true
            }],
            status: ROOM_STATUS.WAITING,
            createdAt: Date.now(),
            maxPlayers: playerData?.maxPlayers || ROOM_CONFIG.DEFAULT_MAX_PLAYERS
        };

        this.rooms.set(roomCode, room);
        return room;
    }

    /**
     * Get room by code
     * @param {string} roomCode - Room code
     * @returns {Object|null} Room object or null if not found
     */
    getRoom(roomCode) {
        return this.rooms.get(roomCode) || null;
    }

    /**
     * Get room code for a socket
     * @param {string} socketId - Socket ID
     * @returns {string|null} Room code or null
     */
    getRoomCodeForSocket(socketId) {
        for (const [code, room] of this.rooms.entries()) {
            if (room.hostId === socketId || room.players.some(p => p.id === socketId)) {
                return code;
            }
        }
        return null;
    }

    /**
     * Validate if a player can join a room
     * @param {string} roomCode - Room code
     * @param {string} socketId - Socket ID
     * @returns {Object} { valid: boolean, error: string|null }
     */
    validateJoinRoom(roomCode, socketId) {
        if (!this.rooms.has(roomCode)) {
            return { valid: false, error: 'Room not found' };
        }

        const room = this.rooms.get(roomCode);

        if (room.players.length >= room.maxPlayers) {
            return { valid: false, error: 'Room is full' };
        }

        if (room.status === ROOM_STATUS.PLAYING) {
            return { valid: false, error: 'Game already in progress' };
        }

        if (room.players.some(p => p.id === socketId)) {
            return { valid: false, error: 'Already in this room' };
        }

        return { valid: true, error: null };
    }

    /**
     * Add player to room
     * @param {string} roomCode - Room code
     * @param {string} socketId - Socket ID
     * @param {string} playerName - Player name
     * @returns {Object} Player object
     */
    addPlayerToRoom(roomCode, socketId, playerName) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = {
            id: socketId,
            name: playerName || generateDefaultPlayerName(socketId),
            isHost: false
        };

        room.players.push(player);
        return player;
    }

    /**
     * Remove player from room
     * @param {string} roomCode - Room code
     * @param {string} socketId - Socket ID
     * @returns {Object} { wasHost: boolean, roomDeleted: boolean }
     */
    removePlayerFromRoom(roomCode, socketId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const playerIndex = room.players.findIndex(p => p.id === socketId);
        if (playerIndex === -1) return null;

        const wasHost = room.players[playerIndex].isHost;
        room.players.splice(playerIndex, 1);

        let roomDeleted = false;
        let newHostId = null;

        // If host left and there are other players, assign new host
        if (wasHost && room.players.length > 0) {
            room.players[0].isHost = true;
            room.hostId = room.players[0].id;
            newHostId = room.players[0].id;
        }

        // If room is empty, delete it
        if (room.players.length === 0) {
            this.rooms.delete(roomCode);
            roomDeleted = true;
        }

        return {
            wasHost,
            roomDeleted,
            newHostId,
            room: roomDeleted ? null : room
        };
    }

    /**
     * Validate if game can be started
     * @param {string} roomCode - Room code
     * @param {string} socketId - Socket ID
     * @returns {Object} { valid: boolean, error: string|null }
     */
    validateStartGame(roomCode, socketId) {
        const room = this.rooms.get(roomCode);
        if (!room) {
            return { valid: false, error: 'Room not found' };
        }

        if (room.hostId !== socketId) {
            return { valid: false, error: 'Only host can start the game' };
        }

        if (room.status === ROOM_STATUS.PLAYING) {
            return { valid: false, error: 'Game already started' };
        }

        if (room.players.length < ROOM_CONFIG.MIN_PLAYERS_TO_START) {
            return { valid: false, error: 'Need at least 2 players to start' };
        }

        return { valid: true, error: null };
    }

    /**
     * Start game in room
     * @param {string} roomCode - Room code
     * @returns {Object|null} Updated room object or null
     */
    startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        room.status = ROOM_STATUS.PLAYING;
        return room;
    }

    /**
     * Check if player is in a room
     * @param {string} socketId - Socket ID
     * @returns {boolean} True if player is in a room
     */
    isPlayerInRoom(socketId) {
        return this.getRoomCodeForSocket(socketId) !== null;
    }

    /**
     * Get all rooms (for debugging/admin purposes)
     * @returns {Array} Array of room objects
     */
    getAllRooms() {
        return Array.from(this.rooms.values());
    }
}

// Export singleton instance
export default new RoomManager();
