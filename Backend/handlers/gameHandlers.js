/**
 * Socket event handlers for game operations
 */

import { SOCKET_EVENTS, ROOM_STATUS } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
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

            // Initialize game state for the room (this assigns spawn positions)
            gameStateManager.initializeRoom(roomCode);

            log(`Game started in room: ${roomCode}`);

            // Get game state with spawn positions
            const gameState = gameStateManager.getGameState(roomCode);
            
            // Notify all players in the room with initial game state
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_STARTED, { 
                room: room,
                gameState: gameState
            });
            
            // Immediately broadcast initial spawn positions to all players
            // This ensures all clients know where each player spawns before any movement
            if (gameState && gameState.players) {
                gameState.players.forEach(player => {
                    if (player.position) {
                        // Broadcast spawn position to all other players
                        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
                            playerId: player.id,
                            position: player.position
                        });
                    }
                });
            }
        } catch (error) {
            log(`Error starting game: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to start game' });
        }
    });

    // UPDATE POSITION: Player sends their updated position
    socket.on(SOCKET_EVENTS.CLIENT.UPDATE_POSITION, (positionData) => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id); // will return roomCode entry
            if (!roomCode) {
                return; // Silently ignore if not in a room
            }

            const room = roomManager.getRoom(roomCode); // getting the whole room object
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                return; // Silently ignore if game not playing
            }

            // Update position with validation and rate limiting
            const updatedPosition = gameStateManager.updatePlayerPosition(
                roomCode, 
                socket.id, 
                positionData
            );

            // If update was successful (not throttled), broadcast to other players
            if (updatedPosition) {
                // Broadcast to all other players in the room (excluding sender)
                socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
                    playerId: socket.id,
                    position: updatedPosition
                });
            }
        } catch (error) {
            log(`Error handling position update: ${error.message}`);
            // Silently fail to avoid disrupting gameplay
        }
    });

    // GAME EVENTS: Handle in-game actions/updates (non-position actions)
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

    // GET GAME STATE: Request current game state (for late joiners or reconnection)
    socket.on(SOCKET_EVENTS.CLIENT.GET_GAME_STATE, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, { gameState: null });
                return;
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, { gameState: null });
                return;
            }

            const gameState = gameStateManager.getGameState(roomCode);
            socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, { gameState: gameState });
        } catch (error) {
            log(`Error getting game state: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, { gameState: null });
        }
    });
}
