/**
 * Application constants and configuration
 */

export const ROOM_CONFIG = {
    DEFAULT_MAX_PLAYERS: 30,
    ROOM_CODE_PREFIX: 'MAZ',                              // Fixed prefix for all room codes
    ROOM_CODE_RANDOM_LENGTH: 4,                           // Number of random characters after prefix
    ROOM_CODE_RANDOM_CHARS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', // A-Z only for random part (no digits)
    MIN_PLAYERS_TO_START: 2,
    STARTING_COINS: 0,  // Starting coins for each player when a new game starts
    STARTING_QUESTIONS_ATTEMPTED: 0,
    STARTING_QUESTIONS_ANSWERED_CORRECTLY: 0,
    RECONNECT_GRACE_PERIOD_MS: 10000,                     // 10 seconds grace period for reconnection
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
    ROUND_END: 'round_end',       // Brief pause between rounds
    GAME_END: 'game_end'          // Game has ended (all rounds completed)
};

/**
 * Game Loop Timing Configuration
 */
export const GAME_LOOP_CONFIG = {
    // Blitz Quiz Phase
    BLITZ_QUIZ_DURATION: 15000,     // 15 seconds for Blitz Quiz
    BLITZ_QUESTION_COUNT: 3,        // Single question per Blitz Quiz
    
    // Hunt Phase
    HUNT_DURATION: 30000,           // 30 seconds of active gameplay
    
    // Round End Phase
    ROUND_END_DURATION: 3000,       // 3 seconds to show results
    
    // Game Loop
    GAME_LOOP_INTERVAL: 30000,      // Blitz Quiz every 60 seconds during hunt
    ALLOWED_TIME_IN_MAZE: 30000, // 30 seconds
    
    // Game Length
    TOTAL_GAME_ROUNDS: 4,           // Number of rounds before game ends (1 round = Blitz + Hunt)
    GAME_TOTAL_DURATION_MS: 300000, // 5 minutes - global timer ends game for everyone (per-player flow)

    // Scoring
    TAG_SCORE_STEAL: 15,            // Unicorn steals 15 points per tag
    COIN_VALUE: 5,                  // Each coin worth 5 points
    BLITZ_WINNER_BONUS: 10,         // Bonus for winning Blitz Quiz
    
    // Multiple Unicorns (room flow: 30%; per-player flow: ENFORCER_CHANCE when entering hunt)
    UNICORN_PERCENTAGE: 0.3,
    ENFORCER_CHANCE: 0.2,           // Per-player flow: 20% chance of becoming enforcer (unicorn) when entering hunt
    MIN_UNICORNS: 1,
    MAX_UNICORNS: 30,             // null = no cap; set to N to ensure at least one survivor
    
    // Reserve Unicorn (legacy: used only when refilling after unicorn disconnect if desired)
    RESERVE_UNICORN_ENABLED: false, // Disabled for multi-unicorn; refill from room when needed
    RESERVE_ACTIVATION_DELAY: 5000,  // Delay before reserve can become unicorn
};

/**
 * Role Configuration for Unicorn and Survivor
 */
