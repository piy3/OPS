/**
 * Socket event handlers for room operations
 */

import { SOCKET_EVENTS } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
import { log } from 'console';

/**
 * Register room-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {Server} io - Socket.IO server instance
 */
export function registerRoomHandlers(socket, io) {
    // CREATE ROOM: Player creates a new game room
    socket.on(SOCKET_EVENTS.CLIENT.CREATE_ROOM, (playerData) => {
        try {
            const room = roomManager.createRoom(socket.id, playerData);
            socket.join(room.code);

            log(`Room created: ${room.code} by ${socket.id}`);

            socket.emit(SOCKET_EVENTS.SERVER.ROOM_CREATED, {
                roomCode: room.code,
                room: room
            });
        } catch (error) {
            log(`Error creating room: ${error.message}`);
            socket.emit('error', { message: 'Failed to create room' });
        }
    });

    // JOIN ROOM: Player joins an existing room using room code
    socket.on(SOCKET_EVENTS.CLIENT.JOIN_ROOM, (data) => {
        try {
            const { roomCode, playerName } = data || {};

            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Room code is required' });
                return;
            }

            // Validate join request
            const validation = roomManager.validateJoinRoom(roomCode, socket.id);
            if (!validation.valid) {
                socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: validation.error });
                return;
            }

            // Add player to room (returns player + mapConfig change info)
            const result = roomManager.addPlayerToRoom(roomCode, socket.id, playerName);
            if (!result || !result.player) {
                socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Failed to join room' });
                return;
            }
            
            const { player, mapConfigChanged } = result;

            socket.join(roomCode);
            const room = roomManager.getRoom(roomCode);

            log(`Player ${socket.id} joined room: ${roomCode}`);

            // Notify the joining player (includes current mapConfig in room)
            socket.emit(SOCKET_EVENTS.SERVER.ROOM_JOINED, {
                roomCode: roomCode,
                room: room
            });

            // Notify all other players in the room
            socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_JOINED, {
                player: player,
                room: room
            });

            // Broadcast updated room state to all players (includes mapConfig)
            // If map config changed, this will propagate the new config to all clients
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.ROOM_UPDATE, { 
                room: room,
                mapConfigChanged: mapConfigChanged 
            });
        } catch (error) {
            log(`Error joining room: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Failed to join room' });
        }
    });

    // LEAVE ROOM: Player leaves the room
    socket.on(SOCKET_EVENTS.CLIENT.LEAVE_ROOM, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.LEAVE_ERROR, { message: 'Not in any room' });
                return;
            }

            // Clean up player position from game state first
            gameStateManager.removePlayerPosition(roomCode, socket.id);

            const result = roomManager.removePlayerFromRoom(roomCode, socket.id);
            if (!result) {
                socket.emit(SOCKET_EVENTS.SERVER.LEAVE_ERROR, { message: 'Failed to leave room' });
                return;
            }

            const wasUnicornDuringGame = result.wasUnicorn && result.room?.status === 'playing';

            socket.leave(roomCode);
            log(`Player ${socket.id} left room: ${roomCode}`);

            // If room is empty, clean up game state
            if (result.roomDeleted) {
                gameStateManager.cleanupRoom(roomCode);
                log(`Room ${roomCode} deleted (empty)`);
            } else {
                // If unicorn left during active game: sync clients or trigger new blitz
                if (wasUnicornDuringGame) {
                    gameStateManager.checkAndHandleUnicornLeave(roomCode, socket.id, io);
                }

                // If host left and there are other players, notify new host
                if (result.wasHost && result.newHostId) {
                    io.to(result.newHostId).emit(SOCKET_EVENTS.SERVER.HOST_TRANSFERRED, {
                        room: result.room
                    });
                }

                // If unicorn left during WAITING phase: emit updated unicorn set
                if (result.wasUnicorn && !wasUnicornDuringGame) {
                    const ids = result.newUnicornIds ?? result.room?.unicornIds ?? [];
                    io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                        newUnicornIds: ids,
                        newUnicornId: ids[0] ?? null,
                        room: result.room
                    });
                    if (ids.length > 0) {
                        log(`Unicorns updated in room ${roomCode}: ${ids.join(', ')}`);
                    }
                }

                // Notify remaining players
                socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_LEFT, {
                    playerId: socket.id,
                    room: result.room
                });
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.ROOM_UPDATE, { 
                    room: result.room,
                    mapConfigChanged: result.mapConfigChanged
                });
            }

            socket.emit(SOCKET_EVENTS.SERVER.ROOM_LEFT, { roomCode: roomCode });
        } catch (error) {
            log(`Error leaving room: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.LEAVE_ERROR, { message: 'Failed to leave room' });
        }
    });

    // GET ROOM INFO: Get current room information
    socket.on(SOCKET_EVENTS.CLIENT.GET_ROOM_INFO, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.ROOM_INFO, { room: null });
                return;
            }

            const room = roomManager.getRoom(roomCode);
            socket.emit(SOCKET_EVENTS.SERVER.ROOM_INFO, { room: room || null });
        } catch (error) {
            log(`Error getting room info: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.ROOM_INFO, { room: null });
        }
    });
}
