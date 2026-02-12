/**
 * Socket event handlers for connection and disconnection
 */

import { SOCKET_EVENTS } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
import log from '../utils/logger.js';

/**
 * Register connection-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {Server} io - Socket.IO server instance
 */
export function registerConnectionHandlers(socket, io) {
    // Handle new connection
    log.info({ socketId: socket.id }, 'User Connected');

    // Handle disconnection
    socket.on('disconnect', () => {
        log.info({ socketId: socket.id }, 'User Disconnected');

        const roomCode = roomManager.getRoomCodeForSocket(socket.id);
        if (!roomCode) {
            return; // Player wasn't in any room
        }

        const room = roomManager.getRoom(roomCode);
        const rlog = log.child({ roomCode, userId: room?.userId });

        try {
            gameStateManager.removePlayerPosition(roomCode, socket.id);

            const result = roomManager.removePlayerFromRoom(roomCode, socket.id);
            if (!result) {
                return;
            }

            const wasUnicornDuringGame = result.wasUnicorn && result.room?.status === 'playing';

            // If room is empty, clean up game state
            if (result.roomDeleted) {
                gameStateManager.cleanupRoom(roomCode);
                rlog.info({}, 'Room deleted (host disconnected)');
                return;
            }

            if (wasUnicornDuringGame) {
                gameStateManager.checkAndHandleUnicornLeave(roomCode, socket.id, io);
            }

            if (result.wasHost && result.newHostId) {
                io.to(result.newHostId).emit(SOCKET_EVENTS.SERVER.HOST_TRANSFERRED, {
                    room: result.room
                });
            }

            if (result.wasUnicorn && !wasUnicornDuringGame) {
                const ids = result.newUnicornIds ?? result.room?.unicornIds ?? (result.newUnicornId ? [result.newUnicornId] : []);
                if (ids.length > 0 || result.room?.unicornIds) {
                    io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                        newUnicornIds: result.newUnicornIds ?? result.room?.unicornIds ?? [],
                        newUnicornId: (result.newUnicornIds ?? result.room?.unicornIds)?.[0] ?? result.newUnicornId ?? null,
                        room: result.room
                    });
                }
            }

            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_LEFT, {
                playerId: socket.id,
                room: result.room
            });
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.ROOM_UPDATE, { room: result.room });
        } catch (error) {
            rlog.error({ err: error }, 'Error handling disconnect');
        }
    });
}
