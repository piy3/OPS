/**
 * Room Management Service
 * Handles all room-related business logic
 */

import { ROOM_CONFIG, ROOM_STATUS, COMBAT_CONFIG, PLAYER_STATE, getNextAvailableCharacterId } from '../config/constants.js';

// Extract starting coins from config for easy reference
const STARTING_COINS = ROOM_CONFIG.STARTING_COINS;
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
                coins: STARTING_COINS, // Starting coins
                health: COMBAT_CONFIG.STARTING_HEALTH, // Starting health
                state: PLAYER_STATE.ACTIVE, // Player state
                isImmune: false, // Immunity powerup
                inIFrames: false, // Invincibility frames
                characterId: getNextAvailableCharacterId([]) // Assign first character (host is first player)
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
            coins: STARTING_COINS, // Starting coins
            health: COMBAT_CONFIG.STARTING_HEALTH, // Starting health
            state: PLAYER_STATE.ACTIVE, // Player state
            isImmune: false, // Immunity powerup
            inIFrames: false, // Invincibility frames
            characterId: getNextAvailableCharacterId(room.players) // Assign unique character
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
     * Resets all player coins to STARTING_COINS for a fresh leaderboard
     * @param {string} roomCode - Room code
     * @returns {Object|null} Updated room object or null
     */
    startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        room.status = ROOM_STATUS.PLAYING;
        
        // Reset all player coins to starting amount for the new game
        // This ensures the central leaderboard starts fresh for each game
        room.players.forEach(player => {
            player.coins = STARTING_COINS;
        });
        
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

    // ========== COMBAT SYSTEM METHODS ==========

    /**
     * Update player health
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {number} healthChange - Amount to change (positive or negative)
     * @returns {Object|null} Updated player object or null
     */
    updatePlayerHealth(roomCode, playerId, healthChange) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return null;

        // Clamp health between 0 and MAX_HEALTH
        player.health = Math.max(0, Math.min(COMBAT_CONFIG.MAX_HEALTH, player.health + healthChange));
        return player;
    }

    /**
     * Set player health to a specific value
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {number} health - New health value
     * @returns {Object|null} Updated player object or null
     */
    setPlayerHealth(roomCode, playerId, health) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return null;

        player.health = Math.max(0, Math.min(COMBAT_CONFIG.MAX_HEALTH, health));
        return player;
    }

    /**
     * Update player state
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {string} state - New state (ACTIVE, FROZEN, etc.)
     * @returns {Object|null} Updated player object or null
     */
    setPlayerState(roomCode, playerId, state) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return null;

        player.state = state;
        return player;
    }

    /**
     * Set player i-frames status
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {boolean} inIFrames - Whether player is in i-frames
     * @returns {Object|null} Updated player object or null
     */
    setPlayerIFrames(roomCode, playerId, inIFrames) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return null;

        player.inIFrames = inIFrames;
        return player;
    }

    /**
     * Set player immunity status
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {boolean} isImmune - Whether player is immune
     * @returns {Object|null} Updated player object or null
     */
    setPlayerImmunity(roomCode, playerId, isImmune) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return null;

        player.isImmune = isImmune;
        return player;
    }

    /**
     * Get player by ID
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @returns {Object|null} Player object or null
     */
    getPlayer(roomCode, playerId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        return room.players.find(p => p.id === playerId) || null;
    }

    /**
     * Reset all players' health for a new round
     * @param {string} roomCode - Room code
     */
    resetPlayersHealth(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return;

        room.players.forEach(player => {
            player.health = COMBAT_CONFIG.STARTING_HEALTH;
            player.state = PLAYER_STATE.ACTIVE;
            player.inIFrames = false;
            player.isImmune = false;
        });
    }

    /**
     * Set room status
     * @param {string} roomCode - Room code
     * @param {string} status - New status (WAITING, PLAYING, FINISHED)
     * @returns {Object|null} Updated room or null if not found
     */
    setRoomStatus(roomCode, status) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        room.status = status;
        return room;
    }
}

// Export singleton instance
export default new RoomManager();
