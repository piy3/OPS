/**
 * Application constants and configuration
 */

/**
 * Character IDs for player avatars
 * Each player in a room gets a unique character ID
 */
export const CHARACTER_IDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * Get the next available character ID that is not already assigned in the room
 * @param {Array} players - Array of player objects with characterId property
 * @returns {string} The first available character ID
 */
export const getNextAvailableCharacterId = (players) => {
    const usedIds = new Set(players.map(p => p.characterId).filter(Boolean));
    return CHARACTER_IDS.find(id => !usedIds.has(id)) || CHARACTER_IDS[0];
};

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

/**
 * Game Phase Constants for Blitz Quiz + Hunt game loop
 */
export const GAME_PHASE = {
    WAITING: 'waiting',           // Before game starts
    BLITZ_QUIZ: 'blitz_quiz',     // All players answer quiz simultaneously
    HUNT: 'hunt',                 // Active gameplay - unicorn hunts survivors
    ROUND_END: 'round_end'        // Brief pause between rounds
};

/**
 * Game Loop Timing Configuration
 */
export const GAME_LOOP_CONFIG = {
    // Blitz Quiz Phase
    BLITZ_QUIZ_DURATION: 15000,     // 15 seconds for Blitz Quiz
    BLITZ_QUESTION_COUNT: 1,        // Single question per Blitz Quiz
    
    // Hunt Phase
    HUNT_DURATION: 60000,           // 60 seconds of active gameplay
    
    // Round End Phase
    ROUND_END_DURATION: 3000,       // 3 seconds to show results
    
    // Game Loop
    GAME_LOOP_INTERVAL: 60000,      // Blitz Quiz every 60 seconds during hunt
    
    // Scoring
    TAG_SCORE_STEAL: 15,            // Unicorn steals 15 points per tag
    COIN_VALUE: 5,                  // Each coin worth 5 points
    BLITZ_WINNER_BONUS: 10,         // Bonus for winning Blitz Quiz
    
    // Reserve Unicorn
    RESERVE_UNICORN_ENABLED: true,  // Enable second-fastest as reserve
    RESERVE_ACTIVATION_DELAY: 5000  // Delay before reserve can become unicorn
};

/**
 * Role Configuration for Unicorn and Survivor
 */
export const ROLE_CONFIG = {
    UNICORN: {
        speedMultiplier: 1.5,       // 1.5x base speed
        abilities: ['tag'],          // Can only tag
        canCollectCoins: false,
        canUsePowerups: false
    },
    SURVIVOR: {
        speedMultiplier: 1.0,       // Base speed
        abilities: ['collect', 'usePowerup'],
        canCollectCoins: true,
        canUsePowerups: true
    }
};

/**
 * Combat System Configuration
 */
export const COMBAT_CONFIG = {
    // Health
    MAX_HEALTH: 100,
    STARTING_HEALTH: 100,
    
    // Damage
    TAG_DAMAGE: 50,                 // Damage dealt when unicorn tags survivor
    TAG_HEAL: 20,                   // Health/score unicorn gains per tag
    
    // Invincibility Frames
    IFRAME_DURATION: 3000,          // 3 seconds of invincibility after being hit
    
    // Knockback
    KNOCKBACK_ENABLED: true,
    KNOCKBACK_DISTANCE: 2,          // Cells to knock back
    KNOCKBACK_DURATION: 300,        // Duration of knockback animation in ms
    
    // Zero Health / Death
    RESPAWN_HEALTH: 50,             // Health after respawn (50%)
    
    // Player States
    PLAYER_STATE: {
        ACTIVE: 'active',
        FROZEN: 'frozen',           // Cannot move, zero health
        IMMUNE: 'immune',           // Has immunity powerup
        IN_IFRAMES: 'in_iframes'    // In invincibility frames
    }
};

/**
 * Unfreeze Quiz Configuration
 * Personal quiz for players at zero health to unfreeze themselves
 */
export const UNFREEZE_QUIZ_CONFIG = {
    QUESTIONS_COUNT: 2,             // Number of questions in unfreeze quiz
    PASS_THRESHOLD: 1,              // Minimum correct answers to pass (1 of 2)
    // No timer - player can take as long as needed
};

/**
 * Player State Constants
 */
export const PLAYER_STATE = {
    ACTIVE: 'active',
    FROZEN: 'frozen',
    IMMUNE: 'immune',
    IN_IFRAMES: 'in_iframes'
};

