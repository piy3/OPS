/**
 * Quiz Manager
 * Handles tag quiz mechanics (when unicorn catches a player)
 */

import { SOCKET_EVENTS, GAME_CONFIG } from '../../config/constants.js';
import { getRandomQuestions, QUIZ_CONFIG } from '../../config/questions.js';
import log from '../../utils/logger.js';

class QuizManager {
    constructor() {
        // Track active quizzes: roomCode -> { unicornId, caughtId, questions, startTime, answers }
        this.activeQuizzes = new Map();
        
        // Track quiz timeouts: roomCode -> timeoutId
        this.quizTimeouts = new Map();
        
        // Track frozen rooms: Set of roomCodes
        this.frozenRooms = new Set();
    }

    /**
     * Check if room is frozen (quiz in progress)
     * @param {string} roomCode - Room code
     * @returns {boolean} True if frozen
     */
    isRoomFrozen(roomCode) {
        return this.frozenRooms.has(roomCode);
    }

    /**
     * Freeze a room (block position updates)
     * @param {string} roomCode - Room code
     */
    freezeRoom(roomCode) {
        this.frozenRooms.add(roomCode);
    }

    /**
     * Unfreeze a room
     * @param {string} roomCode - Room code
     */
    unfreezeRoom(roomCode) {
        this.frozenRooms.delete(roomCode);
    }

    /**
     * Start a quiz when unicorn catches a player
     * @param {string} roomCode - Room code
     * @param {Object} unicornPlayer - Unicorn player { id, name }
     * @param {Object} caughtPlayer - Caught player { id, name }
     * @param {Object} io - Socket.IO server
     * @param {Function} onQuizComplete - Callback when quiz completes
     * @param {Function} respawnBothPlayers - Callback to respawn both players
     */
    startQuiz(roomCode, unicornPlayer, caughtPlayer, io, onQuizComplete, respawnBothPlayers) {
        // Generate questions
        const questions = getRandomQuestions(QUIZ_CONFIG.QUESTIONS_PER_QUIZ);
        
        // Store quiz state
        const quizData = {
            unicornId: unicornPlayer.id,
            unicornName: unicornPlayer.name,
            caughtId: caughtPlayer.id,
            caughtName: caughtPlayer.name,
            questions: questions,
            startTime: Date.now(),
            timeLimit: QUIZ_CONFIG.TOTAL_TIME_LIMIT,
            answers: [],
            completed: false
        };
        
        this.activeQuizzes.set(roomCode, quizData);

        // Freeze room
        this.freezeRoom(roomCode);

        // Broadcast freeze to all players
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_FROZEN, {
            message: `🦄 ${unicornPlayer.name} caught ${caughtPlayer.name}!`,
            unicornId: unicornPlayer.id,
            unicornName: unicornPlayer.name,
            caughtId: caughtPlayer.id,
            caughtName: caughtPlayer.name,
            freezeReason: 'quiz_started'
        });

        // Respawn both players to separate locations
        respawnBothPlayers(roomCode, unicornPlayer.id, caughtPlayer.id, io);

        // Send quiz to caught player only (without correct answers)
        const questionsForClient = questions.map(q => ({
            id: q.id,
            question: q.question,
            options: q.options
        }));

        io.to(caughtPlayer.id).emit(SOCKET_EVENTS.SERVER.QUIZ_START, {
            questions: questionsForClient,
            totalTimeLimit: QUIZ_CONFIG.TOTAL_TIME_LIMIT,
            timePerQuestion: QUIZ_CONFIG.TIME_PER_QUESTION,
            unicornName: unicornPlayer.name
        });

        // Clear existing timeout
        if (this.quizTimeouts.has(roomCode)) {
            clearTimeout(this.quizTimeouts.get(roomCode));
        }

        // Set timeout for auto-complete
        const timeoutId = setTimeout(() => {
            if (this.activeQuizzes.has(roomCode)) {
                const quiz = this.activeQuizzes.get(roomCode);
                if (!quiz.completed) {
                    this.completeQuiz(roomCode, io, true, onQuizComplete);
                }
            }
            this.quizTimeouts.delete(roomCode);
        }, QUIZ_CONFIG.TOTAL_TIME_LIMIT);
        
