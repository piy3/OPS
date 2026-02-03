/**
 * Game Loop Manager
 * Handles game phases, blitz quiz, hunt timing, and round cycling
 */

import { SOCKET_EVENTS, GAME_PHASE, GAME_LOOP_CONFIG, COMBAT_CONFIG } from '../../config/constants.js';
import { getBlitzQuestion, BLITZ_QUIZ_CONFIG } from '../../config/questions.js';
import log from '../../utils/logger.js';
import RoomManager from '../RoomManager.js';

class GameLoopManager {
    constructor() {
        // Track game phases: roomCode -> { phase, phaseStartTime, previousPhase }
        this.gamePhases = new Map();
        
        // Track Blitz Quiz state: roomCode -> { question, answers, startTime, completed }
        this.blitzQuizzes = new Map();
        
        // Track game loop timers: roomCode -> { huntTimer, blitzTimer, huntUpdateInterval }
        this.gameLoopTimers = new Map();
        
        // Track reserve unicorn: roomCode -> { playerId, playerName }
        this.reserveUnicorns = new Map();
        
        // Track rounds per room: roomCode -> { totalRounds, roundsRemaining, currentRound }
        this.roomRounds = new Map();
    }

    // ==================== ROUND TRACKING METHODS ====================

    /**
     * Initialize round tracking for a room when a game starts
     * @param {string} roomCode - Room code
     */
    initRoomRounds(roomCode) {
        const totalRounds = GAME_LOOP_CONFIG.TOTAL_GAME_ROUNDS;
        this.roomRounds.set(roomCode, {
            totalRounds: totalRounds,
            roundsRemaining: totalRounds,
            currentRound: 1
        });
        log.info(`🎮 Room ${roomCode}: Initialized rounds - ${totalRounds} total rounds`);
    }

    /**
     * Get remaining rounds for a room
     * @param {string} roomCode - Room code
     * @returns {number} Rounds remaining (0 if not found)
     */
    getRoundsRemaining(roomCode) {
        return this.roomRounds.get(roomCode)?.roundsRemaining ?? 0;
    }

    /**
     * Get full round data for a room
     * @param {string} roomCode - Room code
     * @returns {Object|null} { totalRounds, roundsRemaining, currentRound } or null
     */
    getRoomRounds(roomCode) {
        return this.roomRounds.get(roomCode) || null;
    }

    /**
     * Decrement the round counter for a room
     * Called after each Hunt phase ends
     * @param {string} roomCode - Room code
     * @returns {number} New rounds remaining (0 if room not found)
     */
    decrementRound(roomCode) {
        const roundData = this.roomRounds.get(roomCode);
        if (!roundData) {
            log.warn(`⚠️ Room ${roomCode}: No round data found for decrement`);
            return 0;
        }
        
        roundData.roundsRemaining = Math.max(0, roundData.roundsRemaining - 1);
        roundData.currentRound += 1;
        
        log.info(`🎮 Room ${roomCode}: Round complete - ${roundData.roundsRemaining} rounds remaining (was round ${roundData.currentRound - 1})`);
        
        return roundData.roundsRemaining;
    }

    /**
     * Get current game phase for a room
     * @param {string} roomCode - Room code
     * @returns {string} Current game phase
     */
    getGamePhase(roomCode) {
        const phaseData = this.gamePhases.get(roomCode);
        return phaseData?.phase || GAME_PHASE.WAITING;
    }

