/**
 * Socket event handlers for game operations
 */

import { SOCKET_EVENTS, ROOM_STATUS } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import { log } from 'console';

/**
 * Register game-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {Server} io - Socket.IO server instance
 */
export function registerGameHandlers(socket, io) {
    // START GAME: Host starts the game
    socket.on(SOCKET_EVENTS.CLIENT.START_GAME, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Not in any room' });
                return;
            }

            // Validate start game request
            const validation = roomManager.validateStartGame(roomCode, socket.id);
            if (!validation.valid) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: validation.error });
                return;
            }

            // Start the game
            const room = roomManager.startGame(roomCode);
            if (!room) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to start game' });
                return;
            }

            log(`Game started in room: ${roomCode}`);

            // Notify all players in the room
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_STARTED, { room: room });
        } catch (error) {
            log(`Error starting game: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to start game' });
        }
    });

    // GAME EVENTS: Handle in-game actions/updates
    socket.on(SOCKET_EVENTS.CLIENT.GAME_ACTION, (actionData) => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                return; // Silently ignore if not in a room
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                return; // Silently ignore if game not playing
            }

            // Broadcast action to all other players in the room
            socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_ACTION, {
                playerId: socket.id,
                action: actionData
            });
        } catch (error) {
            log(`Error handling game action: ${error.message}`);
            // Silently fail for game actions to avoid disrupting gameplay
        }
    });
}
