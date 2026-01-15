/**
 * Socket.IO service for client-server communication
 */

import { io } from 'socket.io-client';

// Socket configuration
const SOCKET_URL = 'http://localhost:3000';

class SocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
  }

  /**
   * Connect to the Socket.IO server
   */
  connect() {
    if (this.socket && this.connected) {
      console.log('Socket already connected');
      return this.socket;
    }

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket.id);
      this.connected = true;
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      this.connected = false;
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    return this.socket;
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.socket) {
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
  createRoom(playerName, maxPlayers = 9) {
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