        this.quizTimeouts.set(roomCode, timeoutId);
    }

    /**
     * Submit an answer to the quiz
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID (must be caught player)
     * @param {number} questionId - Question ID
     * @param {number} answerIndex - Selected answer index
     * @returns {Object|null} Result or null
     */
    submitAnswer(roomCode, playerId, questionId, answerIndex) {
        const quiz = this.activeQuizzes.get(roomCode);
        
        if (!quiz) return null;
        if (playerId !== quiz.caughtId) return null;

        // Find question
        const question = quiz.questions.find(q => q.id === questionId);
        if (!question) return null;

        // Check if already answered
        if (quiz.answers.find(a => a.questionId === questionId)) return null;

        // Record answer
        const isCorrect = answerIndex === question.correctAnswer;
        quiz.answers.push({
            questionId: questionId,
            answerIndex: answerIndex,
            isCorrect: isCorrect,
            timestamp: Date.now()
        });

        return {
            questionId: questionId,
            isCorrect: isCorrect,
            totalAnswered: quiz.answers.length,
            totalQuestions: quiz.questions.length
        };
    }

    /**
     * Complete the quiz
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {boolean} isTimeout - Whether quiz ended due to timeout
     * @param {Function} onQuizComplete - Callback with results
     */
    completeQuiz(roomCode, io, isTimeout, onQuizComplete) {
        const quiz = this.activeQuizzes.get(roomCode);
        
        if (!quiz || quiz.completed) return;

        // Clear timeout
        if (this.quizTimeouts.has(roomCode)) {
            clearTimeout(this.quizTimeouts.get(roomCode));
            this.quizTimeouts.delete(roomCode);
        }

        quiz.completed = true;

        // Calculate results
        const totalQuestions = quiz.questions.length;
        const correctAnswers = quiz.answers.filter(a => a.isCorrect).length;
        const scorePercentage = Math.round((correctAnswers / totalQuestions) * 100);
        const timeTaken = Date.now() - quiz.startTime;

        // Determine winner
        const PASS_THRESHOLD = 60;
        const caughtPlayerWins = scorePercentage >= PASS_THRESHOLD && !isTimeout;

        // Emit quiz completion
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.QUIZ_COMPLETE, {
            caughtId: quiz.caughtId,
            caughtName: quiz.caughtName,
            unicornId: quiz.unicornId,
            unicornName: quiz.unicornName,
            correctAnswers: correctAnswers,
            totalQuestions: totalQuestions,
            scorePercentage: scorePercentage,
            isTimeout: isTimeout,
            timeTaken: timeTaken
        });

        // Unfreeze room
        this.unfreezeRoom(roomCode);

        // Call completion callback with results
        onQuizComplete({
            roomCode,
            caughtPlayerWins,
            caughtId: quiz.caughtId,
            unicornId: quiz.unicornId,
            scorePercentage,
            isTimeout
        });

        // Clean up
        this.activeQuizzes.delete(roomCode);
    }

    /**
     * Get active quiz for a room
     * @param {string} roomCode - Room code
     * @returns {Object|null} Quiz data or null
     */
    getActiveQuiz(roomCode) {
        return this.activeQuizzes.get(roomCode) || null;
    }

    /**
     * Check if room has an active quiz
     * @param {string} roomCode - Room code
     * @returns {boolean} True if quiz is active
     */
    hasActiveQuiz(roomCode) {
        return this.activeQuizzes.has(roomCode);
    }

    /**
     * Clear quiz state for a room
     * @param {string} roomCode - Room code
     */
    clearQuizState(roomCode) {
        if (this.quizTimeouts.has(roomCode)) {
            clearTimeout(this.quizTimeouts.get(roomCode));
            this.quizTimeouts.delete(roomCode);
        }
        
        if (this.activeQuizzes.has(roomCode)) {
            this.activeQuizzes.delete(roomCode);
        }
        
        this.unfreezeRoom(roomCode);
    }
}

export default new QuizManager();
