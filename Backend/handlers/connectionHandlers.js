/**
 * Socket event handlers for connection and disconnection
 */

import { SOCKET_EVENTS } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
import { log } from 'console';

/**
 * Register connection-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {Server} io - Socket.IO server instance
 */
export function registerConnectionHandlers(socket, io) {
    // Handle new connection
    log(`User Connected: ${socket.id}`);

    // Handle disconnection
    socket.on('disconnect', () => {
        log(`User Disconnected: ${socket.id}`);

        const roomCode = roomManager.getRoomCodeForSocket(socket.id);
        if (!roomCode) {
            return; // Player wasn't in any room
        }

        try {
            // Clean up player position from game state
            gameStateManager.removePlayerPosition(roomCode, socket.id);

            const result = roomManager.removePlayerFromRoom(roomCode, socket.id);
            if (!result) {
                return;
            }

            // If room is empty, clean up game state
            if (result.roomDeleted) {
                gameStateManager.cleanupRoom(roomCode);
                log(`Room ${roomCode} deleted (host disconnected)`);
                return;
            }

            // If host disconnected and there are other players, notify new host
            if (result.wasHost && result.newHostId) {
                io.to(result.newHostId).emit(SOCKET_EVENTS.SERVER.HOST_TRANSFERRED, {
                    room: result.room
                });
            }

            // Notify remaining players about player leaving
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_LEFT, {
                playerId: socket.id,
                room: result.room
            });
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.ROOM_UPDATE, { room: result.room });
        } catch (error) {
            log(`Error handling disconnect: ${error.message}`);
        }
    });
}
