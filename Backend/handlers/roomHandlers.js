/**
 * Socket event handlers for room operations
 */

import { SOCKET_EVENTS } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
import log from '../utils/logger.js';

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

            const rlog = log.child({ roomCode: room.code, userId: room.userId });
            rlog.info({ socketId: socket.id }, 'Room created');

            socket.emit(SOCKET_EVENTS.SERVER.ROOM_CREATED, {
                roomCode: room.code,
                room: room
            });
        } catch (error) {
            log.error({ err: error }, 'Error creating room');
            socket.emit('error', { message: 'Failed to create room' });
        }
    });

    // JOIN ROOM: Player joins an existing room using room code
    socket.on(SOCKET_EVENTS.CLIENT.JOIN_ROOM, (data) => {
        try {
            const { roomCode, playerName, playerId } = data || {};

            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Room code is required' });
                return;
            }

            // Validate join request (pass playerId for reconnection detection)
            const validation = roomManager.validateJoinRoom(roomCode, socket.id, playerId);
            if (!validation.valid) {
                socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: validation.error });
                return;
            }

            // If this is a rejoin (player already exists with this playerId), handle as reconnect
            if (validation.isRejoin && playerId) {
                handleRejoin(socket, io, roomCode, playerId, playerName);
                return;
            }

            // Add player to room (returns player + mapConfig change info)
            const result = roomManager.addPlayerToRoom(roomCode, socket.id, playerName, playerId);
            if (!result || !result.player) {
                socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Failed to join room' });
                return;
            }
            
            const { player, mapConfigChanged } = result;

            socket.join(roomCode);
            const room = roomManager.getRoom(roomCode);

            const rlog = log.child({ roomCode, userId: room?.userId });
            rlog.info({ socketId: socket.id }, 'Player joined room');

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
            log.error({ err: error }, 'Error joining room');
            socket.emit(SOCKET_EVENTS.SERVER.JOIN_ERROR, { message: 'Failed to join room' });
        }
    });

    // REJOIN ROOM: Player reconnects after accidental disconnect
    socket.on(SOCKET_EVENTS.CLIENT.REJOIN_ROOM, (data) => {
        try {
            const { roomCode, playerId } = data || {};

            if (!roomCode || !playerId) {
                socket.emit(SOCKET_EVENTS.SERVER.REJOIN_ERROR, { message: 'Room code and player ID are required' });
                return;
            }

            handleRejoin(socket, io, roomCode, playerId);
        } catch (error) {
            log.error({ err: error }, 'Error rejoining room');
            socket.emit(SOCKET_EVENTS.SERVER.REJOIN_ERROR, { message: 'Failed to rejoin room' });
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

            const roomBeforeLeave = roomManager.getRoom(roomCode);
            const rlog = log.child({ roomCode, userId: roomBeforeLeave?.userId });

            // Clean up player position from game state first
            gameStateManager.removePlayerPosition(roomCode, socket.id);

            const result = roomManager.removePlayerFromRoom(roomCode, socket.id);
            if (!result) {
                socket.emit(SOCKET_EVENTS.SERVER.LEAVE_ERROR, { message: 'Failed to leave room' });
                return;
            }

            const wasUnicornDuringGame = result.wasUnicorn && result.room?.status === 'playing';

            socket.leave(roomCode);
            rlog.info({ socketId: socket.id }, 'Player left room');

            // If room is empty, clean up game state
            if (result.roomDeleted) {
                gameStateManager.cleanupRoom(roomCode);
                rlog.info({}, 'Room deleted (empty)');
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
                        rlog.info({ newUnicornIds: ids }, 'Unicorns updated');
                    }
                }

                // Notify remaining players
                socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_LEFT, {
                    playerId: result.playerId || socket.id,
                    socketId: socket.id,
                    room: result.room
                });
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.ROOM_UPDATE, { 
                    room: result.room,
                    mapConfigChanged: result.mapConfigChanged
                });
            }

            socket.emit(SOCKET_EVENTS.SERVER.ROOM_LEFT, { roomCode: roomCode });
        } catch (error) {
            log.error({ err: error }, 'Error leaving room');
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
            log.error({ err: error }, 'Error getting room info');
            socket.emit(SOCKET_EVENTS.SERVER.ROOM_INFO, { room: null });
        }
    });
}

/**
 * Handle player rejoin after disconnect
 * @param {Socket} socket - Socket instance
 * @param {Server} io - Socket.IO server instance
 * @param {string} roomCode - Room code
 * @param {string} playerId - Persistent player ID
 * @param {string} playerName - Player name (optional, for updating)
 */
function handleRejoin(socket, io, roomCode, playerId, playerName = null) {
    const room = roomManager.getRoom(roomCode);
    if (!room) {
        socket.emit(SOCKET_EVENTS.SERVER.REJOIN_ERROR, { message: 'Room not found' });
        return;
    }

    const player = roomManager.getPlayerByPlayerId(roomCode, playerId);
    if (!player) {
        socket.emit(SOCKET_EVENTS.SERVER.REJOIN_ERROR, { message: 'Player not found in room' });
        return;
    }

    // Update player's socket ID and clear disconnected status
    const oldSocketId = player.id;
    const updatedPlayer = roomManager.updatePlayerSocketId(roomCode, playerId, socket.id);
    if (!updatedPlayer) {
        socket.emit(SOCKET_EVENTS.SERVER.REJOIN_ERROR, { message: 'Failed to update player connection' });
        return;
    }

    // Optionally update player name if provided
    if (playerName && playerName.trim()) {
        updatedPlayer.name = playerName.trim();
    }

    // Join the socket room
    socket.join(roomCode);

    // Update game state position tracking with new socket ID
    gameStateManager.updatePlayerSocketId(roomCode, oldSocketId, socket.id);

    log.info({ roomCode, playerId, playerName: updatedPlayer.name, oldSocketId, newSocketId: socket.id }, 'Player rejoined room with new socket');

    // Get current game state for the rejoining player
    const gameState = gameStateManager.getGameState(roomCode);

    // Send success response to the rejoining player
    socket.emit(SOCKET_EVENTS.SERVER.REJOIN_SUCCESS, {
        room: room,
        gameState: gameState,
        player: updatedPlayer
    });

    // Notify other players that this player reconnected
    socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_RECONNECTED, {
        playerId: playerId,
        socketId: socket.id,
        playerName: updatedPlayer.name
    });

    // Send updated room state to all players
    io.to(roomCode).emit(SOCKET_EVENTS.SERVER.ROOM_UPDATE, { room: room });
}