/**
 * Coin Configuration
 * Collectible coins scattered in the maze
 */
export const COIN_CONFIG = {
    VALUE: 20,                      // +20 score per coin
    RESPAWN_TIME: 5000,             // 5 seconds after collection
    MAX_COINS: 15,                  // Maximum coins on map at once
    INITIAL_SPAWN_COUNT: 10,        // Coins spawned at Hunt start
    COLLECTION_RADIUS: 0,           // Player must be within 1 cell to collect
    
    // Predefined coin spawn slots (row, col) - scattered throughout the maze
    SPAWN_SLOTS: [
        { row: 1, col: 6 },
        { row: 1, col: 12 },
        { row: 1, col: 19 },
        { row: 1, col: 25 },
        { row: 4, col: 3 },
        { row: 4, col: 15 },
        { row: 4, col: 28 },
        { row: 10, col: 1 },
        { row: 10, col: 15 },
        { row: 10, col: 30 },
        { row: 13, col: 6 },
        { row: 13, col: 25 },
        { row: 22, col: 6 },
        { row: 22, col: 15 },
        { row: 22, col: 25 },
        { row: 25, col: 3 },
        { row: 25, col: 28 }
    ]
};

/**
 * Power-up Configuration
 * Immunity shields that protect from unicorn attacks
 */
export const POWERUP_CONFIG = {
    SPAWN_INTERVAL_MIN: 10000,      // Minimum 10 seconds between spawns
    SPAWN_INTERVAL_MAX: 15000,      // Maximum 15 seconds between spawns
    DURATION: 10000,                // 10 seconds of immunity
    MAX_POWERUPS: 4,                // Maximum powerups on map at once
    COLLECTION_RADIUS: 0,           // Player must be within 1 cell to collect
    
    // Types of powerups
    TYPES: {
        IMMUNITY: {
            id: 'immunity',
            name: 'Immunity Shield',
            duration: 10000,
            visual: 'shield_bubble'
        }
        // Future powerups can be added here:
        // SPEED_BOOST: { id: 'speed', name: 'Speed Boost', duration: 5000, visual: 'speed_trails' }
        // INVISIBILITY: { id: 'invisible', name: 'Invisibility', duration: 8000, visual: 'ghost' }
    },
    
    // Predefined powerup spawn slots (row, col) - strategic locations
    SPAWN_SLOTS: [
        { row: 4, col: 10 },
        { row: 4, col: 21 },
        { row: 13, col: 15 },
        { row: 22, col: 10 },
        { row: 22, col: 21 },
        { row: 10, col: 6 },
        { row: 10, col: 25 },
        { row: 16, col: 6 },
        { row: 16, col: 25 }
    ]
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
        UPDATE_POSITION: 'update_position',
        GET_ROOM_INFO: 'get_room_info',
        GET_GAME_STATE: 'get_game_state',
        SUBMIT_QUIZ_ANSWER: 'submit_quiz_answer',
        BLITZ_ANSWER: 'blitz_answer',           // Submit blitz quiz answer
        COLLECT_COIN: 'collect_coin',           // Request coin collection
        COLLECT_POWERUP: 'collect_powerup',     // Request powerup collection
        SUBMIT_UNFREEZE_QUIZ_ANSWER: 'submit_unfreeze_quiz_answer'  // Submit unfreeze quiz answer
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
        UNICORN_TRANSFERRED: 'unicorn_transferred',
        SCORE_UPDATE: 'score_update',
        ROOM_INFO: 'room_info',
        PLAYER_POSITION_UPDATE: 'player_position_update',
        GAME_STATE_SYNC: 'game_state_sync',
        GAME_FROZEN: 'game_frozen',
        QUIZ_START: 'quiz_start',
        QUIZ_COMPLETE: 'quiz_complete',
        JOIN_ERROR: 'join_error',
        LEAVE_ERROR: 'leave_error',
        START_ERROR: 'start_error',
        // Game Loop Events
        PHASE_CHANGE: 'phase_change',           // Notify clients of phase change
        BLITZ_START: 'blitz_start',             // Blitz quiz begins
        BLITZ_ANSWER_RESULT: 'blitz_answer_result', // Individual answer feedback
        BLITZ_RESULT: 'blitz_result',           // Role assignments after blitz
        HUNT_START: 'hunt_start',               // Hunt phase begins
        HUNT_END: 'hunt_end',                   // Hunt phase ends
        PLAYER_TAGGED: 'player_tagged',         // Unicorn tagged a survivor
        RESERVE_ACTIVATED: 'reserve_activated', // Reserve unicorn became active
        // Combat Events
        PLAYER_HIT: 'player_hit',               // Player took damage
        PLAYER_RESPAWN: 'player_respawn',       // Player respawned after freeze
        PLAYER_STATE_CHANGE: 'player_state_change', // Player state changed
        HEALTH_UPDATE: 'health_update',         // Health changed for a player
        // Coin Events
        COIN_SPAWNED: 'coin_spawned',           // Coin spawned on map
        COIN_COLLECTED: 'coin_collected',       // Player collected a coin
        // Power-up Events
        POWERUP_SPAWNED: 'powerup_spawned',     // Power-up appeared on map
        POWERUP_COLLECTED: 'powerup_collected', // Player collected a power-up
        POWERUP_ACTIVATED: 'powerup_activated', // Power-up effect started
        POWERUP_EXPIRED: 'powerup_expired',     // Power-up effect ended
        // Unfreeze Quiz Events
        UNFREEZE_QUIZ_START: 'unfreeze_quiz_start',           // Personal unfreeze quiz started
        UNFREEZE_QUIZ_ANSWER_RESULT: 'unfreeze_quiz_answer_result', // Feedback on submitted answer
        UNFREEZE_QUIZ_COMPLETE: 'unfreeze_quiz_complete',     // Quiz passed, player unfrozen
        UNFREEZE_QUIZ_CANCELLED: 'unfreeze_quiz_cancelled'    // Quiz cancelled (blitz started)
    }
};