export const ROLE_CONFIG = {
    UNICORN: {
        speedMultiplier: 1.2,       // 1.5x base speed
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

export const PLAYER_ROLE = {
    PLAYER: 'player',
    TEACHER: 'teacher'  // Spectator who created the room
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
    IN_IFRAMES: 'in_iframes'
};

/**
 * Coin Configuration
 * Collectible coins scattered in the maze
 */
export const COIN_CONFIG = {
    VALUE: 5,                      // +20 score per coin
    RESPAWN_TIME: 2000,             // 5 seconds after collection
    MAX_COINS: 30,                  // not used yet
    INITIAL_SPAWN_COUNT: 20,        // Coins spawned at Hunt start
    COLLECTION_RADIUS: 0,
    MIN_SPAWN_DISTANCE: 3,
    
    // Predefined coin spawn slots (row, col) - all positions on roads (multiples ofF 4) -- fallback
    SPAWN_SLOTS: [
        { row: 4, col: 8 }, { row: 4, col: 16 }, { row: 4, col: 32 }, { row: 4, col: 40 },
        { row: 8, col: 4 }, { row: 8, col: 24 }, { row: 8, col: 44 },
        { row: 12, col: 8 }, { row: 12, col: 20 }, { row: 12, col: 36 },
        { row: 16, col: 4 }, { row: 16, col: 44 },
        { row: 20, col: 12 }, { row: 20, col: 24 }, { row: 20, col: 36 },
        { row: 24, col: 8 }, { row: 24, col: 40 },
        { row: 28, col: 4 }, { row: 28, col: 16 }, { row: 28, col: 32 },
        { row: 32, col: 12 }, { row: 32, col: 28 },
        { row: 36, col: 8 }, { row: 36, col: 24 }, { row: 36, col: 40 },
        { row: 40, col: 4 }, { row: 40, col: 20 }, { row: 40, col: 44 },
        { row: 44, col: 12 }, { row: 44, col: 32 }
    ]
};

export const SERVER_CONFIG = {
    PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
    CORS_ORIGIN: '*',
    CORS_METHODS: ['GET', 'POST']
};

export const SOCKET_EVENTS = {
    // Client -> Server
    CLIENT: {
        CREATE_ROOM: 'create_room',
        JOIN_ROOM: 'join_room',
        REJOIN_ROOM: 'rejoin_room',             // Rejoin room after disconnect
        LEAVE_ROOM: 'leave_room',
        START_GAME: 'start_game',
        UPDATE_POSITION: 'update_position',
        GET_ROOM_INFO: 'get_room_info',
        GET_GAME_STATE: 'get_game_state',
        SUBMIT_QUIZ_ANSWER: 'submit_quiz_answer',
        BLITZ_ANSWER: 'blitz_answer',           // Submit blitz quiz answer
        COLLECT_COIN: 'collect_coin',           // Request coin collection
        SUBMIT_UNFREEZE_QUIZ_ANSWER: 'submit_unfreeze_quiz_answer',  // Submit unfreeze quiz answer
        ENTER_SINKHOLE: 'enter_sinkhole',       // Enter a sinkhole to teleport
        COLLECT_SINK_TRAP: 'collect_sink_trap', // Collect a sink trap item
        DEPLOY_SINK_TRAP: 'deploy_sink_trap',   // Deploy a sink trap
        LAVA_DEATH: 'lava_death',               // Player fell in lava (freeze + quiz)
        REQUEST_UNFREEZE_QUIZ: 'request_unfreeze_quiz',  // Request quiz data if frozen but missing quiz
        END_GAME: 'end_game'                    // Host/teacher ends the game early
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
        // Unfreeze Quiz Events
        UNFREEZE_QUIZ_START: 'unfreeze_quiz_start',           // Personal unfreeze quiz started
        UNFREEZE_QUIZ_ANSWER_RESULT: 'unfreeze_quiz_answer_result', // Feedback on submitted answer
        UNFREEZE_QUIZ_COMPLETE: 'unfreeze_quiz_complete',     // Quiz passed, player unfrozen
        UNFREEZE_QUIZ_CANCELLED: 'unfreeze_quiz_cancelled',   // Quiz cancelled (blitz started)
        // Game End Events
        GAME_END: 'game_end',                                 // Game has ended (all rounds completed)
        // Sinkhole Events
        SINKHOLE_SPAWNED: 'sinkhole_spawned',                 // Sinkhole portal spawned
        PLAYER_TELEPORTED: 'player_teleported',               // Player teleported via sinkhole
        // Sink Trap Events
        SINK_TRAP_SPAWNED: 'sink_trap_spawned',               // Sink trap collectible spawned
        SINK_TRAP_COLLECTED: 'sink_trap_collected',           // Player collected a sink trap
        SINK_TRAP_DEPLOYED: 'sink_trap_deployed',             // Player deployed a sink trap
        SINK_TRAP_TRIGGERED: 'sink_trap_triggered',           // Unicorn triggered a sink trap
        PLAYER_ELIMINATED: 'player_eliminated',               // Player was eliminated
        PLAYER_LEFT_MAZE: 'player_left_maze',                 // Player went back to blitz (not visible in maze)
        // Reconnection Events
        REJOIN_SUCCESS: 'rejoin_success',                     // Player successfully rejoined
        REJOIN_ERROR: 'rejoin_error',                         // Failed to rejoin
        PLAYER_DISCONNECTED: 'player_disconnected',           // Player temporarily disconnected
        PLAYER_RECONNECTED: 'player_reconnected'              // Player reconnected within grace period
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
    MAZE_COLS: 30,                           // Default columns (used when no mapConfig)
    MAZE_ROWS: 30,                           // Default rows (used when no mapConfig)
    BLOCK_SIZE: 4,                           // Roads are at multiples of this
    TILE_SIZE: 64,                           // Pixel size of each tile
    // WRAP_AROUND_ROWS: []                     // Not used in city map
};

/**
 * Helper to check if a row has wrap-around (tunnel)
 * @param {number} row - Row index (0-based)
 * @returns {boolean} True if the row has wrap-around
 */
// export const hasWrapAround = (row) => MAZE_CONFIG.WRAP_AROUND_ROWS.includes(row);

/**
 * Generate map configuration based on player count
 * Map size scales with player count:
 * - Less than 10 players: 30x30
 * - 10-20 players: 40x40
 * - 20+ players: 50x50
 * 
 * @param {number} playerCount - Number of players in the room
 * @returns {Object} Map configuration object
 */
export function getMapConfigForPlayerCount(playerCount) {
    let size;
    if (playerCount < 10) size = 30;
    else if (playerCount <= 20) size = 40;
    else size = 50;
    
    const blockSize = MAZE_CONFIG.BLOCK_SIZE;
    const tileSize = MAZE_CONFIG.TILE_SIZE;
    // Ensure maxCoord is always a multiple of 4 (road intersection)
    // 30x30: Math.floor(26/4)*4 = 24, 40x40: 32, 50x50: 44
    const maxCoord = Math.floor((size - 4) / 4) * 4;
    
    // Generate spawn positions dynamically (road intersections: multiples of 4)
    const spawnPositions = [];
    
    // Corners
    spawnPositions.push({ row: 4, col: 4 });
    spawnPositions.push({ row: 4, col: maxCoord });
    spawnPositions.push({ row: maxCoord, col: 4 });
    spawnPositions.push({ row: maxCoord, col: maxCoord });
    
    // Edges - midpoints
    const mid = Math.floor(size / 2) - (Math.floor(size / 2) % blockSize);
    spawnPositions.push({ row: 4, col: mid });
    spawnPositions.push({ row: maxCoord, col: mid });
    spawnPositions.push({ row: mid, col: 4 });
    spawnPositions.push({ row: mid, col: maxCoord });
    
    // Center
    spawnPositions.push({ row: mid, col: mid });
    
    // Add more positions for larger maps (grid of intersections)
    if (size >= 40) {
        for (let r = 8; r < maxCoord; r += 8) {
            for (let c = 8; c < maxCoord; c += 8) {
                if (!spawnPositions.some(p => p.row === r && p.col === c)) {
                    spawnPositions.push({ row: r, col: c });
                }
            }
        }
    }
    
    // Single list of all road cells: row % 4 === 0 OR col % 4 === 0 (inner range 4..maxCoord)
    const roadBlocks = [];
    for (let r = 4; r <= maxCoord; r++) {
        for (let c = 4; c <= maxCoord; c++) {
            if (r % 4 === 0 || c % 4 === 0) {
                roadBlocks.push({ row: r, col: c });
            }
        }
    }
    const coinSpawnSlots = roadBlocks;
    const powerupSpawnSlots = roadBlocks.filter((_, i) => i % 3 === 0);
    
    return {
        width: size,
        height: size,
        blockSize: blockSize,
        tileSize: tileSize,
        spawnPositions: spawnPositions.slice(0, Math.max(9, playerCount + 2)),
        roadBlocks,
        coinSpawnSlots,
        powerupSpawnSlots,
        maxPlayers: spawnPositions.length
    };
}

export const GAME_CONFIG = {
    // Position update throttling
    POSITION_UPDATE_RATE: 16,                // Target updates per second
    POSITION_UPDATE_INTERVAL: 16,            // 30ms between updates (~33fps)
    CLIENT_POSITION_SEND_INTERVAL: 20,       // Frontend sends at 33ms (~30fps)
    
    MAX_POSITION_HISTORY: 10, // Keep last N positions for lag compensation
    POSITION_VALIDATION: {
        MAX_X: 10000, // Adjust based on your game world
        MAX_Y: 10000,
        MIN_X: -10000,
        MIN_Y: -10000
    },
    // Default spawn positions (fallback when room.mapConfig is not available)
    // Prefer using room.mapConfig.spawnPositions which is dynamic based on player count
    // All positions on valid road intersections (multiples of 4) for 30x30 city map
    SPAWN_POSITIONS: [
        { row: 4, col: 4 },      // Top-left intersection
        { row: 4, col: 24 },     // Top-right intersection (adjusted for 30x30)
        { row: 24, col: 4 },     // Bottom-left intersection
        { row: 24, col: 24 },    // Bottom-right intersection
        { row: 4, col: 12 },     // Top-center
        { row: 12, col: 4 },     // Mid-left
        { row: 12, col: 24 },    // Mid-right
        { row: 24, col: 12 },    // Bottom-center
        { row: 12, col: 12 }     // Center intersection
    ]
};

/**
 * Quizizz / external quiz (optional per room)
 * When room has quizId, blitz and unfreeze use questions from this API.
 * Base URL: use QUIZIZZ_BASE_URL env if set, else prod for NODE_ENV=production, else dev.
 */
export const QUIZIZZ_CONFIG = {
    BASE_URL_PROD: 'https://wayground.com/_quizserver/main',
    // BASE_URL_PROD: 'https://dev.quizizz.com/_quizserver/main',
    BASE_URL_DEV: 'https://dev.quizizz.com/_quizserver/main',
    QUIZ_PATH: '/v2/quiz',
    QUERY: 'convertQuestions=false&includeFsFeatures=true&sanitize=read&questionMetadata=true',
    FETCH_TIMEOUT_MS: 10000,
    /** Resolve base URL from env (QUIZIZZ_BASE_URL > NODE_ENV) */
    getBaseUrl() {
        if (typeof process !== 'undefined' && process.env?.QUIZIZZ_BASE_URL) {
            return process.env.QUIZIZZ_BASE_URL;
        }
        const isProd = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
        return isProd ? this.BASE_URL_PROD : this.BASE_URL_DEV;
    }
};