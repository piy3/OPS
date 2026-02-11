/**
 * Socket event handlers for game operations
 */

import { SOCKET_EVENTS, ROOM_STATUS, GAME_PHASE, PLAYER_STATE, GAME_LOOP_CONFIG } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
import gameLoopManager from '../services/managers/GameLoopManager.js';
import sinkholeManager from '../services/managers/SinkholeManager.js';
import sinkTrapManager from '../services/managers/SinkTrapManager.js';
import { log } from 'console';

/**
 * Register game-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {Server} io - Socket.IO server instance
 */
export function registerGameHandlers(socket, io) {
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
            // Include mapConfig so all clients use the same map dimensions
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_STARTED, {
                room: room,
                gameState: gameState,
                roundInfo: roundInfo,
                mapConfig: room.mapConfig
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

            // Start the game loop (Blitz Quiz + Hunt cycle); may fetch Quizizz if room has quizId
            await gameStateManager.startGameLoop(roomCode, io);
        } catch (error) {
            log(`Error starting game: ${error.message}`);
            socket.emit(SOCKET_EVENTS.SERVER.START_ERROR, { message: 'Failed to start game' });
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

            // Verify we're in Blitz Quiz phase
            const currentPhase = gameStateManager.getGamePhase(roomCode);
            if (currentPhase !== GAME_PHASE.BLITZ_QUIZ) {
                log(`⚠️ Blitz answer rejected: Not in Blitz Quiz phase (current: ${currentPhase})`);
                return;
            }

            const { answerIndex } = answerData;

            // Submit the Blitz answer
            const result = gameStateManager.submitBlitzAnswer(
                roomCode,
                socket.id,
                answerIndex,
                io
            );

            if (!result) {
                return;
            }

        } catch (error) {
            log(`Error handling Blitz answer: ${error.message}`);
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
                positionData,
                io // Pass io for collision detection
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
            const currentPhase = gameStateManager.getGamePhase(roomCode);
            
            // Include active blitz quiz data if in blitz_quiz phase
            // This handles the race condition where client navigates to /game
            // after GAME_STARTED but misses BLITZ_START
            const blitzQuiz = gameLoopManager.getActiveBlitzQuiz(roomCode);
            
            socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, { 
                gameState: gameState,
                roundInfo: roundInfo,
                phase: currentPhase,
                blitzQuiz: blitzQuiz, // Will be null if not in blitz phase
                mapConfig: room.mapConfig // Include mapConfig for reconnection
            });
        } catch (error) {
            log(`Error getting game state: ${error.message}`);
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
                log(`Invalid quiz answer submission from ${socket.id}`);
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
                log(`All questions answered in room ${roomCode}, completing quiz`);
                gameStateManager.completeQuiz(roomCode, io, false);
            }
        } catch (error) {
            log(`Error handling quiz answer: ${error.message}`);
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
                log(`Unfreeze quiz answer rejected: Player not frozen`);
                return;
            }

            if (!gameStateManager.hasUnfreezeQuiz(roomCode, socket.id)) {
                log(`Unfreeze quiz answer rejected: No active unfreeze quiz for player`);
                return;
            }

            const { questionIndex, answerIndex } = answerData;

            // Submit the answer
            const result = gameStateManager.submitUnfreezeQuizAnswer(
                roomCode,
                socket.id,
                questionIndex,
                answerIndex,
                io
            );

            if (!result) {
                log(`Invalid unfreeze quiz answer submission from ${socket.id}`);
                return;
            }

        } catch (error) {
            log(`Error handling unfreeze quiz answer: ${error.message}`);
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
        
        gameStateManager.enterSinkhole(roomCode, socket.id, player.name, data.sinkholeId, io);
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
        
        gameStateManager.collectSinkTrap(roomCode, socket.id, player.name, data.trapId, io);
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
        gameStateManager.deploySinkTrap(roomCode, socket.id, player.name, position, io);
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

            // Don't freeze if already frozen or eliminated
            if (player.state === PLAYER_STATE.FROZEN || player.state === 'eliminated') {
                log(`⚠️ Lava death ignored: Player ${player.name} is already frozen/eliminated`);
                return;
            }

            // Don't freeze if player already has an active unfreeze quiz
            if (gameStateManager.hasUnfreezeQuiz(roomCode, socket.id)) {
                log(`⚠️ Lava death ignored: Player ${player.name} already has active unfreeze quiz`);
                return;
            }

            // Don't freeze unicorn - they are immune to lava
            if (player.isUnicorn) {
                return;
            }

            log(`🔥 Player ${player.name} fell in lava in room ${roomCode}`);

            // Handle lava death as freeze + unfreeze quiz (same as being tagged)
            gameStateManager.handleLavaDeath(roomCode, socket.id, player.name, io);

        } catch (error) {
            log(`Error handling lava death: ${error.message}`);
        }
    });

    // REQUEST UNFREEZE QUIZ: Client requests quiz data (reconnection recovery)
    // Used when client knows it's frozen but didn't receive UNFREEZE_QUIZ_START
    socket.on(SOCKET_EVENTS.CLIENT.REQUEST_UNFREEZE_QUIZ, () => {
        try {
            const roomCode = roomManager.getRoomCodeForSocket(socket.id);
            if (!roomCode) {
                log(`⚠️ Request unfreeze quiz: Player not in room`);
                return;
            }

            const room = roomManager.getRoom(roomCode);
            if (!room || room.status !== ROOM_STATUS.PLAYING) {
                log(`⚠️ Request unfreeze quiz: Room not playing`);
                return;
            }

            const player = room.players.find(p => p.id === socket.id);
            if (!player) {
                log(`⚠️ Request unfreeze quiz: Player not found`);
                return;
            }

            log(`🧊 Player ${player.name} requesting unfreeze quiz (recovery)`);

            // Request quiz from game state manager - it will handle all cases:
            // - If frozen with existing quiz: resend quiz data
            // - If frozen without quiz: start new quiz
            // - If not frozen: do nothing
            gameStateManager.requestUnfreezeQuiz(roomCode, socket.id, io);

        } catch (error) {
            log(`Error handling request unfreeze quiz: ${error.message}`);
        }
    });
}