/**
 * Position Update Rate Configuration
 * 
 * CLIENT (Frontend):
 *   - Sends position updates at ~30fps (every 33ms)
 *   - Throttled in StartGame.jsx sendPositionUpdate()
 * 
 * SERVER (Backend):
 *   - Accepts updates at ~30fps (every 30ms) to match client
 *   - Throttled in PositionManager.updatePosition() BEFORE heavy work
 *   - Returns early if throttled to avoid unnecessary room/collision checks
 * 
 * The server throttle is set slightly lower (30ms vs 33ms) to account for
 * network jitter while still preventing excessive updates.
 */
/**
 * Maze Configuration
 */
export const MAZE_CONFIG = {
    MAZE_COLS: 32,                           // Total columns in the maze
    MAZE_ROWS: 28,                           // Total rows in the maze
    // Row indices (0-based) where tunnels exist (both col 0 and col 31 are open)
    WRAP_AROUND_ROWS: [10, 14, 18]
};

/**
 * Helper to check if a row has wrap-around (tunnel)
 * @param {number} row - Row index (0-based)
 * @returns {boolean} True if the row has wrap-around
 */
export const hasWrapAround = (row) => MAZE_CONFIG.WRAP_AROUND_ROWS.includes(row);

export const GAME_CONFIG = {
    // Position update throttling
    POSITION_UPDATE_RATE: 30,                // Target updates per second
    POSITION_UPDATE_INTERVAL: 30,            // 30ms between updates (~33fps)
    CLIENT_POSITION_SEND_INTERVAL: 33,       // Frontend sends at 33ms (~30fps)
    
    MAX_POSITION_HISTORY: 10, // Keep last N positions for lag compensation
    POSITION_VALIDATION: {
        MAX_X: 10000, // Adjust based on your game world
        MAX_Y: 10000,
        MIN_X: -10000,
        MIN_Y: -10000
    },
    // Fixed spawn positions for players (row, col)
    // Each player spawns at a different position - supports up to 9 players
    // Positions are spread across the maze on valid walkable tiles
    SPAWN_POSITIONS: [
        { row: 1, col: 1 },      // Top-left corner
        { row: 1, col: 30 },     // Top-right corner
        { row: 26, col: 1 },     // Bottom-left corner
        { row: 26, col: 30 },    // Bottom-right corner
        { row: 1, col: 15 },     // Top-center
        { row: 22, col: 1 },     // Mid-left
        { row: 22, col: 30 },    // Mid-right
        { row: 4, col: 6 },      // Upper corridor left
        { row: 4, col: 25 }      // Upper corridor right
    ]
};
