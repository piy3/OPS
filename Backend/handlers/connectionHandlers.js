/**
 * Socket event handlers for connection and disconnection
 */

import { SOCKET_EVENTS, ROOM_CONFIG } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
import log from '../utils/logger.js';

const RECONNECT_GRACE_PERIOD = ROOM_CONFIG.RECONNECT_GRACE_PERIOD_MS || 10000;

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
        if (!room) {
            return;
        }

        // Get player info before marking as disconnected
        const player = roomManager.getPlayerBySocketId(roomCode, socket.id);
        if (!player) {
            return; // Player not found (shouldn't happen)
        }

        const playerId = player.playerId;
        const playerName = player.name;

        try {
            // Check if game is in progress - if so, use grace period
            if (room.status === 'playing') {
                // Mark player as disconnected but don't remove yet
                roomManager.markPlayerDisconnected(roomCode, socket.id);

                // Notify others that player is temporarily disconnected
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_DISCONNECTED, {
                    playerId: playerId,
                    socketId: socket.id,
                    playerName: playerName
                });

                rlog.info({}, 'starting grace period');

                // Start grace period timer
                const timer = setTimeout(() => {
                    // Check if player is still disconnected
                    const currentPlayer = roomManager.getPlayerByPlayerId(roomCode, playerId);
                    if (currentPlayer && currentPlayer.disconnectedAt) {
                        rlog.info({}, 'grace period expired for player');
                        
                        // Player didn't reconnect within grace period - remove permanently
                        permanentlyRemovePlayer(roomCode, socket.id, playerId, io);
                    }
                }, RECONNECT_GRACE_PERIOD);

                // Store the timer so it can be cancelled on reconnect
                roomManager.setDisconnectTimer(playerId, timer);
            } else {
                // Game not in progress - remove immediately (no grace period needed)
                permanentlyRemovePlayer(roomCode, socket.id, playerId, io);
            }
        } catch (error) {
            rlog.error({ err: error }, 'Error handling disconnect');
        }
    });
}

/**
 * Permanently remove a player from the room
 * Called either immediately (if game not in progress) or after grace period expires
 * @param {string} roomCode - Room code
 * @param {string} socketId - Socket ID of the player
 * @param {string} playerId - Persistent player ID
 * @param {Server} io - Socket.IO server instance
 */
function permanentlyRemovePlayer(roomCode, socketId, playerId, io) {
    try {
        // Remove player position from game state
        // Pass both socket ID (for position) and persistent playerId (for combat state)
        gameStateManager.removePlayerPosition(roomCode, socketId, playerId);

        // Remove player from room (by playerId to ensure we get the right one)
        const result = roomManager.removePlayerFromRoom(roomCode, playerId, true);
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
            gameStateManager.checkAndHandleUnicornLeave(roomCode, socketId, io);
        }

        if (result.wasHost && result.newHostId) {
            io.to(result.newHostId).emit(SOCKET_EVENTS.SERVER.HOST_TRANSFERRED, {
                room: result.room
            });
        }

        if (result.wasUnicorn && !wasUnicornDuringGame) {
            const ids = result.newUnicornIds ?? result.room?.unicornIds ?? [];
            if (ids.length > 0) {
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                    newUnicornIds: ids,
                    newUnicornId: ids[0] ?? null,
                    room: result.room
                });
            }
        }

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_LEFT, {
            playerId: playerId,
            socketId: socketId,
            room: result.room
        });
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.ROOM_UPDATE, { room: result.room });
    } catch (error) {
        log.error({ err: error, roomCode, socketId, playerId }, 'Error permanently removing player');
    }
}
