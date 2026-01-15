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
        GET_ROOM_INFO: 'get_room_info'
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
        JOIN_ERROR: 'join_error',
        LEAVE_ERROR: 'leave_error',
        START_ERROR: 'start_error'
    }
};
