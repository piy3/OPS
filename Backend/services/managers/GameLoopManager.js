/**
 * Game Loop Manager
 * Handles game phases, blitz quiz, hunt timing, and round cycling
 */

import { SOCKET_EVENTS, GAME_PHASE, GAME_LOOP_CONFIG, COMBAT_CONFIG } from '../../config/constants.js';
import { getBlitzQuestion, BLITZ_QUIZ_CONFIG } from '../../config/questions.js';
import log from '../../utils/logger.js';
import roomManager from '../RoomManager.js';
import quizizzService from '../QuizizzService.js';

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
     * Ensure room's Quizizz question pool is filled (lazy). No-op if no quizId or already filled.
     * @param {string} roomCode - Room code
     */
    async _ensureRoomQuizPool(roomCode) {
        const room = roomManager.getRoom(roomCode);
        if (!room?.quizId || room.quizQuestionPool !== null) return;
        const pool = await quizizzService.fetchAndNormalizeQuestions(room.quizId);
        room.quizQuestionPool = Array.isArray(pool) && pool.length > 0 ? pool : null;
    }

    /**
     * Start the game loop for a room
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {Function} onFreezeRoom - Callback to freeze room
     */
    async startGameLoop(roomCode, io, onFreezeRoom) {
        this.clearGameLoopTimers(roomCode);
        await this.startBlitzQuiz(roomCode, io, onFreezeRoom);
    }

    /**
     * Start Blitz Quiz phase. Uses room.quizQuestionPool when room has quizId and pool is available.
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {Function} onFreezeRoom - Callback to freeze room
     */
    async startBlitzQuiz(roomCode, io, onFreezeRoom) {
        this.setGamePhase(roomCode, GAME_PHASE.BLITZ_QUIZ, io);
        onFreezeRoom(roomCode);

        await this._ensureRoomQuizPool(roomCode);
        const room = roomManager.getRoom(roomCode);
        let question;
        if (room?.quizQuestionPool?.length > 0) {
            const idx = Math.floor(Math.random() * room.quizQuestionPool.length);
            question = room.quizQuestionPool[idx];
        } else {
            log.info(`Couldn't get question from quizizz service, using fallback`)
            question = getBlitzQuestion(); // fallback for play-test: should be removed before shipping
        }

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
        roomManager.handlePlayerQuestionsAttempt(roomCode, playerId, isCorrect);
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
     * End Blitz Quiz and determine roles (multiple unicorns: 30% of players, min 1)
     * @param {string} roomCode - Room code
     * @param {Object} room - Room data
     * @param {Object} io - Socket.IO server
     * @param {Function} setUnicorns - Callback (roomCode, newUnicornIds[])
     * @param {Function} updatePlayerCoins - Callback to update coins
     * @param {Function} onStartHunt - Callback to start hunt phase
     */
    endBlitzQuiz(roomCode, room, io, setUnicorns, updatePlayerCoins, onStartHunt) {
        const blitz = this.blitzQuizzes.get(roomCode);
        
        if (!blitz || blitz.completed) return;

        blitz.completed = true;

        const pct = GAME_LOOP_CONFIG.UNICORN_PERCENTAGE ?? 0.3;
        const minU = GAME_LOOP_CONFIG.MIN_UNICORNS ?? 1;
        const maxU = GAME_LOOP_CONFIG.MAX_UNICORNS ?? Infinity;
        let unicornCount = Math.max(minU, Math.min(maxU, Math.ceil(room.players.length * pct)));
        unicornCount = Math.min(unicornCount, Math.max(1, room.players.length - 1)); // at least one survivor

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

        let newUnicornIds = [];
        if (correctAnswers.length > 0) {
            const fromCorrect = correctAnswers.slice(0, unicornCount).map(a => a.playerId);
            const chosenSet = new Set(fromCorrect);
            if (fromCorrect.length >= unicornCount) {
                newUnicornIds = fromCorrect;
            } else {
                const remaining = room.players.filter(p => !chosenSet.has(p.id));
                const shuffled = remaining.sort(() => Math.random() - 0.5);
                for (const p of shuffled) {
                    if (newUnicornIds.length + fromCorrect.length >= unicornCount) break;
                    newUnicornIds.push(p.id);
                }
                newUnicornIds = [...fromCorrect, ...newUnicornIds].slice(0, unicornCount);
            }
        } else {
            const shuffled = [...room.players].sort(() => Math.random() - 0.5);
            newUnicornIds = shuffled.slice(0, unicornCount).map(p => p.id);
        }

        setUnicorns(roomCode, newUnicornIds);
        newUnicornIds.forEach(id => updatePlayerCoins(roomCode, id, GAME_LOOP_CONFIG.BLITZ_WINNER_BONUS));

        const oldUnicornId = room.unicornId;
        const updatedRoom = roomManager.getRoom(roomCode);
        const finalUnicornIds = updatedRoom?.unicornIds ?? newUnicornIds;

        const results = {
            question: blitz.question.question,
            correctAnswer: blitz.question.options[blitz.question.correctAnswer],
            correctAnswerIndex: blitz.question.correctAnswer,
            rankings: correctAnswers.map((a, i) => ({
                rank: i + 1,
                playerId: a.playerId,
                playerName: a.playerName,
                responseTime: a.responseTime,
                isUnicorn: finalUnicornIds.includes(a.playerId),
                isReserve: false
            })),
            newUnicornIds: finalUnicornIds,
            newUnicornId: finalUnicornIds[0] ?? null,
            newUnicornName: updatedRoom?.players?.find(p => p.id === finalUnicornIds[0])?.name ?? null,
            reserveUnicornId: null,
            reserveUnicornName: null,
            oldUnicornId: oldUnicornId,
            totalPlayers: room.players.length,
            correctCount: correctAnswers.length
        };

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.BLITZ_RESULT, results);

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
            newUnicornIds: finalUnicornIds,
            newUnicornId: finalUnicornIds[0] ?? null,
            room: updatedRoom ?? room
        });

        this.blitzQuizzes.delete(roomCode);

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

        const unicornIds = room.unicornIds ?? (room.unicornId ? [room.unicornId] : []);
        const unicornNames = unicornIds.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean);

        const playersHealth = room.players.map(p => ({
            playerId: p.id,
            health: p.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH,
            state: p.state
        }));

        const roundInfo = this.getRoomRounds(roomCode);
        
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HUNT_START, {
            duration: GAME_LOOP_CONFIG.HUNT_DURATION,
            endTime: huntEndTime,
            unicornIds,
            unicornNames,
            unicornId: room.unicornId ?? unicornIds[0] ?? null,
            unicornName: unicornNames[0] ?? 'Unknown',
            reserveUnicornId: null,
            reserveUnicornName: null,
            timestamp: now,
            playersHealth,
            roundInfo
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
     * Handle unicorn disconnect during Hunt (one of multiple unicorns left)
     * RoomManager.removePlayerFromRoom already removed the id from room.unicornIds.
     * If no unicorns remain, trigger new blitz; otherwise emit UNICORN_TRANSFERRED with current set.
     * @param {string} roomCode - Room code
     * @param {string} disconnectedId - Disconnected unicorn ID
     * @param {Object} io - Socket.IO server
     * @param {Function} getRoom - Callback to get current room (RoomManager.getRoom)
     * @param {Function} onNoReserve - Callback when zero unicorns remain (start new blitz)
     * @returns {boolean} True if handled (either refilled or new blitz triggered)
     */
    handleUnicornDisconnect(roomCode, disconnectedId, io, getRoom, onNoReserve) {
        if (this.getGamePhase(roomCode) !== GAME_PHASE.HUNT) {
            return false;
        }

        const room = getRoom(roomCode);
        const unicornIds = room?.unicornIds ?? [];

        if (unicornIds.length > 0) {
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                newUnicornIds: unicornIds,
                newUnicornId: unicornIds[0],
                reason: 'unicorn_disconnected',
                previousUnicornId: disconnectedId,
                room
            });
            return true;
        }

        this.clearGameLoopTimers(roomCode);
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HUNT_END, {
            reason: 'unicorn_disconnected',
            message: 'All unicorns left! New Blitz Quiz starting...'
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
