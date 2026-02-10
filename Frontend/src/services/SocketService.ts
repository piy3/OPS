/**
 * Socket.IO Service for multiplayer game communication
 * Handles connection management and event handling
 */

import { io, Socket } from 'socket.io-client';
import logger from '@/utils/logger';

// Socket configuration from environment variables
// In Vite, use import.meta.env (not process.env)
const ENV = import.meta.env.VITE_ENV || 'dev';

/**
 * Determine Socket.IO connection URL and path.
 *
 * Uses import.meta.env.BASE_URL (set by Vite at build time) to derive the
 * socket path. This is '/' for local/docker-start and '/play-api/way-maze/'
 * for docker-start-prod. No runtime guessing needed.
 *
 * When VITE_DEV_URL is set (local dev without Docker), connect directly to that URL.
 * Otherwise connect to same origin and let nginx proxy.
 */
function getSocketConfig(): { url: string | undefined; path: string } {
  // If an explicit dev URL is set, use it (local dev without Docker)
  if (import.meta.env.VITE_DEV_URL) {
    return {
      url: import.meta.env.VITE_DEV_URL,
      path: '/socket.io/',
    };
  }
  // Same origin — nginx proxies to backend.
  // BASE_URL is '/' or '/play-api/way-maze/' depending on build.
  const base = import.meta.env.BASE_URL.replace(/\/$/, ''); // strip trailing slash
  return {
    url: undefined,
    path: `${base}/socket.io/`,
  };
}

const socketConfig = getSocketConfig();

logger.socket('Environment:', ENV);
logger.socket('Socket URL:', socketConfig.url ?? '(same origin)');
logger.socket('Socket path:', socketConfig.path);

// Tile size for coordinate conversion (must match frontend Game.tsx)
const TILE_SIZE = 64;

// Socket events from backend
export const SOCKET_EVENTS = {
  // Client -> Server
  CLIENT: {
    CREATE_ROOM: 'create_room',
    JOIN_ROOM: 'join_room',
    LEAVE_ROOM: 'leave_room',
    START_GAME: 'start_game',
    UPDATE_POSITION: 'update_position',
    GET_ROOM_INFO: 'get_room_info',
    GET_GAME_STATE: 'get_game_state',
    SUBMIT_QUIZ_ANSWER: 'submit_quiz_answer',
    BLITZ_ANSWER: 'blitz_answer',
    COLLECT_COIN: 'collect_coin',
    SUBMIT_UNFREEZE_QUIZ_ANSWER: 'submit_unfreeze_quiz_answer',
    ENTER_SINKHOLE: 'enter_sinkhole',
    COLLECT_SINK_TRAP: 'collect_sink_trap',
    DEPLOY_SINK_TRAP: 'deploy_sink_trap',
    LAVA_DEATH: 'lava_death',
    REQUEST_UNFREEZE_QUIZ: 'request_unfreeze_quiz',  // Request quiz data if frozen but missing quiz
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
    PHASE_CHANGE: 'phase_change',
    BLITZ_START: 'blitz_start',
    BLITZ_ANSWER_RESULT: 'blitz_answer_result',
    BLITZ_RESULT: 'blitz_result',
    HUNT_START: 'hunt_start',
    HUNT_END: 'hunt_end',
    PLAYER_TAGGED: 'player_tagged',
    RESERVE_ACTIVATED: 'reserve_activated',
    PLAYER_HIT: 'player_hit',
    PLAYER_RESPAWN: 'player_respawn',
    PLAYER_STATE_CHANGE: 'player_state_change',
    HEALTH_UPDATE: 'health_update',
    COIN_SPAWNED: 'coin_spawned',
    COIN_COLLECTED: 'coin_collected',
    UNFREEZE_QUIZ_START: 'unfreeze_quiz_start',
    UNFREEZE_QUIZ_ANSWER_RESULT: 'unfreeze_quiz_answer_result',
    UNFREEZE_QUIZ_COMPLETE: 'unfreeze_quiz_complete',
    UNFREEZE_QUIZ_CANCELLED: 'unfreeze_quiz_cancelled',
    GAME_END: 'game_end',
    // Sinkhole events (new)
    SINKHOLE_SPAWNED: 'sinkhole_spawned',
    PLAYER_TELEPORTED: 'player_teleported',
    // Sink trap events (new)
    SINK_TRAP_SPAWNED: 'sink_trap_spawned',
    SINK_TRAP_COLLECTED: 'sink_trap_collected',
    SINK_TRAP_DEPLOYED: 'sink_trap_deployed',
    SINK_TRAP_TRIGGERED: 'sink_trap_triggered',
    // Player elimination (instant kill mode)
    PLAYER_ELIMINATED: 'player_eliminated',
  }
};

