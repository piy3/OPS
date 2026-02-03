/**
 * Room Management Service
 * Handles all room-related business logic
 */

import { ROOM_CONFIG, ROOM_STATUS, COMBAT_CONFIG, PLAYER_STATE, GAME_LOOP_CONFIG, getNextAvailableCharacterId } from '../config/constants.js';
import log from "../utils/logger.js"
// Extract starting coins from config for easy reference
const STARTING_COINS = ROOM_CONFIG.STARTING_COINS;
const QUESTIONS_ATTEMPTED = ROOM_CONFIG.STARTING_QUESTIONS_ATTEMPTED;
const QUESTIONS_CORRECTLY_ANSWERED = ROOM_CONFIG.STARTING_QUESTIONS_ANSWERED_CORRECTLY;
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
                questions_correctly_answered: QUESTIONS_CORRECTLY_ANSWERED,
                questions_attempted: QUESTIONS_ATTEMPTED,
                state: PLAYER_STATE.ACTIVE, // Player state
                isImmune: false, // Immunity powerup
                inIFrames: false, // Invincibility frames
                characterId: getNextAvailableCharacterId([]) // Assign first character (host is first player)
            }],
            status: ROOM_STATUS.WAITING,
            createdAt: Date.now(),
            maxPlayers: playerData?.maxPlayers || ROOM_CONFIG.DEFAULT_MAX_PLAYERS,
            unicornIds: [],           // Multiple unicorns per round
            unicornId: null           // Backward compat: unicornIds[0] ?? null
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
            questions_correctly_answered: QUESTIONS_CORRECTLY_ANSWERED,
            questions_attempted: QUESTIONS_ATTEMPTED,
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
        let newUnicornIds = null;

        // If host left and there are other players, assign new host
        if (wasHost && room.players.length > 0) {
            room.players[0].isHost = true;
            room.hostId = room.players[0].id;
            newHostId = room.players[0].id;
        }

        // If unicorn left: remove from unicornIds; optionally refill if zero remain
        if (wasUnicorn) {
            room.unicornIds = (room.unicornIds || []).filter(id => id !== socketId);
            room.unicornId = room.unicornIds[0] ?? null;
            room.players.forEach(p => { p.isUnicorn = room.unicornIds.includes(p.id); });
            if (room.players.length > 0 && room.unicornIds.length === 0) {
                // Refill to 30% (min 1) from remaining players
                const count = Math.max(
                    GAME_LOOP_CONFIG.MIN_UNICORNS,
                    Math.min(
                        (GAME_LOOP_CONFIG.MAX_UNICORNS ?? Infinity),
                        Math.ceil(room.players.length * (GAME_LOOP_CONFIG.UNICORN_PERCENTAGE ?? 0.3))
                    )
                );
                const cap = Math.min(count, Math.max(1, room.players.length - 1));
                const shuffled = [...room.players].sort(() => Math.random() - 0.5);
                newUnicornIds = shuffled.slice(0, cap).map(p => p.id);
                newUnicornIds.forEach(id => {
                    const p = room.players.find(pl => pl.id === id);
                    if (p) p.isUnicorn = true;
                });
                room.unicornIds = newUnicornIds;
                room.unicornId = room.unicornIds[0] ?? null;
            } else {
                newUnicornIds = room.unicornIds.length > 0 ? [...room.unicornIds] : null;
            }
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
            newUnicornIds,
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
        room.players.forEach(player => {
            player.coins = STARTING_COINS;
            player.questions_attempted = QUESTIONS_ATTEMPTED;
            player.questions_correctly_answered = QUESTIONS_CORRECTLY_ANSWERED;
        });
        
        // Assign 30% of players (min 1) as unicorns when game starts
        const pct = GAME_LOOP_CONFIG.UNICORN_PERCENTAGE ?? 0.3;
        const minU = GAME_LOOP_CONFIG.MIN_UNICORNS ?? 1;
        const maxU = GAME_LOOP_CONFIG.MAX_UNICORNS ?? Infinity;
        let count = Math.max(minU, Math.min(maxU, Math.ceil(room.players.length * pct)));
        count = Math.min(count, Math.max(1, room.players.length - 1)); // at least one survivor
        if (room.players.length > 0 && (room.unicornIds?.length ?? 0) === 0) {
            const shuffled = [...room.players].sort(() => Math.random() - 0.5);
            room.unicornIds = shuffled.slice(0, count).map(p => p.id);
            room.unicornIds.forEach(id => {
                const p = room.players.find(pl => pl.id === id);
                if (p) p.isUnicorn = true;
            });
            room.unicornId = room.unicornIds[0] ?? null;
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
     * Set unicorn set (multiple unicorns per round).
     * @param {string} roomCode - Room code
     * @param {string[]} newUnicornIds - Socket IDs of unicorns
     * @returns {Object|null} Updated room or null
     */
    setUnicorns(roomCode, newUnicornIds) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        room.players.forEach(p => { p.isUnicorn = false; });
        (newUnicornIds || []).forEach(id => {
            const p = room.players.find(pl => pl.id === id);
            if (p) p.isUnicorn = true;
        });
        room.unicornIds = [...(newUnicornIds || [])];
        room.unicornId = room.unicornIds[0] ?? null;
        return room;
    }

    /**
     * Transfer unicorn status to a single player (backward compat; prefer setUnicorns)
     * @param {string} roomCode - Room code
     * @param {string} newUnicornId - Socket ID of new unicorn
     * @returns {Object|null} Updated room or null
     */
    transferUnicorn(roomCode, newUnicornId) {
        return this.setUnicorns(roomCode, newUnicornId ? [newUnicornId] : []);
    }

    /**
     * Get all unicorn players in room
     * @param {string} roomCode - Room code
     * @returns {Array} Array of unicorn player objects
     */
    getUnicorns(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return [];
        return room.players.filter(p => p.isUnicorn);
    }

    /**
     * Get current unicorn in room (first of set; backward compat)
     * @param {string} roomCode - Room code
     * @returns {Object|null} First unicorn player or null
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

    handlePlayerQuestionsAttempt(roomCode, playerId, isCorrect){
        const room = this.rooms.get(roomCode);
        if(!room) {
            // console.log("room not found in handlePlayerQuestionAttempt");
            return null;
        }
        const player = room.players.find(p => p.id === playerId)
        if(!player) {
            // console.log(`player ${playerId} not found in handlePlayerQuestionAttempt for room ${roomCode}`);
            log.warn(`player ${playerId} not found in handlePlayerQuestionAttempt for room ${roomCode}`); // checking if logger works
            return null;
        }
        player.questions_attempted = (player.questions_attempted ?? 0) + 1;
        if (isCorrect) player.questions_correctly_answered = (player.questions_correctly_answered ?? 0) + 1;
        // log.info(`incremented question counts of player ${player.id} ${player.questions_correctly_answered} ${player.questions_attempted}`)
        return;
    }

    /**
     * Delete a room completely
     * Used when game ends and room should be removed
     * @param {string} roomCode - Room code to delete
     * @returns {boolean} True if room was deleted
     */
    deleteRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) {
            return false;
        }

        // Clear socket mappings if used (RoomManager does not maintain socketToRoom; guard for compatibility)
        if (this.socketToRoom) {
            room.players.forEach(player => {
                this.socketToRoom.delete(player.id);
            });
        }

        // Delete the room
        this.rooms.delete(roomCode);
        
        log.info(`🗑️ Room ${roomCode} deleted from RoomManager`);
        return true;
    }
}

// Export singleton instance
export default new RoomManager();