    /**
     * Set game phase for a room
     * @param {string} roomCode - Room code
     * @param {string} phase - New game phase
     * @param {Object} io - Socket.IO server
     */
    setGamePhase(roomCode, phase, io) {
        const now = Date.now();
        const phaseData = {
            phase: phase,
            phaseStartTime: now,
            previousPhase: this.getGamePhase(roomCode)
        };
        
        this.gamePhases.set(roomCode, phaseData);
        
        if (io) {
            // Include round info in phase change event
            const roundInfo = this.getRoomRounds(roomCode);
            
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PHASE_CHANGE, {
                phase: phase,
                previousPhase: phaseData.previousPhase,
                timestamp: now,
                roundInfo: roundInfo // { currentRound, totalRounds, roundsRemaining } or null
            });
        }
    }

    /**
     * Clear game loop timers for a room
     * @param {string} roomCode - Room code
     */
    clearGameLoopTimers(roomCode) {
        const timers = this.gameLoopTimers.get(roomCode);
        if (timers) {
            if (timers.huntTimer) clearTimeout(timers.huntTimer);
            if (timers.blitzTimer) clearTimeout(timers.blitzTimer);
            if (timers.huntUpdateInterval) clearInterval(timers.huntUpdateInterval);
            this.gameLoopTimers.delete(roomCode);
        }
    }

    /**
     * Start the game loop for a room
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {Function} onFreezeRoom - Callback to freeze room
     */
    startGameLoop(roomCode, io, onFreezeRoom) {
        this.clearGameLoopTimers(roomCode);
        this.startBlitzQuiz(roomCode, io, onFreezeRoom);
    }

    /**
     * Start Blitz Quiz phase
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {Function} onFreezeRoom - Callback to freeze room
     */
    startBlitzQuiz(roomCode, io, onFreezeRoom) {
        this.setGamePhase(roomCode, GAME_PHASE.BLITZ_QUIZ, io);
        onFreezeRoom(roomCode);

        const question = getBlitzQuestion();
        const now = Date.now();
        
        const blitzData = {
            question: question,
            answers: new Map(),
            startTime: now,
            timeLimit: BLITZ_QUIZ_CONFIG.TIME_LIMIT,
            completed: false,
            playerCount: 0 // Will be set when sending
        };
        this.blitzQuizzes.set(roomCode, blitzData);

        // Return data for caller to broadcast
        return {
            questionForClients: {
                id: question.id,
                question: question.question,
                options: question.options
            },
            timeLimit: BLITZ_QUIZ_CONFIG.TIME_LIMIT,
            timestamp: now
        };
    }

    /**
     * Send blitz quiz to players
     * @param {string} roomCode - Room code
     * @param {number} playerCount - Number of players
     * @param {Object} io - Socket.IO server
     * @param {Function} onEndBlitz - Callback when blitz ends
     */
    sendBlitzQuiz(roomCode, playerCount, io, onEndBlitz) {
        const blitz = this.blitzQuizzes.get(roomCode);
        if (!blitz) return;

        blitz.playerCount = playerCount;

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.BLITZ_START, {
            question: {
                id: blitz.question.id,
                question: blitz.question.question,
                options: blitz.question.options
            },
            timeLimit: blitz.timeLimit,
            playerCount: playerCount,
            timestamp: blitz.startTime
        });

        // Set timeout
        const timers = this.gameLoopTimers.get(roomCode) || {};
        timers.blitzTimer = setTimeout(() => {
            onEndBlitz(roomCode, io);
        }, BLITZ_QUIZ_CONFIG.TIME_LIMIT);
        this.gameLoopTimers.set(roomCode, timers);
    }

    /**
     * Submit a Blitz Quiz answer
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {number} answerIndex - Selected answer index
     * @param {Object} io - Socket.IO server
     * @param {Function} onAllAnswered - Callback when all players answered
     * @returns {Object|null} Result or null
     */
    submitBlitzAnswer(roomCode, playerId, answerIndex, io, onAllAnswered) {
        const blitz = this.blitzQuizzes.get(roomCode);
        
        if (!blitz || blitz.completed) return null;
        if (blitz.answers.has(playerId)) return null;

        const now = Date.now();
        const responseTime = now - blitz.startTime;
        const isCorrect = answerIndex === blitz.question.correctAnswer;

        blitz.answers.set(playerId, {
            answer: answerIndex,
            timestamp: now,
            responseTime: responseTime,
            isCorrect: isCorrect
        });

        // handle questions record for the player.
        RoomManager.handlePlayerQuestionsAttempt(roomCode, playerId, isCorrect);
        // Send individual feedback
        io.to(playerId).emit(SOCKET_EVENTS.SERVER.BLITZ_ANSWER_RESULT, {
            isCorrect: isCorrect,
            responseTime: responseTime,
            answersReceived: blitz.answers.size,
            totalPlayers: blitz.playerCount
        });

        // Check if all answered
        if (blitz.answers.size >= blitz.playerCount) {
            const timers = this.gameLoopTimers.get(roomCode);
            if (timers?.blitzTimer) {
                clearTimeout(timers.blitzTimer);
            }
            onAllAnswered(roomCode, io);
        }

        return { isCorrect, responseTime };
    }

    /**
     * End Blitz Quiz and determine roles
     * @param {string} roomCode - Room code
     * @param {Object} room - Room data
     * @param {Object} io - Socket.IO server
     * @param {Function} transferUnicorn - Callback to transfer unicorn
     * @param {Function} updatePlayerCoins - Callback to update coins
     * @param {Function} onStartHunt - Callback to start hunt phase
     */
    endBlitzQuiz(roomCode, room, io, transferUnicorn, updatePlayerCoins, onStartHunt) {
        const blitz = this.blitzQuizzes.get(roomCode);
        
        if (!blitz || blitz.completed) return;

        blitz.completed = true;

        // Get correct answers sorted by response time
        const correctAnswers = [];
        blitz.answers.forEach((answerData, playerId) => {
            if (answerData.isCorrect) {
                const player = room.players.find(p => p.id === playerId);
                correctAnswers.push({
                    playerId: playerId,
                    playerName: player?.name || 'Unknown',
                    responseTime: answerData.responseTime
                });
            }
        });
        correctAnswers.sort((a, b) => a.responseTime - b.responseTime);

        // Determine new Unicorn
        let newUnicornId = null;
        let newUnicornName = null;
        let reserveId = null;
        let reserveName = null;

        if (correctAnswers.length > 0) {
            newUnicornId = correctAnswers[0].playerId;
            newUnicornName = correctAnswers[0].playerName;
            
            if (GAME_LOOP_CONFIG.RESERVE_UNICORN_ENABLED && 
                correctAnswers.length > 1 && 
                room.players.length >= BLITZ_QUIZ_CONFIG.MIN_PLAYERS_FOR_RESERVE) {
                reserveId = correctAnswers[1].playerId;
                reserveName = correctAnswers[1].playerName;
                this.reserveUnicorns.set(roomCode, {
                    playerId: reserveId,
                    playerName: reserveName
                });
            }
        } else {
            // No correct answers - random unicorn
            const randomIndex = Math.floor(Math.random() * room.players.length);
            newUnicornId = room.players[randomIndex].id;
            newUnicornName = room.players[randomIndex].name;
        }

        // Transfer unicorn
        const oldUnicornId = room.unicornId;
        if (newUnicornId && newUnicornId !== oldUnicornId) {
            transferUnicorn(roomCode, newUnicornId);
            updatePlayerCoins(roomCode, newUnicornId, GAME_LOOP_CONFIG.BLITZ_WINNER_BONUS);
        }

        // Build results
        const results = {
            question: blitz.question.question,
            correctAnswer: blitz.question.options[blitz.question.correctAnswer],
            correctAnswerIndex: blitz.question.correctAnswer,
            rankings: correctAnswers.map((a, i) => ({
                rank: i + 1,
                playerId: a.playerId,
                playerName: a.playerName,
                responseTime: a.responseTime,
                isUnicorn: a.playerId === newUnicornId,
                isReserve: a.playerId === reserveId
            })),
            newUnicornId: newUnicornId,
            newUnicornName: newUnicornName,
            reserveUnicornId: reserveId,
            reserveUnicornName: reserveName,
            oldUnicornId: oldUnicornId,
            totalPlayers: room.players.length,
            correctCount: correctAnswers.length
        };

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.BLITZ_RESULT, results);

        // Emit unicorn transfer if changed
        if (newUnicornId !== oldUnicornId) {
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                newUnicornId: newUnicornId,
                oldUnicornId: oldUnicornId,
                room: room
            });
        }

        // Clean up
        this.blitzQuizzes.delete(roomCode);

        // Start hunt after delay
        setTimeout(() => {
            onStartHunt(roomCode, io);
        }, GAME_LOOP_CONFIG.ROUND_END_DURATION);
    }

    /**
     * Start Hunt phase
     * @param {string} roomCode - Room code
     * @param {Object} room - Room data
     * @param {Object} io - Socket.IO server
     * @param {Function} onUnfreezeRoom - Callback to unfreeze room
     * @param {Function} onInitializeMapItems - Callback to init coins/powerups
     * @param {Function} onStartNextBlitz - Callback to start next blitz
     * @returns {Object} Hunt phase data
     */
    startHuntPhase(roomCode, room, io, onUnfreezeRoom, onInitializeMapItems, onStartNextBlitz) {
        this.setGamePhase(roomCode, GAME_PHASE.HUNT, io);
        onUnfreezeRoom(roomCode);

        const now = Date.now();
        const huntEndTime = now + GAME_LOOP_CONFIG.HUNT_DURATION;

        const unicornPlayer = room.players.find(p => p.id === room.unicornId);
        const reserve = this.reserveUnicorns.get(roomCode);

        // Build player health data
        const playersHealth = room.players.map(p => ({
            playerId: p.id,
            health: p.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH,
            state: p.state
        }));

        // Include round info in hunt start event
        const roundInfo = this.getRoomRounds(roomCode);
        
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HUNT_START, {
            duration: GAME_LOOP_CONFIG.HUNT_DURATION,
            endTime: huntEndTime,
            unicornId: room.unicornId,
            unicornName: unicornPlayer?.name || 'Unknown',
            reserveUnicornId: reserve?.playerId || null,
            reserveUnicornName: reserve?.playerName || null,
            timestamp: now,
            playersHealth: playersHealth,
            roundInfo: roundInfo // { currentRound, totalRounds, roundsRemaining } or null
        });

        // Initialize coins and powerups
        onInitializeMapItems(roomCode, io);

        // Set timer for next Blitz Quiz
        const timers = this.gameLoopTimers.get(roomCode) || {};
        timers.huntTimer = setTimeout(() => {
            onStartNextBlitz(roomCode, io);
        }, GAME_LOOP_CONFIG.HUNT_DURATION);

        // Hunt timer updates (every 5s)
        timers.huntUpdateInterval = setInterval(() => {
            const remaining = huntEndTime - Date.now();
            if (remaining > 0) {
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HUNT_END, {
                    remainingTime: remaining,
                    endTime: huntEndTime
                });
            }
        }, 5000);

        this.gameLoopTimers.set(roomCode, timers);

        return { huntEndTime, playersHealth };
    }

    /**
     * Get reserve unicorn for a room
     * @param {string} roomCode - Room code
     * @returns {Object|null} Reserve unicorn data
     */
    getReserveUnicorn(roomCode) {
        return this.reserveUnicorns.get(roomCode) || null;
    }

    /**
     * Clear reserve unicorn
     * @param {string} roomCode - Room code
     */
    clearReserveUnicorn(roomCode) {
        this.reserveUnicorns.delete(roomCode);
    }

    /**
     * Handle unicorn disconnect during Hunt
     * @param {string} roomCode - Room code
     * @param {string} disconnectedId - Disconnected unicorn ID
     * @param {Object} io - Socket.IO server
     * @param {Function} setUnicorn - Callback to set new unicorn
     * @param {Function} onNoReserve - Callback when no reserve available
     * @returns {boolean} True if reserve was activated
     */
    handleUnicornDisconnect(roomCode, disconnectedId, io, setUnicorn, onNoReserve) {
        if (this.getGamePhase(roomCode) !== GAME_PHASE.HUNT) {
            return false;
        }

        const reserve = this.reserveUnicorns.get(roomCode);

        if (reserve && reserve.playerId) {
            // Promote reserve
            setUnicorn(roomCode, reserve.playerId);
            this.reserveUnicorns.delete(roomCode);
            
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                newUnicornId: reserve.playerId,
                newUnicornName: reserve.playerName,
                reason: 'unicorn_disconnected',
                previousUnicornId: disconnectedId
            });

            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.RESERVE_ACTIVATED, {
                newUnicornId: reserve.playerId,
                newUnicornName: reserve.playerName,
                reason: 'unicorn_disconnected'
            });

            return true;
        }

        // No reserve - trigger new blitz
        this.clearGameLoopTimers(roomCode);
        
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HUNT_END, {
            reason: 'unicorn_disconnected',
            message: 'Unicorn disconnected! New Blitz Quiz starting...'
        });

        onNoReserve(roomCode, io);
        return false;
    }

    /**
     * Get active blitz quiz data for a room (for state sync/reconnection)
     * Returns the current blitz question and time remaining if in blitz phase
     * @param {string} roomCode - Room code
     * @returns {Object|null} Blitz quiz data or null if not in blitz phase
     */
    getActiveBlitzQuiz(roomCode) {
        // Only return data if we're actually in blitz quiz phase
        if (this.getGamePhase(roomCode) !== GAME_PHASE.BLITZ_QUIZ) {
            return null;
        }

        const blitz = this.blitzQuizzes.get(roomCode);
        if (!blitz || blitz.completed) {
            return null;
        }

        const now = Date.now();
        const elapsed = now - blitz.startTime;
        const timeRemaining = Math.max(0, blitz.timeLimit - elapsed);

        // Don't return if quiz has effectively expired
        if (timeRemaining <= 0) {
            return null;
        }

        return {
            question: {
                id: blitz.question.id,
                question: blitz.question.question,
                options: blitz.question.options
            },
            timeLimit: blitz.timeLimit,
            timeRemaining: timeRemaining,
            playerCount: blitz.playerCount,
            startTime: blitz.startTime,
            timestamp: now
        };
    }

    /**
     * Handle reserve disconnect
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} io - Socket.IO server
     * @returns {boolean} True if was reserve
     */
    handleReserveDisconnect(roomCode, playerId, io) {
        const reserve = this.reserveUnicorns.get(roomCode);
        if (reserve && reserve.playerId === playerId) {
            this.reserveUnicorns.delete(roomCode);
            
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.RESERVE_ACTIVATED, {
                newUnicornId: null,
                reason: 'reserve_disconnected'
            });
            return true;
        }
        return false;
    }

    /**
     * Clean up game loop state for a room
     * @param {string} roomCode - Room code
     */
    cleanupRoom(roomCode) {
        this.clearGameLoopTimers(roomCode);
        this.gamePhases.delete(roomCode);
        this.blitzQuizzes.delete(roomCode);
        this.reserveUnicorns.delete(roomCode);
        this.roomRounds.delete(roomCode);
        log.info(`🧹 Room ${roomCode}: Game loop state cleaned up`);
    }
}

export default new GameLoopManager();