// Types for game data
export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isUnicorn: boolean;
  coins: number;
  health: number;
  state: 'active' | 'frozen' | 'in_iframes' | 'eliminated';
  position?: {
    x: number;
    y: number;
    row: number;
    col: number;
  };
}

export interface MapConfig {
  width: number;
  height: number;
  blockSize: number;
  tileSize: number;
  spawnPositions: { row: number; col: number }[];
  coinSpawnSlots?: { row: number; col: number }[];
  powerupSpawnSlots?: { row: number; col: number }[];
  maxPlayers?: number;
}

export interface Room {
  code: string;
  players: Player[];
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'finished';
  hostId: string;
  unicornIds?: string[];
  unicornId?: string;
  mapConfig?: MapConfig;
  /** Optional Quizizz quiz ID; when set, blitz and unfreeze use questions from Quizizz */
  quizId?: string | null;
  /** Teacher ID when room created by teacher (teacher is not in players array) */
  teacherId?: string | null;
}

export interface Coin {
  id: string;
  row: number;
  col: number;
}

export interface Sinkhole {
  id: string;
  row: number;
  col: number;
}

export interface SinkTrap {
  id: string;
  row: number;
  col: number;
  deployedBy?: string;
}

export interface GameState {
  phase: 'waiting' | 'blitz_quiz' | 'hunt' | 'round_end' | 'game_end';
  players: Record<string, Player>;
  coins: Coin[];
  sinkholes: Sinkhole[];
  sinkTraps: SinkTrap[];
  deployedSinkTraps: SinkTrap[];
  unicornIds?: string[];
  unicornId?: string;
  currentRound: number;
  totalRounds: number;
}

// Coordinate conversion utilities
export const toGrid = (x: number, y: number) => ({
  row: Math.floor(y / TILE_SIZE),
  col: Math.floor(x / TILE_SIZE)
});

export const toPixel = (row: number, col: number) => ({
  x: col * TILE_SIZE + TILE_SIZE / 2,  // Center of tile
  y: row * TILE_SIZE + TILE_SIZE / 2
});

