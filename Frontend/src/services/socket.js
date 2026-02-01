/**
 * Socket.IO service for client-server communication
 */

import { io } from 'socket.io-client';
import log from '../utils/logger';
import { MAX_ALLOWED_PLAYER_IN_ROOM } from '../config/characters';

// Socket configuration from environment variable
// In Vite, use import.meta.env (not process.env)
const ENV = import.meta.env.VITE_ENV || 'dev';
const SOCKET_URL = ENV === 'prod' 
  ? import.meta.env.VITE_PROD_URL 
  : import.meta.env.VITE_DEV_URL;

log.log('Environment:', ENV);
log.log('Socket URL:', SOCKET_URL);

class SocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.connectionCount = 0; // Track connection attempts
  }

  /**
   * Connect to the Socket.IO server
   */
  connect() {
    // If socket exists and is connected, return it
    if (this.socket && this.socket.connected) {
      log.log('Socket already connected');
      return this.socket;
    }

    // If socket exists but disconnected, try to reconnect existing socket
    if (this.socket && !this.socket.connected) {
      log.log('Reconnecting existing socket');
      this.socket.connect();
      return this.socket;
    }

    // Only create new socket if one doesn't exist
    this.connectionCount++;
    log.log(`Creating new socket connection (attempt ${this.connectionCount})`);

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    this.socket.on('connect', () => {
      log.log('Socket connected:', this.socket.id);
      this.connected = true;
    });

    this.socket.on('disconnect', () => {
      log.log('Socket disconnected');
      this.connected = false;
    });

    this.socket.on('connect_error', (error) => {
      log.error('Socket connection error:', error);
    });

    return this.socket;
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.socket) {
      log.log('Disconnecting socket');
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Get the socket instance
   */
  getSocket() {
    if (!this.socket) {
      this.connect();
    }
    return this.socket;
  }

  /**
   * Check if socket is connected
   */
  isConnected() {
    return this.connected && this.socket !== null;
  }

  // Room Management Events

  /**
   * Create a new room
   */
  createRoom(playerName, maxPlayers = MAX_ALLOWED_PLAYER_IN_ROOM) {
    return new Promise((resolve, reject) => {
      const socket = this.getSocket();
      
      socket.emit('create_room', { name: playerName, maxPlayers });
      
      socket.once('room_created', (data) => {
        resolve(data);
      });

      socket.once('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Join an existing room
   */
  joinRoom(roomCode, playerName) {
    return new Promise((resolve, reject) => {
      const socket = this.getSocket();
      
      socket.emit('join_room', { roomCode, playerName });
      
      socket.once('room_joined', (data) => {
        resolve(data);
      });

      socket.once('join_error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Leave the current room
   */
  leaveRoom() {
    const socket = this.getSocket();
    socket.emit('leave_room');
  }

  /**
   * Start the game (host only)
   */
  startGame() {
    const socket = this.getSocket();
    socket.emit('start_game');
  }

  /**
   * Get current room info
   */
  getRoomInfo() {
    const socket = this.getSocket();
    socket.emit('get_room_info');
  }

  // Game Events

  /**
   * Send position update
   */
  updatePosition(positionData) {
    const socket = this.getSocket();
    socket.emit('update_position', positionData);
  }

  /**
   * Send game action
   */
  sendGameAction(actionData) {
    const socket = this.getSocket();
    socket.emit('game_action', actionData);
  }

  /**
   * Get current game state
   */
  getGameState() {
    const socket = this.getSocket();
    socket.emit('get_game_state');
  }

  // Event Listeners

  /**
   * Listen for player joined event
   */
  onPlayerJoined(callback) {
    const socket = this.getSocket();
    socket.on('player_joined', callback);
  }

  /**
   * Listen for player left event
   */
  onPlayerLeft(callback) {
    const socket = this.getSocket();
    socket.on('player_left', callback);
  }

  /**
   * Listen for room update event
   */
  onRoomUpdate(callback) {
    const socket = this.getSocket();
    socket.on('room_update', callback);
  }

  /**
   * Listen for game started event
   */
  onGameStarted(callback) {
    const socket = this.getSocket();
    socket.on('game_started', callback);
  }

  /**
   * Listen for position updates from other players
   */
  onPlayerPositionUpdate(callback) {
    const socket = this.getSocket();
    socket.on('player_position_update', callback);
  }

  /**
   * Listen for game state sync
   */
  onGameStateSync(callback) {
    const socket = this.getSocket();
    socket.on('game_state_sync', callback);
  }

  /**
   * Listen for host transferred event
   */
  onHostTransferred(callback) {
    const socket = this.getSocket();
    socket.on('host_transferred', callback);
  }

  /**
   * Listen for unicorn transferred event
   */
  onUnicornTransferred(callback) {
    const socket = this.getSocket();
    socket.on('unicorn_transferred', callback);
  }

  /**
   * Listen for score update event
   */
  onScoreUpdate(callback) {
    const socket = this.getSocket();
    socket.on('score_update', callback);
  }

  /**
   * Listen for game frozen event
   */
  onGameFrozen(callback) {
    const socket = this.getSocket();
    socket.on('game_frozen', callback);
  }

  /**
   * Listen for quiz start event
   */
  onQuizStart(callback) {
    const socket = this.getSocket();
    socket.on('quiz_start', callback);
  }

  /**
   * Listen for quiz answer result event
   */
  onQuizAnswerResult(callback) {
    const socket = this.getSocket();
    socket.on('quiz_answer_result', callback);
  }

  /**
   * Listen for quiz complete event
   */
  onQuizComplete(callback) {
    const socket = this.getSocket();
    socket.on('quiz_complete', callback);
  }

  /**
   * Submit quiz answer
   */
  submitQuizAnswer(questionId, answerIndex) {
    const socket = this.getSocket();
    socket.emit('submit_quiz_answer', { questionId, answerIndex });
  }

  // ========== BLITZ QUIZ EVENTS ==========

  /**
   * Submit Blitz Quiz answer
   */
  submitBlitzAnswer(answerIndex) {
    const socket = this.getSocket();
    socket.emit('blitz_answer', { answerIndex });
  }

  /**
   * Listen for phase change event
   */
  onPhaseChange(callback) {
    const socket = this.getSocket();
    socket.on('phase_change', callback);
  }

  /**
   * Listen for Blitz start event
   */
  onBlitzStart(callback) {
    const socket = this.getSocket();
    socket.on('blitz_start', callback);
  }

  /**
   * Listen for Blitz Quiz answer result
   */
  onBlitzAnswerResult(callback) {
    const socket = this.getSocket();
    socket.on('blitz_answer_result', callback);
  }

  /**
   * Listen for Blitz result event (role assignments)
   */
  onBlitzResult(callback) {
    const socket = this.getSocket();
    socket.on('blitz_result', callback);
  }

  /**
   * Listen for Hunt phase start event
   */
  onHuntStart(callback) {
    const socket = this.getSocket();
    socket.on('hunt_start', callback);
  }

  /**
   * Listen for Hunt end event
   */
  onHuntEnd(callback) {
    const socket = this.getSocket();
    socket.on('hunt_end', callback);
  }

  /**
   * Listen for player tagged event
   */
  onPlayerTagged(callback) {
    const socket = this.getSocket();
    socket.on('player_tagged', callback);
  }

  /**
   * Listen for reserve unicorn activated event
   */
  onReserveActivated(callback) {
    const socket = this.getSocket();
    socket.on('reserve_activated', callback);
  }

  // ========== COMBAT SYSTEM EVENTS ==========

  /**
   * Listen for player hit event
   */
  onPlayerHit(callback) {
    const socket = this.getSocket();
    socket.on('player_hit', callback);
  }

  /**
   * Listen for player respawn event
   */
  onPlayerRespawn(callback) {
    const socket = this.getSocket();
    socket.on('player_respawn', callback);
  }

  /**
   * Listen for player state change event
   */
  onPlayerStateChange(callback) {
    const socket = this.getSocket();
    socket.on('player_state_change', callback);
  }

  /**
   * Listen for health update event
   */
  onHealthUpdate(callback) {
    const socket = this.getSocket();
    socket.on('health_update', callback);
  }

  // ========== COIN EVENTS ==========

  /**
   * Listen for coin spawned event (initial spawn and respawn)
   */
  onCoinSpawned(callback) {
    const socket = this.getSocket();
    socket.on('coin_spawned', callback);
  }

  /**
   * Listen for coin collected event
   */
  onCoinCollected(callback) {
    const socket = this.getSocket();
    socket.on('coin_collected', callback);
  }

  // ========== POWERUP EVENTS ==========

  /**
   * Listen for powerup spawned event
   */
  onPowerupSpawned(callback) {
    const socket = this.getSocket();
    socket.on('powerup_spawned', callback);
  }

  /**
   * Listen for powerup collected event
   */
  onPowerupCollected(callback) {
    const socket = this.getSocket();
    socket.on('powerup_collected', callback);
  }

  /**
   * Listen for powerup activated event
   */
  onPowerupActivated(callback) {
    const socket = this.getSocket();
    socket.on('powerup_activated', callback);
  }

  /**
   * Listen for powerup expired event
   */
  onPowerupExpired(callback) {
    const socket = this.getSocket();
    socket.on('powerup_expired', callback);
  }

  // ========== UNFREEZE QUIZ EVENTS ==========

  /**
   * Submit Unfreeze Quiz answer
   */
  submitUnfreezeQuizAnswer(questionIndex, answerIndex) {
    const socket = this.getSocket();
    socket.emit('submit_unfreeze_quiz_answer', { questionIndex, answerIndex });
  }

  /**
   * Listen for unfreeze quiz start event
   */
  onUnfreezeQuizStart(callback) {
    const socket = this.getSocket();
    socket.on('unfreeze_quiz_start', callback);
  }

  /**
   * Listen for unfreeze quiz answer result event
   */
  onUnfreezeQuizAnswerResult(callback) {
    const socket = this.getSocket();
    socket.on('unfreeze_quiz_answer_result', callback);
  }

  /**
   * Listen for unfreeze quiz complete event
   */
  onUnfreezeQuizComplete(callback) {
    const socket = this.getSocket();
    socket.on('unfreeze_quiz_complete', callback);
  }

  /**
   * Listen for unfreeze quiz cancelled event
   */
  onUnfreezeQuizCancelled(callback) {
    const socket = this.getSocket();
    socket.on('unfreeze_quiz_cancelled', callback);
  }

  // ========== GAME END EVENTS ==========

  /**
   * Listen for game end event (all rounds completed)
   */
  onGameEnd(callback) {
    const socket = this.getSocket();
    socket.on('game_end', callback);
  }

  /**
   * Remove event listener
   */
  off(eventName, callback) {
    const socket = this.getSocket();
    if (callback) {
      socket.off(eventName, callback);
    } else {
      socket.off(eventName);
    }
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners(eventName) {
    const socket = this.getSocket();
    socket.removeAllListeners(eventName);
  }
}

// Export singleton instance
export default new SocketService();
