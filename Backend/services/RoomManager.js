/**
 * Room Management Service
 * Handles all room-related business logic
 */

import { ROOM_CONFIG, ROOM_STATUS, COMBAT_CONFIG, PLAYER_STATE, GAME_LOOP_CONFIG, getMapConfigForPlayerCount, GAME_CONFIG } from '../config/constants.js';
import log from "../utils/logger.js"
// Extract starting coins from config for easy reference
const STARTING_COINS = ROOM_CONFIG.STARTING_COINS;
const QUESTIONS_ATTEMPTED = ROOM_CONFIG.STARTING_QUESTIONS_ATTEMPTED;
const QUESTIONS_CORRECTLY_ANSWERED = ROOM_CONFIG.STARTING_QUESTIONS_ANSWERED_CORRECTLY;
import { generateRoomCode, generateDefaultPlayerName } from '../utils/roomUtils.js';

class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomCode -> room object
        this.disconnectTimers = new Map(); // playerId -> timeout handle for grace period
    }

    /**
     * Create a new room
     * @param {string} socketId - Socket ID of the host
     * @param {Object} playerData - Player data (name, maxPlayers, playerId)
     * @returns {Object} Created room object
     */
    createRoom(socketId, playerData = {}) {
        const roomCode = generateRoomCode(this.rooms);
        const isTeacher = playerData?.isTeacher === true;
        // Initialize map config for 1 player (host)
        const mapConfig = getMapConfigForPlayerCount(1);
        // Use client-provided playerId or generate one from socketId
        const playerId = playerData?.playerId || socketId;
        const room = {
            code: roomCode,
            hostId: socketId,
            hostPlayerId: isTeacher ? null : playerId, // Persistent host ID for reconnection
            teacherId: isTeacher ? socketId : null,
            totalRounds: playerData?.totalRounds ?? null,
            players: isTeacher ? [] : [{
                id: socketId,                // Current socket ID (can change on reconnect)
                playerId: playerId,          // Persistent player ID (stays same across reconnects)
                name: playerData?.name || generateDefaultPlayerName(socketId),
                isHost: true,
                isUnicorn: false, // Will be assigned when game starts
                coins: STARTING_COINS, // Starting coins
                health: COMBAT_CONFIG.STARTING_HEALTH, // Starting health
                questions_correctly_answered: QUESTIONS_CORRECTLY_ANSWERED,
                questions_attempted: Number(QUESTIONS_ATTEMPTED) || 0,
                attemptedQuestionIds: [],   // Per-player blitz: question ids this player has attempted
                state: PLAYER_STATE.ACTIVE, // Player state
                inIFrames: false, // Invincibility frames
                disconnectedAt: null, // Timestamp when disconnected (null if connected)
                timeLeftInMaze: GAME_LOOP_CONFIG.ALLOWED_TIME_IN_MAZE,
            }],
            status: ROOM_STATUS.WAITING,
            createdAt: Date.now(),
            maxPlayers: playerData?.maxPlayers || ROOM_CONFIG.DEFAULT_MAX_PLAYERS,
            unicornIds: [],           // Multiple unicorns per round
            unicornId: null,          // Backward compat: unicornIds[0] ?? null
            mapConfig: mapConfig,      // Dynamic map configuration based on player count
            quizId: playerData?.quizId ?? null,
            quizQuestionPool: null,
            // Per-player flow: teacher-set game duration (minutes) → global timer
            gameDurationMinutes: playerData?.gameDurationMinutes ?? null,
            gameDurationMs: playerData?.gameDurationMinutes != null ? playerData.gameDurationMinutes * 60 * 1000 : null,
        };

        // Store userId as non-enumerable so it's excluded from JSON serialization (broadcasts)
        // but still accessible via room.userId for logging/identification
        Object.defineProperty(room, 'userId', {
            value: playerData?.userId ?? null,
            enumerable: false,
            writable: true,
            configurable: true,
        });

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
            if (room.hostId === socketId || room.teacherId === socketId || room.players.some(p => p.id === socketId)) {
                return code;
            }
        }
        return null;
    }

    /**
     * Get room code for a persistent player ID
     * @param {string} playerId - Persistent player ID
     * @returns {string|null} Room code or null
     */
    getRoomCodeForPlayerId(playerId) {
        for (const [code, room] of this.rooms.entries()) {
            if (room.hostPlayerId === playerId || room.players.some(p => p.playerId === playerId)) {
                return code;
            }
        }
        return null;
    }

    /**
     * Get player by persistent player ID
     * @param {string} roomCode - Room code
     * @param {string} playerId - Persistent player ID
     * @returns {Object|null} Player object or null
     */
    getPlayerByPlayerId(roomCode, playerId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;
        return room.players.find(p => p.playerId === playerId) || null;
    }

    /**
     * Get player by current socket ID
     * @param {string} roomCode - Room code
     * @param {string} socketId - Current socket ID
     * @returns {Object|null} Player object or null
     */
    getPlayerBySocketId(roomCode, socketId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;
        return room.players.find(p => p.id === socketId) || null;
    }

    /**
     * Get persistent playerId from socket ID
     * @param {string} roomCode - Room code
     * @param {string} socketId - Current socket ID
     * @returns {string|null} Persistent player ID or null
     */
    getPersistentPlayerId(roomCode, socketId) {
        const player = this.getPlayerBySocketId(roomCode, socketId);
        return player ? player.playerId : null;
    }

    /**
     * Update player's socket ID (on reconnection)
     * @param {string} roomCode - Room code
     * @param {string} playerId - Persistent player ID
     * @param {string} newSocketId - New socket ID
     * @returns {Object|null} Updated player object or null
     */
    updatePlayerSocketId(roomCode, playerId, newSocketId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.playerId === playerId);
        if (!player) return null;

        const oldSocketId = player.id;
        player.id = newSocketId;
        player.disconnectedAt = null; // Clear disconnected status

        // Update hostId if this player was the host
        if (room.hostPlayerId === playerId) {
            room.hostId = newSocketId;
        }

        // Note: unicornIds now uses persistent playerId, so no update needed on socket reconnect

        // Cancel any pending disconnect timer
        if (this.disconnectTimers.has(playerId)) {
            clearTimeout(this.disconnectTimers.get(playerId));
            this.disconnectTimers.delete(playerId);
            log.info(`⏱️ Cancelled disconnect timer for player ${playerId}`);
        }

        log.info(`🔄 Updated socket ID for player ${playerId}: ${oldSocketId} -> ${newSocketId}`);
        return player;
    }

    /**
     * Mark player as disconnected (but don't remove yet - grace period)
     * @param {string} roomCode - Room code
     * @param {string} socketId - Socket ID of disconnected player
     * @returns {Object|null} Player object or null
     */
    markPlayerDisconnected(roomCode, socketId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const player = room.players.find(p => p.id === socketId);
        if (!player) return null;

        player.disconnectedAt = Date.now();
        log.info(`⚠️ Player ${player.playerId} (${player.name}) marked as disconnected in room ${roomCode}`);
        return player;
    }

    /**
     * Check if player is currently disconnected
     * @param {string} roomCode - Room code
     * @param {string} playerId - Persistent player ID
     * @returns {boolean} True if player is disconnected
     */
    isPlayerDisconnected(roomCode, playerId) {
        const player = this.getPlayerByPlayerId(roomCode, playerId);
        return player?.disconnectedAt != null;
    }

    /**
     * Store a disconnect timer for a player
     * @param {string} playerId - Persistent player ID
     * @param {NodeJS.Timeout} timer - Timeout handle
     */
    setDisconnectTimer(playerId, timer) {
        this.disconnectTimers.set(playerId, timer);
    }

    /**
     * Get disconnect timer for a player
     * @param {string} playerId - Persistent player ID
     * @returns {NodeJS.Timeout|null} Timeout handle or null
     */
    getDisconnectTimer(playerId) {
        return this.disconnectTimers.get(playerId) || null;
    }

    /**
     * Clear disconnect timer for a player
     * @param {string} playerId - Persistent player ID
     */
    clearDisconnectTimer(playerId) {
        if (this.disconnectTimers.has(playerId)) {
            clearTimeout(this.disconnectTimers.get(playerId));
            this.disconnectTimers.delete(playerId);
        }
    }

    /**
     * Validate if a player can join a room
     * @param {string} roomCode - Room code
     * @param {string} socketId - Socket ID
     * @param {string} playerId - Persistent player ID (optional)
     * @returns {Object} { valid: boolean, error: string|null, isRejoin: boolean }
     */
    validateJoinRoom(roomCode, socketId, playerId = null) {
        if (!this.rooms.has(roomCode)) {
            return { valid: false, error: 'Room not found', isRejoin: false };
        }

        const room = this.rooms.get(roomCode);

        // Check if this is a reconnecting player (by playerId)
        if (playerId) {
            const existingPlayer = room.players.find(p => p.playerId === playerId);
            if (existingPlayer) {
                // Player exists - this could be a rejoin attempt
                // Allow rejoin even if game is in progress
                return { valid: true, error: null, isRejoin: true };
            }
        }

        // Check if already in room by socketId
        if (room.players.some(p => p.id === socketId)) {
            return { valid: false, error: 'Already in this room', isRejoin: false };
        }

        if (room.players.length >= room.maxPlayers) {
            return { valid: false, error: 'Room is full', isRejoin: false };
        }

        if (room.status === ROOM_STATUS.PLAYING) {
            return { valid: false, error: 'Game already in progress', isRejoin: false };
        }

        return { valid: true, error: null, isRejoin: false };
    }

    /**
     * Add player to room
     * @param {string} roomCode - Room code
     * @param {string} socketId - Socket ID
     * @param {string} playerName - Player name
     * @param {string} playerId - Persistent player ID (optional, defaults to socketId)
     * @returns {Object} { player, mapConfigChanged, newMapConfig }
     */
    addPlayerToRoom(roomCode, socketId, playerName, playerId = null) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        // Use provided playerId or default to socketId
        const persistentId = playerId || socketId;

        const player = {
            id: socketId,                // Current socket ID (can change on reconnect)
            playerId: persistentId,      // Persistent player ID (stays same across reconnects)
            name: playerName || generateDefaultPlayerName(socketId),
            isHost: false,
            isUnicorn: false,
            coins: STARTING_COINS, // Starting coins
            health: COMBAT_CONFIG.STARTING_HEALTH, // Starting health
            questions_correctly_answered: QUESTIONS_CORRECTLY_ANSWERED,
            questions_attempted: Number(QUESTIONS_ATTEMPTED) || 0,
            attemptedQuestionIds: [],   // Per-player blitz: question ids this player has attempted
            state: PLAYER_STATE.ACTIVE, // Player state
            inIFrames: false, // Invincibility frames
            disconnectedAt: null, // Timestamp when disconnected (null if connected)
        };

        room.players.push(player);
        
        // Check if map config needs to update (only in waiting state)
        let mapConfigChanged = false;
        let newMapConfig = null;
        if (room.status === ROOM_STATUS.WAITING) {
            const updatedConfig = this.updateRoomMapConfig(roomCode);
            if (updatedConfig) {
                mapConfigChanged = true;
                newMapConfig = updatedConfig;
            }
        }
        
        return { player, mapConfigChanged, newMapConfig };
    }
    
    /**
     * Update room map config based on current player count
     * Only updates if in waiting state and size would change
     * @param {string} roomCode - Room code
     * @returns {Object|null} New config if changed, null otherwise
     */
    updateRoomMapConfig(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room || room.status !== ROOM_STATUS.WAITING) return null;
        
        const newConfig = getMapConfigForPlayerCount(room.players.length);
        if (newConfig.width !== room.mapConfig?.width) {
            room.mapConfig = newConfig;
            log.info({ roomCode, width: newConfig.width, height: newConfig.height, players: room.players.length }, 'Map config updated');
            return newConfig;
        }
        return null;
    }

    /**
     * Remove player from room (by socketId or playerId)
     * @param {string} roomCode - Room code
     * @param {string} identifier - Socket ID or Player ID
     * @param {boolean} byPlayerId - If true, search by playerId instead of socketId
     * @returns {Object} { wasHost: boolean, roomDeleted: boolean, mapConfigChanged, newMapConfig, playerId }
     */
    removePlayerFromRoom(roomCode, identifier, byPlayerId = false) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        const playerIndex = byPlayerId
            ? room.players.findIndex(p => p.playerId === identifier)
            : room.players.findIndex(p => p.id === identifier);
        if (playerIndex === -1) return null;

        const removedPlayer = room.players[playerIndex];
        const wasHost = removedPlayer.isHost;
        const wasUnicorn = removedPlayer.isUnicorn;
        const removedPlayerId = removedPlayer.playerId;
        const removedSocketId = removedPlayer.id;
        room.players.splice(playerIndex, 1);

        // Clear any pending disconnect timer for this player
        this.clearDisconnectTimer(removedPlayerId);

        let roomDeleted = false;
        let newHostId = null;
        let newUnicornIds = null;
        let mapConfigChanged = false;
        let newMapConfig = null;

        // If host left and there are other players, assign new host
        if (wasHost && room.players.length > 0) {
            room.players[0].isHost = true;
            room.hostId = room.players[0].id;
            room.hostPlayerId = room.players[0].playerId;
            newHostId = room.players[0].id;
        }

        // If unicorn left: remove from unicornIds (using persistent playerId); optionally refill if zero remain
        if (wasUnicorn) {
            room.unicornIds = (room.unicornIds || []).filter(id => id !== removedPlayerId);
            room.unicornId = room.unicornIds[0] ?? null;
            room.players.forEach(p => { p.isUnicorn = room.unicornIds.includes(p.playerId); });
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
                newUnicornIds = shuffled.slice(0, cap).map(p => p.playerId);
                newUnicornIds.forEach(id => {
                    const p = room.players.find(pl => pl.playerId === id);
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
        } else {
            // Check if map config needs to update (only in waiting state)
            if (room.status === ROOM_STATUS.WAITING) {
                const updatedConfig = this.updateRoomMapConfig(roomCode);
                if (updatedConfig) {
                    mapConfigChanged = true;
                    newMapConfig = updatedConfig;
                }
            }
        }

        return {
            wasHost,
            wasUnicorn,
            roomDeleted,
            newHostId,
            newUnicornIds,
            mapConfigChanged,
            newMapConfig,
            playerId: removedPlayerId,
            socketId: removedSocketId,
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
        const isTeacher = room.teacherId === socketId;
        if (room.hostId !== socketId && !isTeacher) {
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
     * Validate if a socket can end the game (host or teacher only, game must be playing)
     * @param {string} roomCode - Room code
     * @param {string} socketId - Socket ID
     * @returns {Object} { valid: boolean, error: string|null }
     */
    validateEndGame(roomCode, socketId) {
        const room = this.rooms.get(roomCode);
        if (!room) {
            return { valid: false, error: 'Room not found' };
        }
        if (room.status !== ROOM_STATUS.PLAYING) {
            return { valid: false, error: 'Game is not in progress' };
        }
        const isTeacher = room.teacherId === socketId;
        if (room.hostId !== socketId && !isTeacher) {
            return { valid: false, error: 'Only host or teacher can end the game' };
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
        
        // Reset all player coins and question counts for the new game (use numbers only)
        room.players.forEach(player => {
            player.coins = STARTING_COINS;
            player.questions_attempted = Number(QUESTIONS_ATTEMPTED) || 0;
            player.questions_correctly_answered = Number(QUESTIONS_CORRECTLY_ANSWERED) || 0;
        });
        
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
     * @param {string[]} newUnicornIds - Persistent player IDs of unicorns
     * @returns {Object|null} Updated room or null
     */
    setUnicorns(roomCode, newUnicornIds) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        room.players.forEach(p => { p.isUnicorn = false; });
        (newUnicornIds || []).forEach(id => {
            const p = room.players.find(pl => pl.playerId === id);
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

        const player = room.players.find(p => p.id === playerId || p.playerId === playerId);
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
            log.warn({ roomCode, playerId }, 'Player not found in handlePlayerQuestionAttempt');
            return null;
        }
        player.questions_attempted = (Number(player.questions_attempted) || 0) + 1;
        if (isCorrect) player.questions_correctly_answered = (Number(player.questions_correctly_answered) || 0) + 1;
        return;
    }

    /**
     * Record a blitz question attempt (per-player flow). Uses persistent playerId.
     * @param {string} roomCode - Room code
     * @param {string} playerId - Persistent player ID
     * @param {string|number} questionId - Question id that was attempted
     * @param {boolean} isCorrect - Whether the answer was correct
     */
    recordBlitzQuestionAttempted(roomCode, playerId, questionId, isCorrect) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;
        const player = room.players.find(p => p.playerId === playerId);
        if (!player) {
            log.warn({ roomCode, playerId }, 'Player not found in recordBlitzQuestionAttempted');
            return null;
        }
        if (!Array.isArray(player.attemptedQuestionIds)) player.attemptedQuestionIds = [];
        // Store canonical id (string) so filtering elsewhere can match regardless of number vs string from quiz
        player.attemptedQuestionIds.push(String(questionId));
        player.questions_attempted = (Number(player.questions_attempted) || 0) + 1;
        if (isCorrect) player.questions_correctly_answered = (Number(player.questions_correctly_answered) || 0) + 1;
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
        
        log.info({ roomCode }, 'Room deleted from RoomManager');
        return true;
    }
}

// Export singleton instance
export default new RoomManager();
