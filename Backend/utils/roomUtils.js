/**
 * Utility functions for room operations
 */

import { ROOM_CONFIG } from '../config/constants.js';

/**
 * Generate a unique room code
 * @param {Map} rooms - Map of existing rooms
 * @returns {string} Unique room code
 */
export function generateRoomCode(rooms) {
    const chars = ROOM_CONFIG.ROOM_CODE_CHARS;
    let code = '';
    do {
        code = '';
        for (let i = 0; i < ROOM_CONFIG.ROOM_CODE_LENGTH; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (rooms.has(code)); // Ensure uniqueness
    return code;
}

/**
 * Get room code for a given socket ID
 * @param {Map} rooms - Map of existing rooms
 * @param {string} socketId - Socket ID to search for
 * @returns {string|null} Room code if found, null otherwise
 */
export function getRoomCodeForSocket(rooms, socketId) {
    for (const [code, room] of rooms.entries()) {
        if (room.hostId === socketId || room.players.some(p => p.id === socketId)) {
            return code;
        }
    }
    return null;
}

/**
 * Generate default player name from socket ID
 * @param {string} socketId - Socket ID
 * @returns {string} Default player name
 */
export function generateDefaultPlayerName(socketId) {
    return `Player ${socketId.substring(0, 6)}`;
}
