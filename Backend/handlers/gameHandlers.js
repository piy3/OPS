/**
 * Socket event handlers for game operations
 */

import { SOCKET_EVENTS, ROOM_STATUS, GAME_PHASE, PLAYER_STATE, GAME_LOOP_CONFIG } from '../config/constants.js';
import roomManager from '../services/RoomManager.js';
import gameStateManager from '../services/GameStateManager.js';
import gameLoopManager from '../services/managers/GameLoopManager.js';
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
            
            // Clear any stale quiz state from previous games
            gameStateManager.clearQuizState(roomCode);


            // Get game state with spawn positions
            const gameState = gameStateManager.getGameState(roomCode);
            
            // Get round info (may be null if not initialized yet, use safe default)
            const roundInfo = gameLoopManager.getRoomRounds(roomCode) || {
                currentRound: 1,
                totalRounds: GAME_LOOP_CONFIG.TOTAL_GAME_ROUNDS,
                roundsRemaining: GAME_LOOP_CONFIG.TOTAL_GAME_ROUNDS
            };
            
            // Notify all players in the room with initial game state
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_STARTED, { 
                room: room,
                gameState: gameState,
                roundInfo: roundInfo
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

            // Start the game loop (Blitz Quiz + Hunt cycle)
            // This begins with the first Blitz Quiz
            gameStateManager.startGameLoop(roomCode, io);
            
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
            const roundInfo = gameLoopManager.getRoomRounds(roomCode);
            const currentPhase = gameStateManager.getGamePhase(roomCode);
            
            socket.emit(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, { 
                gameState: gameState,
                roundInfo: roundInfo,
                phase: currentPhase
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
}
