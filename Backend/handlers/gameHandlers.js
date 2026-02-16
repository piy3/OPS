/**
 * Socket event handlers for game operations
 */

import { SOCKET_EVENTS, ROOM_STATUS, GAME_PHASE, PLAYER_STATE, GAME_LOOP_CONFIG } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
import gameLoopManager from '../services/managers/GameLoopManager.js';
import sinkholeManager from '../services/managers/SinkholeManager.js';
import sinkTrapManager from '../services/managers/SinkTrapManager.js';
import log from '../utils/logger.js';

/**
 * Register game-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {Server} io - Socket.IO server instance
 */
export function registerGameHandlers(socket, io) {
    /** Create a logger with roomCode + userId context. Pass room to skip a lookup. */
    function roomLog(roomCode, room) {
        room = room || roomManager.getRoom(roomCode);
        return log.child({ roomCode, userId: room?.userId });
    }

    // START GAME: Host starts the game
    socket.on(SOCKET_EVENTS.CLIENT.START_GAME, async () => {
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

            // Clear any stale quiz state from previous games
            gameStateManager.clearQuizState(roomCode);


            // Get game state with spawn positions
            const gameState = gameStateManager.getGameState(roomCode, socket.id);

            // Get round info (may be null if not initialized yet, use safe default)
            const totalRounds = room?.totalRounds ?? GAME_LOOP_CONFIG.TOTAL_GAME_ROUNDS;
            const roundInfo = gameLoopManager.getRoomRounds(roomCode) || {
                currentRound: 1,
                totalRounds: totalRounds,
                roundsRemaining: totalRounds
            };

            // Notify all players in the room with initial game state
            // Include mapConfig and gameEndTime (per-player flow: teacher-set global timer)
            const durationMs = room?.gameDurationMs ?? GAME_LOOP_CONFIG.GAME_TOTAL_DURATION_MS ?? 300000;
            const gameEndTime = Date.now() + durationMs;
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_STARTED, {
                room: room,
                gameState: gameState,
                roundInfo: roundInfo,
                mapConfig: room.mapConfig,
                gameEndTime
            });

            // Broadcast spawn positions only for players already in maze (hunt phase)
            // Players still in blitz quiz are not visible to others until they finish
            if (gameState && gameState.players) {
                gameState.players.forEach(player => {
                    if (player.position && player.inMaze) {
                        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
                            playerId: player.id,
                            position: player.position
                        });
                    }
                });
            }

            // Per-player flow: send 3 questions to each player, global timer, no room-wide blitz
            await gameStateManager.startGameLoopForEachPlayer(roomCode, io);
        } catch (error) {
            log.error({ err: error }, 'Error starting game');
            socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to start game' });
        }
    });

    // END GAME: Host or teacher ends the game early
    socket.on(SOCKET_EVENTS.CLIENT.END_GAME, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Not in any room' });
                return;
            }

            const validation = roomManager.validateEndGame(roomCode, socket.id);
            if (!validation.valid) {
                socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: validation.error });
                return;
            }

            gameStateManager.endGameNow(roomCode, io);
        } catch (error) {
            log.error({ err: error }, 'Error ending game');
            socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to end game' });
        }
    });

    // BLITZ ANSWER: Player submits answer to Blitz Quiz
    socket.on(SOCKET_EVENTS.CLIENT.BLITZ_ANSWER, (answerData) => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                return; // Silently ignore if not in a room
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                return; // Silently ignore if game not playing
            }

            const { questionIndex, answerIndex } = answerData ?? {};
            const playerId = roomManager.getPersistentPlayerId(roomCode, socket.id);
            if (playerId == null || answerIndex == null) return;

            const result = gameStateManager.submitBlitzAnswer(
                roomCode,
                playerId,
                questionIndex ?? 0,
                answerIndex,
                io
            );

            if (!result) {
                return;
            }

        } catch (error) {
            log.error({ err: error }, 'Error handling Blitz answer');
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
            
            // Get persistent playerId for this socket
            const persistentPlayerId = roomManager.getPersistentPlayerId(roomCode, socket.id);
            if (!persistentPlayerId) {
                return; // Player not found in room
            }
            
            // Update position with validation and rate limiting
            const updatedPosition = gameStateManager.updatePlayerPosition(
                roomCode, 
                socket.id, 
                positionData,
                io // Pass io for collision detection
            );
            
            // If update was successful (not throttled), broadcast to other players
            if (updatedPosition) {
                // Broadcast to all other players in the room (excluding sender)
                // Use persistent playerId for player identification
                socket.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
                    playerId: persistentPlayerId,
                    position: updatedPosition
                });
            }
        } catch (error) {
            log.error({ err: error }, 'Error handling position update');
            // Silently fail to avoid disrupting gameplay
        }
    });

    // GET GAME STATE: Request current game state (for late joiners or reconnection)
    // Also handles blitz quiz sync when clients miss BLITZ_START due to navigation timing
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

            const gameState = gameStateManager.getGameState(roomCode, socket.id);
            const roundInfo = gameLoopManager.getRoomRounds(roomCode);
            const roomPhase = gameStateManager.getGamePhase(roomCode);
            const playerId = roomManager.getPersistentPlayerId(roomCode, socket.id);
            const playerPhase = playerId ? gameLoopManager.getPlayerPhase(roomCode, playerId) : roomPhase;
            // Per-player flow: send this player's phase and entry quiz if in blitz
            const mazeEntryQuiz = playerId ? gameLoopManager.getPlayerEntryQuiz(roomCode, playerId) : null;
            const currentPhase = mazeEntryQuiz?.length ? 'blitz_quiz' : playerPhase;
            const blitzQuiz = gameLoopManager.getActiveBlitzQuiz(roomCode);
            
            socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, { 
                gameState: gameState,
                roundInfo: roundInfo,
                phase: currentPhase,
                blitzQuiz: blitzQuiz,
                mazeEntryQuiz: mazeEntryQuiz,
                mapConfig: room.mapConfig
            });
        } catch (error) {
            log.error({ err: error }, 'Error getting game state');
            socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, { gameState: null });
        }
    });

    // SUBMIT QUIZ ANSWER: Player submits an answer to quiz question
    socket.on(SOCKET_EVENTS.CLIENT.SUBMIT_QUIZ_ANSWER, (answerData) => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                return; // Silently ignore if not in a room
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                return; // Silently ignore if game not playing
            }

            const { questionId, answerIndex } = answerData;

            // Submit the answer
            const result = gameStateManager.submitQuizAnswer(
                roomCode,
                socket.id,
                questionId,
                answerIndex
            );

            if (!result) {
                roomLog(roomCode, room).warn({ socketId: socket.id }, 'Invalid quiz answer submission');
                return;
            }


            // Send result back to the player
            socket.emit('quiz_answer_result', {
                questionId: questionId,
                isCorrect: result.isCorrect,
                totalAnswered: result.totalAnswered,
                totalQuestions: result.totalQuestions
            });

            // If all questions answered, complete the quiz
            if (result.totalAnswered === result.totalQuestions) {
                roomLog(roomCode, room).info({}, 'All questions answered, completing quiz');
                gameStateManager.completeQuiz(roomCode, io, false);
            }
        } catch (error) {
            log.error({ err: error }, 'Error handling quiz answer');
        }
    });

    // SUBMIT UNFREEZE QUIZ ANSWER: Player submits answer to personal unfreeze quiz
    socket.on(SOCKET_EVENTS.CLIENT.SUBMIT_UNFREEZE_QUIZ_ANSWER, (answerData) => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                return; // Silently ignore if not in a room
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                return; // Silently ignore if game not playing
            }

            // Verify player is frozen and has an active unfreeze quiz
            const player = room.players.find(p => p.id === socket.id);
            if (!player || player.state !== PLAYER_STATE.FROZEN) {
                roomLog(roomCode, room).warn({ socketId: socket.id }, 'Unfreeze quiz answer rejected: Player not frozen');
                return;
            }

            // Use persistent player ID for unfreeze quiz operations (matches how frozen state is tracked)
            const persistentPlayerId = player.playerId || socket.id;

            if (!gameStateManager.hasUnfreezeQuiz(roomCode, persistentPlayerId)) {
                roomLog(roomCode, room).warn({ socketId: socket.id, persistentPlayerId }, 'Unfreeze quiz answer rejected: No active unfreeze quiz for player');
                return;
            }

            const { questionIndex, answerIndex } = answerData;

            // Submit the answer using persistent player ID
            const result = gameStateManager.submitUnfreezeQuizAnswer(
                roomCode,
                persistentPlayerId,
                questionIndex,
                answerIndex,
                io
            );

            if (!result) {
                roomLog(roomCode, room).warn({ socketId: socket.id }, 'Invalid unfreeze quiz answer submission');
                return;
            }

        } catch (error) {
            log.error({ err: error }, 'Error handling unfreeze quiz answer');
        }
    });

    // ENTER SINKHOLE: Player enters a sinkhole to teleport
    socket.on(SOCKET_EVENTS.CLIENT.ENTER_SINKHOLE, (data) => {
        const roomCode = roomManager.getRoomCodeForSocket(socket.id);
        if (!roomCode) return;
        
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== ROOM_STATUS.PLAYING) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        // Pass both socket ID (for position) and persistent playerId (for events/cooldown)
        gameStateManager.enterSinkhole(roomCode, socket.id, player.playerId, player.name, data.sinkholeId, io);
    });

    // COLLECT SINK TRAP: Only survivors can collect
    socket.on(SOCKET_EVENTS.CLIENT.COLLECT_SINK_TRAP, (data) => {
        const roomCode = roomManager.getRoomCodeForSocket(socket.id);
        if (!roomCode) return;
        
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== ROOM_STATUS.PLAYING) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        if (player.isUnicorn) return;
        
        // Pass persistent playerId for inventory tracking and events
        gameStateManager.collectSinkTrap(roomCode, player.playerId, player.name, data.trapId, io);
    });

    // DEPLOY SINK TRAP: Only survivors can deploy
    socket.on(SOCKET_EVENTS.CLIENT.DEPLOY_SINK_TRAP, (data) => {
        const roomCode = roomManager.getRoomCodeForSocket(socket.id);
        if (!roomCode) return;
        
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== ROOM_STATUS.PLAYING) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        if (player.isUnicorn) return;
        
        const position = data.position ?? (data.row != null && data.col != null ? { row: data.row, col: data.col } : null);
        if (!position) return;
        // Pass persistent playerId for inventory tracking and events
        gameStateManager.deploySinkTrap(roomCode, player.playerId, player.name, position, io);
    });

    // LAVA DEATH: Player fell in lava - freeze them and start unfreeze quiz
    socket.on(SOCKET_EVENTS.CLIENT.LAVA_DEATH, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                return;
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                return;
            }

            // Get the player
            const player = room.players.find(p => p.id === socket.id);
            if (!player) {
                return;
            }

            const rlog = roomLog(roomCode, room);

            // Don't freeze if already frozen or eliminated
            if (player.state === PLAYER_STATE.FROZEN || player.state === 'eliminated') {
                rlog.warn({ playerName: player.name, socketId: socket.id }, 'Lava death ignored: Player already frozen/eliminated');
                return;
            }

            // Don't freeze if player already has an active unfreeze quiz
            if (gameStateManager.hasUnfreezeQuiz(roomCode, socket.id)) {
                rlog.warn({ playerName: player.name, socketId: socket.id }, 'Lava death ignored: Player already has active unfreeze quiz');
                return;
            }

            // Don't freeze unicorn - they are immune to lava
            if (player.isUnicorn) {
                return;
            }

            rlog.info({ playerName: player.name, socketId: socket.id }, 'Player fell in lava');


            // Handle lava death as freeze + unfreeze quiz (same as being tagged)
            gameStateManager.handleLavaDeath(roomCode, socket.id, player.name, io);

        } catch (error) {
            log.error({ err: error }, 'Error handling lava death');
        }
    });

    // REQUEST UNFREEZE QUIZ: Client requests quiz data (reconnection recovery)
    // Used when client knows it's frozen but didn't receive UNFREEZE_QUIZ_START
    socket.on(SOCKET_EVENTS.CLIENT.REQUEST_UNFREEZE_QUIZ, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                log.warn({ socketId: socket.id }, 'Request unfreeze quiz: Player not in room');
                return;
            }

            const room = roomManager.getRoom(roomCode);
            const rlog = log.child({ roomCode, userId: room?.userId });

            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                rlog.warn({}, 'Request unfreeze quiz: Room not playing');
                return;
            }

            const player = room.players.find(p => p.id === socket.id);
            if (!player) {
                rlog.warn({ socketId: socket.id }, 'Request unfreeze quiz: Player not found');
                return;
            }

            rlog.info({ playerName: player.name, socketId: socket.id }, 'Player requesting unfreeze quiz (recovery)');

            // Request quiz from game state manager - it will handle all cases:
            // - If frozen with existing quiz: resend quiz data
            // - If frozen without quiz: start new quiz
            // - If not frozen: do nothing
            gameStateManager.requestUnfreezeQuiz(roomCode, socket.id, io);

        } catch (error) {
            log.error({ err: error }, 'Error handling request unfreeze quiz');
        }
    });
}