// Singleton socket instance
class SocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();

  // Connect to the server
  connect(): Socket {
    // If socket exists and is connected, return it
    if (this.socket?.connected) {
      logger.socket('Already connected to server:', this.socket.id);
      return this.socket;
    }

    // If socket exists but not connected, disconnect and create new
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    logger.socket('Connecting to server:', socketConfig.url ?? '(same origin)', 'path:', socketConfig.path);

    const connectOpts = {
      path: socketConfig.path,
      transports: ['polling', 'websocket'] as ('polling' | 'websocket')[],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
      forceNew: true,
    };

    // When URL is undefined (production), io() connects to same origin
    this.socket = socketConfig.url
      ? io(socketConfig.url, connectOpts)
      : io(connectOpts);

    this.socket.on('connect', () => {
      logger.socket('✅ Connected to server:', this.socket?.id);
      this.connectionListeners.forEach(cb => cb(true));
    });

    this.socket.on('disconnect', (reason) => {
      logger.socket('❌ Disconnected from server:', reason);
      this.connectionListeners.forEach(cb => cb(false));
    });

    this.socket.on('connect_error', (error) => {
      logger.error('❌ Connection error:', error.message);
      this.connectionListeners.forEach(cb => cb(false));
    });

    this.socket.on('error', (error) => {
      logger.error('❌ Socket error:', error);
    });

    // Re-register all listeners
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach(callback => {
        this.socket?.on(event, callback);
      });
    });

    return this.socket;
  }

  // Disconnect from server
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Get socket instance
  getSocket(): Socket | null {
    return this.socket;
  }

  // Get socket ID
  getSocketId(): string | null {
    return this.socket?.id || null;
  }

  // Check if connected
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  // Subscribe to connection state changes
  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connectionListeners.add(callback);
    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  // Emit an event
  emit(event: string, data?: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      logger.warn('Socket not connected, cannot emit:', event);
    }
  }

  // Subscribe to an event
  on(event: string, callback: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    if (this.socket) {
      this.socket.on(event, callback);
    }

    // Return unsubscribe function
    return () => {
      this.off(event, callback);
    };
  }

  // Unsubscribe from an event
  off(event: string, callback: (data: any) => void) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  // Room operations
  createRoom(name: string, maxPlayers: number = 30, quizId?: string, isTeacher?: boolean) {
    const payload: { name: string; maxPlayers: number; quizId?: string; isTeacher?: boolean } = { name, maxPlayers };
    if (quizId?.trim()) payload.quizId = quizId.trim();
    if (isTeacher) payload.isTeacher = true;
    this.emit(SOCKET_EVENTS.CLIENT.CREATE_ROOM, payload);
  }

  joinRoom(roomCode: string, playerName: string) {
    this.emit(SOCKET_EVENTS.CLIENT.JOIN_ROOM, { roomCode, playerName });
  }

  leaveRoom() {
    this.emit(SOCKET_EVENTS.CLIENT.LEAVE_ROOM, {});
  }

  startGame() {
    this.emit(SOCKET_EVENTS.CLIENT.START_GAME, {});
  }

  // Position updates
  private lastPositionUpdate = 0;
  private POSITION_UPDATE_INTERVAL = 20; // ~30fps

  updatePosition(x: number, y: number, dirX: number, dirY: number, velocity?: { x: number; y: number }) {
    const now = Date.now();
    if (now - this.lastPositionUpdate < this.POSITION_UPDATE_INTERVAL) {
      return; // Throttle updates
    }
    this.lastPositionUpdate = now;

    const grid = toGrid(x, y);
    this.emit(SOCKET_EVENTS.CLIENT.UPDATE_POSITION, {
      x,
      y,
      row: grid.row,
      col: grid.col,
      dirX,
      dirY,
      velocity,
      timestamp: now
    });
  }

  // Game actions
  submitBlitzAnswer(answerIndex: number) {
    this.emit(SOCKET_EVENTS.CLIENT.BLITZ_ANSWER, { answerIndex });
  }

  collectCoin(coinId: string) {
    this.emit(SOCKET_EVENTS.CLIENT.COLLECT_COIN, { coinId });
  }

  enterSinkhole(sinkholeId: string) {
    this.emit(SOCKET_EVENTS.CLIENT.ENTER_SINKHOLE, { sinkholeId });
  }

  collectSinkTrap(trapId: string) {
    this.emit(SOCKET_EVENTS.CLIENT.COLLECT_SINK_TRAP, { trapId });
  }

  deploySinkTrap(x: number, y: number) {
    const grid = toGrid(x, y);
    this.emit(SOCKET_EVENTS.CLIENT.DEPLOY_SINK_TRAP, { row: grid.row, col: grid.col });
  }

  getGameState() {
    this.emit(SOCKET_EVENTS.CLIENT.GET_GAME_STATE, {});
  }

  /**
   * Submit an answer for the unfreeze quiz (when frozen after being tagged)
   * @param questionIndex - Index of the question (0 or 1)
   * @param answerIndex - Index of the selected answer
   */
  submitUnfreezeAnswer(questionIndex: number, answerIndex: number) {
    this.emit(SOCKET_EVENTS.CLIENT.SUBMIT_UNFREEZE_QUIZ_ANSWER, {
      questionIndex,
      answerIndex
    });
  }

  /**
   * Notify server that player fell in lava (triggers freeze + unfreeze quiz)
   */
  reportLavaDeath() {
    this.emit(SOCKET_EVENTS.CLIENT.LAVA_DEATH, {});
  }

  /**
   * Request unfreeze quiz data from server (for reconnection recovery)
   * Used when client knows it's frozen but didn't receive quiz data
   */
  requestUnfreezeQuiz() {
    this.emit(SOCKET_EVENTS.CLIENT.REQUEST_UNFREEZE_QUIZ, {});
  }
}

// Export singleton instance
export const socketService = new SocketService();
export default socketService;
