/**
 * Socket helper utilities for common patterns
 */

import roomManager from '../services/RoomManager.js';
import { ROOM_STATUS } from '../config/constants.js';

/**
 * Get active room for a socket with optional status validation
 * Consolidates the common pattern of:
 *   const roomCode = roomManager.getRoomCodeForSocket(socket.id);
 *   if (!roomCode) return;
 *   const room = roomManager.getRoom(roomCode);
 *   if (!room || room.status !== requiredStatus) return;
 * 
 * @param {Socket} socket - Socket instance
 * @param {string|null} requiredStatus - Required room status (null for any status)
 * @returns {{ roomCode: string, room: Object }|null} Room data or null if validation fails
 */
export function getActiveRoom(socket, requiredStatus = null) {
  const roomCode = roomManager.getRoomCodeForSocket(socket.id);
  if (!roomCode) return null;
  
  const room = roomManager.getRoom(roomCode);
  if (!room) return null;
  
  if (requiredStatus && room.status !== requiredStatus) return null;
  
  return { roomCode, room };
}

/**
 * Get playing room for a socket
 * Shorthand for getActiveRoom(socket, ROOM_STATUS.PLAYING)
 * 
 * @param {Socket} socket - Socket instance
 * @returns {{ roomCode: string, room: Object }|null} Room data or null if not in a playing game
 */
export function getPlayingRoom(socket) {
  return getActiveRoom(socket, ROOM_STATUS.PLAYING);
}

/**
 * Get room code for socket (simple pass-through for consistency)
 * 
 * @param {string} socketId - Socket ID
 * @returns {string|null} Room code or null
 */
export function getRoomCode(socketId) {
  return roomManager.getRoomCodeForSocket(socketId);
}
