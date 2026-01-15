/**
 * Application constants and configuration
 */

export const ROOM_CONFIG = {
    DEFAULT_MAX_PLAYERS: 9,
    ROOM_CODE_LENGTH: 6,
    ROOM_CODE_CHARS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    MIN_PLAYERS_TO_START: 2
};

export const ROOM_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

export const SERVER_CONFIG = {
    PORT: 3000,
    CORS_ORIGIN: '*',
    CORS_METHODS: ['GET', 'POST']
};

export const SOCKET_EVENTS = {
    // Client -> Server
    CLIENT: {
        CREATE_ROOM: 'create_room',
        JOIN_ROOM: 'join_room',
        LEAVE_ROOM: 'leave_room',
        START_GAME: 'start_game',
        GAME_ACTION: 'game_action',
        UPDATE_POSITION: 'update_position', // New: Position updates
        GET_ROOM_INFO: 'get_room_info',
        GET_GAME_STATE: 'get_game_state' // New: Get current game state
    },
    // Server -> Client
    SERVER: {
        ROOM_CREATED: 'room_created',
        ROOM_JOINED: 'room_joined',
        PLAYER_JOINED: 'player_joined',
        PLAYER_LEFT: 'player_left',
        ROOM_UPDATE: 'room_update',
        ROOM_LEFT: 'room_left',
        GAME_STARTED: 'game_started',
        HOST_TRANSFERRED: 'host_transferred',
        ROOM_INFO: 'room_info',
        PLAYER_POSITION_UPDATE: 'player_position_update', // New: Position update broadcast
        GAME_STATE_SYNC: 'game_state_sync', // New: Full game state sync
        JOIN_ERROR: 'join_error',
        LEAVE_ERROR: 'leave_error',
        START_ERROR: 'start_error'
    }
};

export const GAME_CONFIG = {
    MAX_POSITION_UPDATE_RATE: 60, // Updates per second (throttle)
    POSITION_UPDATE_INTERVAL: 1000 / 60, // ~16.67ms between updates
    MAX_POSITION_HISTORY: 10, // Keep last N positions for lag compensation
    POSITION_VALIDATION: {
        MAX_X: 10000, // Adjust based on your game world
        MAX_Y: 10000,
        MIN_X: -10000,
        MIN_Y: -10000
    },
    // Fixed corner spawn positions for players (row, col)
    // Each player spawns at a different corner
    SPAWN_POSITIONS: [
        { row: 1, col: 1 },      // Top-left corner
        { row: 1, col: 30 },     // Top-right corner
        { row: 26, col: 1 },     // Bottom-left corner
        { row: 26, col: 30 }     // Bottom-right corner
    ]
};
