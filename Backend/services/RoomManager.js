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
                isHost: true,
                isUnicorn: false, // Will be assigned when game starts
                coins: 100 // Starting coins
            }],
            status: ROOM_STATUS.WAITING,
            createdAt: Date.now(),
            maxPlayers: playerData?.maxPlayers || ROOM_CONFIG.DEFAULT_MAX_PLAYERS,
            unicornId: null // Track current unicorn
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
            isHost: false,
            isUnicorn: false,
            coins: 100 // Starting coins
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
        const wasUnicorn = room.players[playerIndex].isUnicorn;
        room.players.splice(playerIndex, 1);

        let roomDeleted = false;
        let newHostId = null;
        let newUnicornId = null;

        // If host left and there are other players, assign new host
        if (wasHost && room.players.length > 0) {
            room.players[0].isHost = true;
            room.hostId = room.players[0].id;
            newHostId = room.players[0].id;
        }

        // If unicorn left and there are other players, assign new unicorn
        if (wasUnicorn && room.players.length > 0) {
            // Randomly select a new unicorn from remaining players
            const randomIndex = Math.floor(Math.random() * room.players.length);
            room.players[randomIndex].isUnicorn = true;
            room.unicornId = room.players[randomIndex].id;
            newUnicornId = room.players[randomIndex].id;
        }

        // If room is empty, delete it
        if (room.players.length === 0) {
            this.rooms.delete(roomCode);
            roomDeleted = true;
        }

        return {
            wasHost,
            wasUnicorn,
            roomDeleted,
            newHostId,
            newUnicornId,
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
        
        // Assign first player as unicorn when game starts
        if (room.players.length > 0 && !room.unicornId) {
            room.players[0].isUnicorn = true;
            room.unicornId = room.players[0].id;
        }
        
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

    /**
     * Transfer unicorn status to another player
     * @param {string} roomCode - Room code
     * @param {string} newUnicornId - Socket ID of new unicorn
     * @returns {Object|null} Updated room or null
     */
    transferUnicorn(roomCode, newUnicornId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        // Remove unicorn status from current unicorn
        const currentUnicorn = room.players.find(p => p.isUnicorn);
        if (currentUnicorn) {
            currentUnicorn.isUnicorn = false;
        }

        // Assign unicorn status to new player
        const newUnicorn = room.players.find(p => p.id === newUnicornId);
        if (newUnicorn) {
            newUnicorn.isUnicorn = true;
            room.unicornId = newUnicornId;
        }

        return room;
    }

    /**
     * Get current unicorn in room
     * @param {string} roomCode - Room code
     * @returns {Object|null} Unicorn player object or null
     */
    getUnicorn(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        return room.players.find(p => p.isUnicorn) || null;
    }

    /**
     * Update player coins
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {number} coinChange - Amount to change (positive or negative)
     * @returns {Object|null} Updated player object or null
     */
    updatePlayerCoins(roomCode, playerId, coinChange) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return null;

        player.coins = Math.max(0, player.coins + coinChange); // Don't allow negative coins
        return player;
    }

    /**
     * Get leaderboard sorted by coins
     * @param {string} roomCode - Room code
     * @returns {Array} Array of players sorted by coins (descending)
     */
    getLeaderboard(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return [];

        return [...room.players].sort((a, b) => b.coins - a.coins);
    }
}

// Export singleton instance
export default new RoomManager();
