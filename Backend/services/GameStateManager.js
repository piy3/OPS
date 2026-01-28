/**
 * Game State Management Service
 * Handles player positions, game state synchronization, and game loop
 */

import roomManager from './RoomManager.js';
import { GAME_CONFIG, SOCKET_EVENTS, GAME_PHASE, GAME_LOOP_CONFIG, COMBAT_CONFIG, PLAYER_STATE, ROLE_CONFIG, COIN_CONFIG, POWERUP_CONFIG } from '../config/constants.js';
import { getRandomQuestions, QUIZ_CONFIG, getBlitzQuestion, BLITZ_QUIZ_CONFIG } from '../config/questions.js';

class GameStateManager {
    constructor() {
        // Store player positions: roomCode -> { playerId -> { x, y, timestamp, row, col, ... } }
        this.playerPositions = new Map();
        
        // Throttle tracking: socketId -> lastUpdateTime
        this.lastUpdateTime = new Map();
        
        // Track last grid positions for wrap-around detection: playerId -> { row, col }
        this.lastGridPositions = new Map();
        
        // Track active quizzes: roomCode -> { unicornId, caughtId, questions, startTime, answers }
        this.activeQuizzes = new Map();
        
        // Track quiz timeouts: roomCode -> timeoutId (so we can clear them)
        this.quizTimeouts = new Map();
        
        // Track frozen rooms: Set of roomCodes that are currently frozen
        this.frozenRooms = new Set();
        
        // Track recently respawned players: playerId -> timestamp (ignore their position updates briefly)
        this.respawnedPlayers = new Map();
        
        // ========== NEW: Game Loop State ==========
        // Track game phases: roomCode -> { phase, phaseStartTime, huntEndTime, etc. }
        this.gamePhases = new Map();
        
        // Track Blitz Quiz state: roomCode -> { question, answers: Map<playerId, { answer, timestamp, isCorrect }>, startTime }
        this.blitzQuizzes = new Map();
        
        // Track game loop timers: roomCode -> { huntTimer, blitzTimer }
        this.gameLoopTimers = new Map();
        
        // Track reserve unicorn: roomCode -> { playerId, activationTime }
        this.reserveUnicorns = new Map();

        // ========== COMBAT SYSTEM State ==========
        // Track i-frames: playerId -> { endTime, timeoutId }
        this.playerIFrames = new Map();
        
        // Track frozen players: playerId -> { endTime, timeoutId }
        this.frozenPlayers = new Map();
        
        // Track knockback: playerId -> { direction, endTime }
        this.playerKnockbacks = new Map();

        // ========== COIN & POWERUP State ==========
        // Track coins in each room: roomCode -> Map<coinId, { row, col, collected, respawnTimeoutId }>
        this.roomCoins = new Map();
        
        // Track powerups in each room: roomCode -> Map<powerupId, { row, col, type, collected }>
        this.roomPowerups = new Map();
        
        // Track powerup spawn timers: roomCode -> timeoutId
        this.powerupSpawnTimers = new Map();
        
        // Track active immunity effects: playerId -> { endTime, timeoutId }
        this.playerImmunity = new Map();

        // ========== RACE CONDITION PREVENTION ==========
        // Track coin pickup locks: coinId -> playerId (first to process wins)
        this.coinLocks = new Map();
        
        // Track powerup pickup locks: powerupId -> playerId
        this.powerupLocks = new Map();
        
        // Track collision cooldowns: `${attackerId}-${victimId}` -> timestamp
        this.collisionCooldowns = new Map();
    }

    // ========== GAME LOOP METHODS ==========

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
     * @param {Object} io - Socket.IO server instance
     */
    setGamePhase(roomCode, phase, io) {
        const now = Date.now();
        const phaseData = {
            phase: phase,
            phaseStartTime: now,
            previousPhase: this.getGamePhase(roomCode)
        };
        
        this.gamePhases.set(roomCode, phaseData);
        
        // console.log(`\n🔄 ===== PHASE CHANGE =====`);
        // console.log(`Room: ${roomCode}`);
        // console.log(`Phase: ${phaseData.previousPhase} → ${phase}`);
        // console.log(`Time: ${new Date(now).toISOString()}`);
        // console.log(`===========================\n`);
        
        // Notify all clients of phase change
        if (io) {
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PHASE_CHANGE, {
                phase: phase,
                previousPhase: phaseData.previousPhase,
                timestamp: now
            });
        }
    }

    /**
     * Start the game loop for a room
     * Called when game starts - begins with Blitz Quiz
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     */
    startGameLoop(roomCode, io) {
        // console.log(`\n🎮 ===== STARTING GAME LOOP =====`);
        // console.log(`Room: ${roomCode}`);
        // console.log(`================================\n`);
        
        // Clear any existing timers
        this.clearGameLoopTimers(roomCode);
        
        // Start with Blitz Quiz immediately
        this.startBlitzQuiz(roomCode, io);
    }

    /**
     * Clear all game loop timers for a room
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
     * Start Blitz Quiz phase
     * All players answer the same question simultaneously
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     */
    startBlitzQuiz(roomCode, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== 'playing') {
            // console.log(`❌ Cannot start Blitz Quiz: Room ${roomCode} not found or not playing`);
            return;
        }

        // Set phase to BLITZ_QUIZ
        this.setGamePhase(roomCode, GAME_PHASE.BLITZ_QUIZ, io);
        
        // Freeze the game during quiz
        this.frozenRooms.add(roomCode);
        // console.log(`❄️ Room ${roomCode} frozen for Blitz Quiz`);

        // Get a random question
        const question = getBlitzQuestion();
        const now = Date.now();
        
        // Store Blitz Quiz state
        const blitzData = {
            question: question,
            answers: new Map(), // playerId -> { answer, timestamp, isCorrect }
            startTime: now,
            timeLimit: BLITZ_QUIZ_CONFIG.TIME_LIMIT,
            completed: false
        };
        this.blitzQuizzes.set(roomCode, blitzData);

        // console.log(`\n⚡ ===== BLITZ QUIZ STARTED =====`);
        // console.log(`Room: ${roomCode}`);
        // console.log(`Question: ${question.question}`);
        // console.log(`Players: ${room.players.length}`);
        // console.log(`Time Limit: ${BLITZ_QUIZ_CONFIG.TIME_LIMIT}ms`);
        // console.log(`=================================\n`);

        // Send quiz to ALL players (without correct answer)
        const questionForClients = {
            id: question.id,
            question: question.question,
            options: question.options
            // correctAnswer NOT sent to clients
        };

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.BLITZ_START, {
            question: questionForClients,
            timeLimit: BLITZ_QUIZ_CONFIG.TIME_LIMIT,
            playerCount: room.players.length,
            timestamp: now
        });

        // Set timeout to end quiz
        const timers = this.gameLoopTimers.get(roomCode) || {};
        timers.blitzTimer = setTimeout(() => {
            this.endBlitzQuiz(roomCode, io);
        }, BLITZ_QUIZ_CONFIG.TIME_LIMIT);
        this.gameLoopTimers.set(roomCode, timers);
    }

    /**
     * Submit a Blitz Quiz answer
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {number} answerIndex - Selected answer index
     * @param {Object} io - Socket.IO server instance
     * @returns {Object|null} Result or null
     */
    submitBlitzAnswer(roomCode, playerId, answerIndex, io) {
        const blitz = this.blitzQuizzes.get(roomCode);
        
        if (!blitz || blitz.completed) {
            // console.log(`❌ No active Blitz Quiz in room ${roomCode}`);
            return null;
        }

        // Check if player already answered
        if (blitz.answers.has(playerId)) {
            // console.log(`⚠️ Player ${playerId} already answered Blitz Quiz`);
            return null;
        }

        const now = Date.now();
        const responseTime = now - blitz.startTime;
        const isCorrect = answerIndex === blitz.question.correctAnswer;

        // Record the answer
        blitz.answers.set(playerId, {
            answer: answerIndex,
            timestamp: now,
            responseTime: responseTime,
            isCorrect: isCorrect
        });

        const room = roomManager.getRoom(roomCode);
        const player = room?.players.find(p => p.id === playerId);
        
        // console.log(`⚡ Blitz Answer: ${player?.name || playerId} - ${isCorrect ? '✅ Correct' : '❌ Wrong'} (${responseTime}ms)`);

        // Send individual feedback
        if (io) {
            io.to(playerId).emit(SOCKET_EVENTS.SERVER.BLITZ_ANSWER_RESULT, {
                isCorrect: isCorrect,
                responseTime: responseTime,
                answersReceived: blitz.answers.size,
                totalPlayers: room?.players.length || 0
            });
        }

        // Check if all players have answered
        if (room && blitz.answers.size >= room.players.length) {
            // console.log(`✅ All players answered Blitz Quiz, ending early`);
            // Clear the timeout since all answered
            const timers = this.gameLoopTimers.get(roomCode);
            if (timers?.blitzTimer) {
                clearTimeout(timers.blitzTimer);
            }
            this.endBlitzQuiz(roomCode, io);
        }

        return {
            isCorrect: isCorrect,
            responseTime: responseTime
        };
    }

    /**
     * End Blitz Quiz and determine roles
     * Fastest correct answer becomes Unicorn
     * Second fastest becomes Reserve Unicorn
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     */
    endBlitzQuiz(roomCode, io) {
        const blitz = this.blitzQuizzes.get(roomCode);
        
        if (!blitz || blitz.completed) {
            // console.log(`⚠️ Blitz Quiz already completed or not found for room ${roomCode}`);
            return;
        }

        blitz.completed = true;

        const room = roomManager.getRoom(roomCode);
        if (!room) {
            // console.log(`❌ Room ${roomCode} not found`);
            return;
        }

        // console.log(`\n⚡ ===== BLITZ QUIZ ENDED =====`);
        // console.log(`Room: ${roomCode}`);
        // console.log(`Answers received: ${blitz.answers.size}/${room.players.length}`);

        // Get all correct answers sorted by response time (fastest first)
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

        // console.log(`Correct answers: ${correctAnswers.length}`);
        correctAnswers.forEach((a, i) => {
            // console.log(`  ${i + 1}. ${a.playerName} (${a.responseTime}ms)`);
        });

        // Determine new Unicorn (fastest correct answer)
        let newUnicornId = null;
        let newUnicornName = null;
        let reserveId = null;
        let reserveName = null;

        if (correctAnswers.length > 0) {
            // Fastest correct answer becomes Unicorn
            newUnicornId = correctAnswers[0].playerId;
            newUnicornName = correctAnswers[0].playerName;
            
            // Second fastest becomes Reserve (if enabled and enough players)
            if (GAME_LOOP_CONFIG.RESERVE_UNICORN_ENABLED && 
                correctAnswers.length > 1 && 
                room.players.length >= BLITZ_QUIZ_CONFIG.MIN_PLAYERS_FOR_RESERVE) {
                reserveId = correctAnswers[1].playerId;
                reserveName = correctAnswers[1].playerName;
                this.reserveUnicorns.set(roomCode, {
                    playerId: reserveId,
                    playerName: reserveName,
                    activationTime: null
                });
            }
        } else {
            // No correct answers - pick random player as Unicorn
            const randomIndex = Math.floor(Math.random() * room.players.length);
            newUnicornId = room.players[randomIndex].id;
            newUnicornName = room.players[randomIndex].name;
            // console.log(`⚠️ No correct answers, random Unicorn: ${newUnicornName}`);
        }

        // Transfer Unicorn role
        const oldUnicornId = room.unicornId;
        if (newUnicornId && newUnicornId !== oldUnicornId) {
            roomManager.transferUnicorn(roomCode, newUnicornId);
            
            // Give bonus to Blitz winner
            roomManager.updatePlayerCoins(roomCode, newUnicornId, GAME_LOOP_CONFIG.BLITZ_WINNER_BONUS);
        }

        // console.log(`🦄 New Unicorn: ${newUnicornName} (${newUnicornId})`);
        if (reserveId) {
            // console.log(`🦄 Reserve Unicorn: ${reserveName} (${reserveId})`);
        }
        // console.log(`==============================\n`);

        // Build results for all players
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

        // Notify all players of results
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.BLITZ_RESULT, results);

        // Also emit unicorn transfer event
        if (newUnicornId !== oldUnicornId) {
            const updatedRoom = roomManager.getRoom(roomCode);
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                newUnicornId: newUnicornId,
                oldUnicornId: oldUnicornId,
                room: updatedRoom
            });
        }

        // Clean up Blitz state
        this.blitzQuizzes.delete(roomCode);

        // Start Hunt phase after a brief delay to show results
        setTimeout(() => {
            this.startHuntPhase(roomCode, io);
        }, GAME_LOOP_CONFIG.ROUND_END_DURATION);
    }

    /**
     * Start Hunt phase
     * Unicorn hunts survivors, survivors evade and collect coins
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     */
    startHuntPhase(roomCode, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.status !== 'playing') {
            // console.log(`❌ Cannot start Hunt: Room ${roomCode} not found or not playing`);
            return;
        }

        // Set phase to HUNT
        this.setGamePhase(roomCode, GAME_PHASE.HUNT, io);
        
        // Unfreeze the game
        this.frozenRooms.delete(roomCode);
        // console.log(`🔓 Room ${roomCode} unfrozen for Hunt phase`);

        // Reset all players' health and combat states for new round
        roomManager.resetPlayersHealth(roomCode);
        
        // Clear any lingering combat states (i-frames, frozen players, knockbacks)
        room.players.forEach(player => {
            this.cleanupPlayerCombatState(player.id);
        });

        const now = Date.now();
        const huntEndTime = now + GAME_LOOP_CONFIG.HUNT_DURATION;

        // console.log(`\n🏃 ===== HUNT PHASE STARTED =====`);
        // console.log(`Room: ${roomCode}`);
        // console.log(`Duration: ${GAME_LOOP_CONFIG.HUNT_DURATION}ms`);
        // console.log(`Ends at: ${new Date(huntEndTime).toISOString()}`);
        // console.log(`All players health reset to ${COMBAT_CONFIG.STARTING_HEALTH}`);
        // console.log(`=================================\n`);

        // Notify clients
        const unicornPlayer = room.players.find(p => p.id === room.unicornId);
        const reserve = this.reserveUnicorns.get(roomCode);

        // Build player health data for clients
        const playersHealth = room.players.map(p => ({
            playerId: p.id,
            health: p.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH,
            state: p.state
        }));

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HUNT_START, {
            duration: GAME_LOOP_CONFIG.HUNT_DURATION,
            endTime: huntEndTime,
            unicornId: room.unicornId,
            unicornName: unicornPlayer?.name || 'Unknown',
            reserveUnicornId: reserve?.playerId || null,
            reserveUnicornName: reserve?.playerName || null,
            timestamp: now,
            playersHealth: playersHealth // Include health data
        });

        // Initialize coins and powerups for the Hunt phase
        this.initializeCoins(roomCode, io);
        this.startPowerupSpawning(roomCode, io);

        // Set timer for next Blitz Quiz
        const timers = this.gameLoopTimers.get(roomCode) || {};
        timers.huntTimer = setTimeout(() => {
            this.startBlitzQuiz(roomCode, io);
        }, GAME_LOOP_CONFIG.HUNT_DURATION);

        // Set interval to update hunt timer (every 5 seconds)
        timers.huntUpdateInterval = setInterval(() => {
            const remaining = huntEndTime - Date.now();
            if (remaining > 0) {
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PHASE_CHANGE, {
                    remainingTime: remaining,
                    endTime: huntEndTime
                });
            }
        }, 5000);

        this.gameLoopTimers.set(roomCode, timers);
    }

    /**
     * Handle unicorn tagging a survivor during Hunt phase
     * Now uses health-based combat system with i-frames and knockback
     * @param {string} roomCode - Room code
     * @param {string} unicornId - Unicorn player ID
     * @param {string} survivorId - Tagged survivor player ID
     * @param {Object} io - Socket.IO server instance
     */
    handleTag(roomCode, unicornId, survivorId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        // Verify we're in Hunt phase
        if (this.getGamePhase(roomCode) !== GAME_PHASE.HUNT) {
            return;
        }

        // Verify unicorn is correct
        if (room.unicornId !== unicornId) {
            // console.log(`⚠️ Tag rejected: ${unicornId} is not the unicorn`);
            return;
        }

        // ========== COLLISION COOLDOWN (Race Condition Prevention) ==========
        const collisionKey = `${unicornId}-${survivorId}`;
        const now = Date.now();
        const lastCollision = this.collisionCooldowns.get(collisionKey);
        
        // Minimum 500ms between collisions with same player pair
        const COLLISION_COOLDOWN = 500;
        if (lastCollision && (now - lastCollision) < COLLISION_COOLDOWN) {
            return; // Ignore duplicate collision
        }
        
        // Update collision timestamp
        this.collisionCooldowns.set(collisionKey, now);
        
        // Clean up old cooldowns periodically
        if (this.collisionCooldowns.size > 100) {
            const cutoff = now - 5000; // Remove entries older than 5 seconds
            for (const [key, timestamp] of this.collisionCooldowns) {
                if (timestamp < cutoff) {
                    this.collisionCooldowns.delete(key);
                }
            }
        }

        const unicornPlayer = room.players.find(p => p.id === unicornId);
        const survivorPlayer = room.players.find(p => p.id === survivorId);

        if (!unicornPlayer || !survivorPlayer) return;

        // ========== COMBAT VALIDATION ==========
        
        // Check if survivor is immune (has immunity powerup)
        if (survivorPlayer.isImmune) {
            // console.log(`🛡️ Tag blocked: ${survivorPlayer.name} is IMMUNE`);
            return;
        }

        // Check if survivor is in i-frames
        if (survivorPlayer.inIFrames || this.playerIFrames.has(survivorId)) {
            // console.log(`⚡ Tag blocked: ${survivorPlayer.name} is in I-FRAMES`);
            return;
        }

        // Check if survivor is already frozen
        if (survivorPlayer.state === PLAYER_STATE.FROZEN || this.frozenPlayers.has(survivorId)) {
            // console.log(`❄️ Tag blocked: ${survivorPlayer.name} is already FROZEN`);
            return;
        }

        // console.log(`\n💥 ===== COMBAT: HIT =====`);
        // console.log(`Attacker: ${unicornPlayer.name} (Unicorn)`);
        // console.log(`Victim: ${survivorPlayer.name} (${survivorPlayer.health} HP)`);

        // ========== EXECUTE COMBAT ==========
        
        // Deal damage to survivor
        const oldHealth = survivorPlayer.health;
        roomManager.updatePlayerHealth(roomCode, survivorId, -COMBAT_CONFIG.TAG_DAMAGE);
        
        // Heal/Score for unicorn
        roomManager.updatePlayerCoins(roomCode, unicornId, COMBAT_CONFIG.TAG_HEAL);
        
        // Refresh player data after updates
        const updatedSurvivor = roomManager.getPlayer(roomCode, survivorId);
        const updatedUnicorn = roomManager.getPlayer(roomCode, unicornId);

        // console.log(`Damage dealt: ${COMBAT_CONFIG.TAG_DAMAGE}`);
        // console.log(`Survivor health: ${oldHealth} → ${updatedSurvivor.health}`);
        // console.log(`Unicorn score: +${COMBAT_CONFIG.TAG_HEAL}`);

        // ========== APPLY KNOCKBACK ==========
        let knockbackData = null;
        if (COMBAT_CONFIG.KNOCKBACK_ENABLED) {
            knockbackData = this.applyKnockback(roomCode, survivorId, unicornId, io);
        }

        // ========== GRANT I-FRAMES ==========
        this.grantIFrames(roomCode, survivorId, io);

        // ========== BROADCAST HIT EVENT ==========
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_HIT, {
            attackerId: unicornId,
            attackerName: unicornPlayer.name,
            victimId: survivorId,
            victimName: survivorPlayer.name,
            damage: COMBAT_CONFIG.TAG_DAMAGE,
            newHealth: updatedSurvivor.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH,
            knockback: knockbackData,
            iframeDuration: COMBAT_CONFIG.IFRAME_DURATION
        });

        // Emit health update
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HEALTH_UPDATE, {
            playerId: survivorId,
            health: updatedSurvivor.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH
        });

        // ========== CHECK FOR ZERO HEALTH ==========
        if (updatedSurvivor.health <= 0) {
            // console.log(`💀 ${survivorPlayer.name} health reached ZERO!`);
            this.handleZeroHealth(roomCode, survivorId, io);
        }

        // Also emit score update for leaderboard
        const updatedRoom = roomManager.getRoom(roomCode);
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SCORE_UPDATE, {
            unicornId: unicornId,
            caughtId: survivorId,
            unicornCoins: updatedUnicorn.coins,
            caughtCoins: updatedSurvivor.coins,
            room: updatedRoom,
            leaderboard: roomManager.getLeaderboard(roomCode)
        });

        // console.log(`==========================\n`);
    }

    /**
     * Grant invincibility frames to a player
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} io - Socket.IO server instance
     */
    grantIFrames(roomCode, playerId, io) {
        // Set i-frames on player
        roomManager.setPlayerIFrames(roomCode, playerId, true);
        
        // Clear any existing i-frame timeout
        const existing = this.playerIFrames.get(playerId);
        if (existing?.timeoutId) {
            clearTimeout(existing.timeoutId);
        }

        // Set timeout to remove i-frames
        const timeoutId = setTimeout(() => {
            roomManager.setPlayerIFrames(roomCode, playerId, false);
            this.playerIFrames.delete(playerId);
            
            // console.log(`⚡ I-frames expired for ${playerId}`);
            
            // Notify clients
            if (io) {
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_STATE_CHANGE, {
                    playerId: playerId,
                    state: PLAYER_STATE.ACTIVE,
                    inIFrames: false
                });
            }
        }, COMBAT_CONFIG.IFRAME_DURATION);

        this.playerIFrames.set(playerId, {
            endTime: Date.now() + COMBAT_CONFIG.IFRAME_DURATION,
            timeoutId: timeoutId
        });

        // console.log(`⚡ I-frames granted to ${playerId} for ${COMBAT_CONFIG.IFRAME_DURATION}ms`);
    }

    /**
     * Apply knockback to a player
     * @param {string} roomCode - Room code
     * @param {string} victimId - Player being knocked back
     * @param {string} attackerId - Player doing the knockback
     * @param {Object} io - Socket.IO server instance
     * @returns {Object} Knockback data
     */
    applyKnockback(roomCode, victimId, attackerId, io) {
        const victimPos = this.getPlayerPosition(roomCode, victimId);
        const attackerPos = this.getPlayerPosition(roomCode, attackerId);
        
        if (!victimPos || !attackerPos) return null;

        // Calculate knockback direction (away from attacker)
        let knockbackDirection = { row: 0, col: 0 };
        
        if (victimPos.row !== attackerPos.row) {
            knockbackDirection.row = victimPos.row > attackerPos.row ? 1 : -1;
        }
        if (victimPos.col !== attackerPos.col) {
            knockbackDirection.col = victimPos.col > attackerPos.col ? 1 : -1;
        }
        
        // If same position, push in a default direction
        if (knockbackDirection.row === 0 && knockbackDirection.col === 0) {
            knockbackDirection.col = 1; // Push right by default
        }

        // Calculate new position after knockback
        const newRow = victimPos.row + (knockbackDirection.row * COMBAT_CONFIG.KNOCKBACK_DISTANCE);
        const newCol = victimPos.col + (knockbackDirection.col * COMBAT_CONFIG.KNOCKBACK_DISTANCE);

        // Store knockback data
        const knockbackData = {
            direction: knockbackDirection,
            fromRow: victimPos.row,
            fromCol: victimPos.col,
            toRow: newRow,
            toCol: newCol,
            duration: COMBAT_CONFIG.KNOCKBACK_DURATION
        };

        this.playerKnockbacks.set(victimId, {
            direction: knockbackDirection,
            endTime: Date.now() + COMBAT_CONFIG.KNOCKBACK_DURATION
        });

        // Clear knockback after duration
        setTimeout(() => {
            this.playerKnockbacks.delete(victimId);
        }, COMBAT_CONFIG.KNOCKBACK_DURATION);

        // console.log(`🏃 Knockback: ${victimId} pushed from (${victimPos.row},${victimPos.col}) direction (${knockbackDirection.row},${knockbackDirection.col})`);

        return knockbackData;
    }

    /**
     * Handle player reaching zero health
     * Freezes player, then respawns after delay
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} io - Socket.IO server instance
     */
    handleZeroHealth(roomCode, playerId, io) {
        const player = roomManager.getPlayer(roomCode, playerId);
        if (!player) return;

        // console.log(`\n❄️ ===== ZERO HEALTH: FREEZE =====`);
        // console.log(`Player: ${player.name}`);
        // console.log(`Freeze duration: ${COMBAT_CONFIG.FREEZE_DURATION}ms`);

        // Set player state to FROZEN
        roomManager.setPlayerState(roomCode, playerId, PLAYER_STATE.FROZEN);
        
        // Clear any existing i-frames (frozen state takes priority)
        const existingIFrames = this.playerIFrames.get(playerId);
        if (existingIFrames?.timeoutId) {
            clearTimeout(existingIFrames.timeoutId);
            this.playerIFrames.delete(playerId);
        }
        roomManager.setPlayerIFrames(roomCode, playerId, false);

        // Notify clients of freeze
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_STATE_CHANGE, {
            playerId: playerId,
            playerName: player.name,
            state: PLAYER_STATE.FROZEN,
            freezeDuration: COMBAT_CONFIG.FREEZE_DURATION
        });

        // Set timeout for respawn
        const timeoutId = setTimeout(() => {
            this.respawnAfterFreeze(roomCode, playerId, io);
        }, COMBAT_CONFIG.FREEZE_DURATION);

        this.frozenPlayers.set(playerId, {
            endTime: Date.now() + COMBAT_CONFIG.FREEZE_DURATION,
            timeoutId: timeoutId
        });

        // console.log(`==================================\n`);
    }

    /**
     * Respawn player after freeze duration
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} io - Socket.IO server instance
     */
    respawnAfterFreeze(roomCode, playerId, io) {
        const player = roomManager.getPlayer(roomCode, playerId);
        if (!player) return;

        // console.log(`\n🔄 ===== RESPAWN AFTER FREEZE =====`);
        // console.log(`Player: ${player.name}`);

        // Clear frozen state
        this.frozenPlayers.delete(playerId);
        
        // Set state to ACTIVE
        roomManager.setPlayerState(roomCode, playerId, PLAYER_STATE.ACTIVE);
        
        // Restore health to RESPAWN_HEALTH
        roomManager.setPlayerHealth(roomCode, playerId, COMBAT_CONFIG.RESPAWN_HEALTH);
        
        // Get new spawn position
        const spawnPos = this.findFreeSpawnPosition(roomCode, playerId);
        
        // Update position
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            const currentPos = roomPositions.get(playerId);
            const newPos = {
                ...currentPos,
                row: spawnPos.row,
                col: spawnPos.col,
                x: 0,
                y: 0,
                timestamp: Date.now()
            };
            
            roomPositions.set(playerId, newPos);
            this.lastGridPositions.set(playerId, { row: spawnPos.row, col: spawnPos.col });
            this.respawnedPlayers.set(playerId, Date.now());

            // Grant i-frames after respawn
            this.grantIFrames(roomCode, playerId, io);

            // Broadcast new position
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
                playerId: playerId,
                position: newPos
            });
        }

        // Get updated player
        const updatedPlayer = roomManager.getPlayer(roomCode, playerId);

        // Notify clients of respawn
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_RESPAWN, {
            playerId: playerId,
            playerName: player.name,
            health: updatedPlayer.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH,
            position: spawnPos,
            state: PLAYER_STATE.ACTIVE
        });

        // Also emit health update
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HEALTH_UPDATE, {
            playerId: playerId,
            health: updatedPlayer.health,
            maxHealth: COMBAT_CONFIG.MAX_HEALTH
        });

        // console.log(`Respawn position: row=${spawnPos.row}, col=${spawnPos.col}`);
        // console.log(`Health restored: ${COMBAT_CONFIG.RESPAWN_HEALTH}/${COMBAT_CONFIG.MAX_HEALTH}`);
        // console.log(`====================================\n`);
    }

    /**
     * Check if player can move (not frozen)
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @returns {boolean} True if player can move
     */
    canPlayerMove(roomCode, playerId) {
        const player = roomManager.getPlayer(roomCode, playerId);
        if (!player) return false;

        // Check if frozen
        if (player.state === PLAYER_STATE.FROZEN || this.frozenPlayers.has(playerId)) {
            return false;
        }

        return true;
    }

    /**
     * Clean up combat state for a player
     * @param {string} playerId - Player ID
     */
    cleanupPlayerCombatState(playerId) {
        // Clear i-frames
        const iframes = this.playerIFrames.get(playerId);
        if (iframes?.timeoutId) {
            clearTimeout(iframes.timeoutId);
        }
        this.playerIFrames.delete(playerId);

        // Clear frozen state
        const frozen = this.frozenPlayers.get(playerId);
        if (frozen?.timeoutId) {
            clearTimeout(frozen.timeoutId);
        }
        this.frozenPlayers.delete(playerId);

        // Clear knockback
        this.playerKnockbacks.delete(playerId);

        // Clear immunity if player has one
        this.cleanupPlayerImmunity(playerId);
    }

    /**
     * Respawn a player to a free position
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player to respawn
     * @param {Object} io - Socket.IO server instance
     */
    respawnPlayer(roomCode, playerId, io) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return;

        const spawnPos = this.findFreeSpawnPosition(roomCode, playerId);
        
        const currentPos = roomPositions.get(playerId);
        const newPos = {
            ...currentPos,
            row: spawnPos.row,
            col: spawnPos.col,
            x: 0,
            y: 0,
            timestamp: Date.now()
        };
        
        roomPositions.set(playerId, newPos);
        this.lastGridPositions.set(playerId, { row: spawnPos.row, col: spawnPos.col });
        this.respawnedPlayers.set(playerId, Date.now());

        // Broadcast new position
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
            playerId: playerId,
            position: newPos
        });
    }

    /**
     * Clean up game loop state for a room
     * @param {string} roomCode - Room code
     */
    cleanupGameLoop(roomCode) {
        this.clearGameLoopTimers(roomCode);
        this.gamePhases.delete(roomCode);
        this.blitzQuizzes.delete(roomCode);
        this.reserveUnicorns.delete(roomCode);
        this.cleanupMapInteractions(roomCode);
    }

    // ========== EDGE CASE HANDLING ==========

    /**
     * Handle unicorn disconnect during Hunt phase
     * Promotes reserve unicorn or triggers new Blitz Quiz
     * @param {string} roomCode - Room code
     * @param {string} disconnectedUnicornId - The disconnected unicorn's ID
     * @param {Object} io - Socket.IO server instance
     */
    handleUnicornDisconnect(roomCode, disconnectedUnicornId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        const currentPhase = this.getGamePhase(roomCode);
        
        // Only handle during active Hunt phase
        if (currentPhase !== GAME_PHASE.HUNT) {
            // console.log(`⚠️ Unicorn disconnect ignored - not in HUNT phase (current: ${currentPhase})`);
            return;
        }

        // console.log(`\n🦄❌ ===== UNICORN DISCONNECTED =====`);
        // console.log(`Room: ${roomCode}`);
        // console.log(`Disconnected Unicorn: ${disconnectedUnicornId}`);

        const reserve = this.reserveUnicorns.get(roomCode);

        if (reserve && reserve.playerId) {
            // Check if reserve player is still in the room
            const reservePlayer = room.players.find(p => p.id === reserve.playerId);
            
            if (reservePlayer) {
                // Promote reserve to unicorn
                // console.log(`🥈➡️🦄 Promoting reserve unicorn: ${reserve.playerName}`);
                
                // Update room state
                roomManager.setUnicorn(roomCode, reserve.playerId);
                
                // Clear reserve
                this.reserveUnicorns.delete(roomCode);
                
                // Notify clients
                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                    newUnicornId: reserve.playerId,
                    newUnicornName: reserve.playerName,
                    reason: 'unicorn_disconnected',
                    previousUnicornId: disconnectedUnicornId
                });

                io.to(roomCode).emit(SOCKET_EVENTS.SERVER.RESERVE_ACTIVATED, {
                    newUnicornId: reserve.playerId,
                    newUnicornName: reserve.playerName,
                    reason: 'unicorn_disconnected'
                });

                // console.log(`✅ Reserve ${reserve.playerName} is now the Unicorn!`);
                // console.log(`=====================================\n`);
                return;
            }
        }

        // No valid reserve - end Hunt phase early and start new Blitz Quiz
        // console.log(`⚠️ No reserve unicorn available - triggering new Blitz Quiz`);
        // console.log(`=====================================\n`);

        // Clear current hunt timers
        this.clearGameLoopTimers(roomCode);

        // Emit hunt end event
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.HUNT_END, {
            reason: 'unicorn_disconnected',
            message: 'Unicorn disconnected! New Blitz Quiz starting...'
        });

        // Clean up map interactions (coins, powerups)
        this.cleanupMapInteractions(roomCode);

        // Short delay before new Blitz Quiz
        setTimeout(() => {
            this.startBlitzQuiz(roomCode, io);
        }, 2000);
    }

    /**
     * Check if a player leaving is the unicorn and handle accordingly
     * @param {string} roomCode - Room code
     * @param {string} playerId - Leaving player's ID
     * @param {Object} io - Socket.IO server instance
     * @returns {boolean} True if unicorn disconnect was handled
     */
    checkAndHandleUnicornLeave(roomCode, playerId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return false;

        // Check if leaving player is the unicorn
        if (room.unicornId === playerId) {
            this.handleUnicornDisconnect(roomCode, playerId, io);
            return true;
        }

        // Check if leaving player is the reserve unicorn
        const reserve = this.reserveUnicorns.get(roomCode);
        if (reserve && reserve.playerId === playerId) {
            // console.log(`🥈❌ Reserve unicorn ${reserve.playerName} disconnected`);
            this.reserveUnicorns.delete(roomCode);
            
            // Notify clients that reserve is gone
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.RESERVE_ACTIVATED, {
                newUnicornId: null,
                reason: 'reserve_disconnected'
            });
        }

        return false;
    }

    /**
     * Initialize game state for a room and assign spawn positions
     * @param {string} roomCode - Room code
     */
    initializeRoom(roomCode) {
        if (!this.playerPositions.has(roomCode)) {
            this.playerPositions.set(roomCode, new Map());
        }

        // Assign spawn positions to all players in the room
        const room = roomManager.getRoom(roomCode);
        if (!room || !room.players) {
            return;
        }

        const spawnPositions = GAME_CONFIG.SPAWN_POSITIONS;
        const roomPositions = this.playerPositions.get(roomCode);

        // Track which spawn positions are already used in this initialization
        const usedSpawnPositions = new Set();

        // First, mark positions that are already occupied by existing players
        roomPositions.forEach((position) => {
            const posKey = `${position.row},${position.col}`;
            usedSpawnPositions.add(posKey);
        });

        // Assign unique spawn positions to each player
        // ONLY initialize if player doesn't already have a position!
        room.players.forEach((player) => {
            // Check if player already has a position - if so, DON'T reset it!
            if (roomPositions.has(player.id)) {
                // console.log(`✓ Player ${player.id} already has position, skipping init`);
                return; // Skip this player, they already have a position
            }

            // Find the first available spawn position that's not used
            let spawnPos = null;
            for (const pos of spawnPositions) {
                const posKey = `${pos.row},${pos.col}`;
                if (!usedSpawnPositions.has(posKey)) {
                    spawnPos = pos;
                    usedSpawnPositions.add(posKey); // Mark as used
                    break;
                }
            }

            // Fallback: if all predefined positions are used, generate a unique offset position
            if (!spawnPos) {
                // Use a position with offset to avoid exact collision
                const fallbackIndex = usedSpawnPositions.size % spawnPositions.length;
                const basePos = spawnPositions[fallbackIndex];
                // Add small offset based on player count to spread them out
                const offset = Math.floor(usedSpawnPositions.size / spawnPositions.length) * 2;
                spawnPos = {
                    row: Math.min(26, basePos.row + offset),
                    col: Math.min(30, basePos.col + (offset % 2 === 0 ? 1 : -1))
                };
                const posKey = `${spawnPos.row},${spawnPos.col}`;
                usedSpawnPositions.add(posKey);
                // console.log(`⚠️ Using fallback spawn position for player ${player.id}`);
            }

            // Initialize player position at spawn point
            // Note: x, y will be calculated on the client side from row/col
            // We just store row/col here
            const positionState = {
                x: 0, // Will be calculated on client
                y: 0, // Will be calculated on client
                row: spawnPos.row,
                col: spawnPos.col,
                playerId: player.id,
                timestamp: Date.now(),
                isWrap: false
            };

            // console.log(`🎬 Initializing player ${player.id} at spawn: row=${spawnPos.row}, col=${spawnPos.col}`);
            roomPositions.set(player.id, positionState);
            this.lastGridPositions.set(player.id, { row: spawnPos.row, col: spawnPos.col });
        });
    }

    /**
     * Clean up game state for a room
     * @param {string} roomCode - Room code
     */
    cleanupRoom(roomCode) {
        this.playerPositions.delete(roomCode);
        this.cleanupGameLoop(roomCode);
    }

    /**
     * Update player position with rate limiting and validation
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @param {Object} positionData - Position data { x, y, angle?, velocity?, isUnicorn?, ... }
     * @param {Object} io - Socket.IO server instance (optional)
     * @returns {Object|null} Updated position or null if throttled/invalid
     */
    updatePlayerPosition(roomCode, playerId, positionData, io = null) {
        const room = roomManager.getRoom(roomCode); // redundant
        if (!room) return null;

        if (this.frozenRooms.has(roomCode)) {
            return null;
        }

        // Block position updates if player is frozen (zero health)
        if (!this.canPlayerMove(roomCode, playerId)) {
            // console.log(`❄️ Position update blocked: Player ${playerId} is frozen`);
            return null;
        }

        // Block position updates from recently respawned players (prevent override)
        const respawnTime = this.respawnedPlayers.get(playerId);
        if (respawnTime) {
            const timeSinceRespawn = Date.now() - respawnTime;
            if (timeSinceRespawn < 500) { // Ignore updates for 500ms after respawn
                // console.log(`🚫 Ignoring position update from recently respawned player ${playerId} (${timeSinceRespawn}ms ago)`);
                return null;
            } else {
                // Enough time has passed, remove from respawned list
                this.respawnedPlayers.delete(playerId);
            }
        }

        // Initialize room state if needed
        this.initializeRoom(roomCode); // i think we are doing it for respawning the dead player to get a non colliding spawning place

        // Get old position before updating
        const oldPosition = this.getPlayerPosition(roomCode, playerId);
        // console.log(`📝 Update request for ${playerId}: OLD pos=(${oldPosition?.row},${oldPosition?.col}) → NEW pos=(${positionData.row},${positionData.col})`);

        // Rate limiting: Check if update is too frequent
        const now = Date.now();
        const lastUpdate = this.lastUpdateTime.get(playerId) || 0;
        const timeSinceLastUpdate = now - lastUpdate;

        if (timeSinceLastUpdate < GAME_CONFIG.POSITION_UPDATE_INTERVAL) {
            // console.log(`⚠️ THROTTLED: Update too fast (${timeSinceLastUpdate}ms < ${GAME_CONFIG.POSITION_UPDATE_INTERVAL}ms)`);
            return null; // Throttled
        }

        // Validate position data
        const validatedPosition = this.validatePosition(positionData);
        if (!validatedPosition) {
            // console.log(`⚠️ INVALID: Position validation failed for x=${positionData.x}, y=${positionData.y}, row=${positionData.row}, col=${positionData.col}`);
            return null; // Invalid position
        }
        
        // console.log(`✅ Position update ACCEPTED: will store (${validatedPosition.row},${validatedPosition.col})`);

        // Get player from room to check if they are unicorn
        const player = room.players.find(p => p.id === playerId);
        const isUnicorn = player ? player.isUnicorn : false;

        // Get last grid position for wrap detection
        const lastGridPos = this.lastGridPositions.get(playerId) || { row: validatedPosition.row, col: validatedPosition.col };
        const currentGridPos = { row: validatedPosition.row, col: validatedPosition.col };
        
        // Detect wrap-around: if row/col are provided and changed significantly, it's a wrap
        // // This helps remote clients detect wraps properly
        let isWrap = false;
        if (typeof validatedPosition.row === 'number' && typeof validatedPosition.col === 'number') {
            const colDiff = validatedPosition.col - lastGridPos.col;
            // Detect wrap: column jumps from high to low or low to high
            if (Math.abs(colDiff) > 16) { // More than half the maze width (32/2 = 16)
                isWrap = true;
            }
        }

        // Store position with timestamp, wrap flag, and unicorn status FIRST
        const positionState = {
            ...validatedPosition,
            playerId: playerId,
            timestamp: now,
            isWrap: isWrap, // Flag to help clients handle wrap smoothly
            isUnicorn: isUnicorn // Include unicorn status
        };

        const roomPositions = this.playerPositions.get(roomCode);
        roomPositions.set(playerId, positionState);
        this.lastUpdateTime.set(playerId, now);
        
        // Verify what was actually stored by reading it back
        const verifyStored = roomPositions.get(playerId);
        // console.log(`💾 Stored position for ${playerId}: row=${positionState.row}, col=${positionState.col}`);
        // console.log(`🔎 Verify stored: row=${verifyStored?.row}, col=${verifyStored?.col} (Match: ${verifyStored?.row === positionState.row && verifyStored?.col === positionState.col})`);
        
        // Update last grid position
        if (typeof validatedPosition.row === 'number' && typeof validatedPosition.col === 'number') {
            this.lastGridPositions.set(playerId, { row: validatedPosition.row, col: validatedPosition.col });
        }

        // Grid-based collision detection with PATH checking
        // In HUNT phase: Unicorn tags survivors for instant point steal
        // Check not just the current position, but also cells crossed between old and new positions
        if (io && typeof validatedPosition.row === 'number' && typeof validatedPosition.col === 'number') {
            // Only process collisions during HUNT phase
            const currentPhase = this.getGamePhase(roomCode);
            if (currentPhase !== GAME_PHASE.HUNT) {
                return positionState;
            }

            // Check for coin collection (survivors only)
            this.checkCoinCollection(roomCode, playerId, validatedPosition, io);
            
            // Check for powerup collection (survivors only)
            this.checkPowerupCollection(roomCode, playerId, validatedPosition, io);
            
            // Find the unicorn in this room
            const unicornPlayer = room.players.find(p => p.isUnicorn);
            
            if (unicornPlayer) {
                const unicornPos = this.getPlayerPosition(roomCode, unicornPlayer.id);
                
                // Get the path of cells this player crossed (from old position to new position)
                const oldPos = oldPosition || lastGridPos;
                const newPos = { row: validatedPosition.row, col: validatedPosition.col };
                const pathCells = this.getCellsInPath(oldPos, newPos);
                
                // If this player (who just moved) is a regular player, check if they crossed the unicorn
                if (!isUnicorn && unicornPos) {
                    // Check if any cell in the path matches the unicorn's position
                    const crossedUnicorn = pathCells.some(cell => 
                        cell.row === unicornPos.row && cell.col === unicornPos.col
                    );
                    
                    if (crossedUnicorn || (newPos.row === unicornPos.row && newPos.col === unicornPos.col)) {
                        // Survivor collided with unicorn - they get tagged!
                        this.handleTag(roomCode, unicornPlayer.id, playerId, io);
                    }
                }
                // If unicorn just moved, check if it crossed any other player's position
                else if (isUnicorn) {
                    const caughtPlayer = room.players.find(p => {
                        if (p.id === playerId || p.isUnicorn) return false;
                        
                        const playerPos = this.getPlayerPosition(roomCode, p.id);
                        if (!playerPos) return false;
                        
                        // Check if unicorn's path crossed this player's position
                        const crossedPlayer = pathCells.some(cell => 
                            cell.row === playerPos.row && cell.col === playerPos.col
                        );
                        
                        // Also check direct position match
                        const directMatch = playerPos.row === newPos.row && playerPos.col === newPos.col;
                        
                        return crossedPlayer || directMatch;
                    });
                    
                    if (caughtPlayer) {
                        // Unicorn tagged a survivor!
                        this.handleTag(roomCode, playerId, caughtPlayer.id, io);
                    }
                }
            }
        }

        return positionState;
    }

    /**
     * Validate position data
     * @param {Object} positionData - Position data to validate
     * @returns {Object|null} Validated position or null
     */
    validatePosition(positionData) {
        if (!positionData || typeof positionData.x !== 'number' || typeof positionData.y !== 'number') {
            return null;
        }

        const { x, y, row, col } = positionData;
        const { MIN_X, MAX_X, MIN_Y, MAX_Y } = GAME_CONFIG.POSITION_VALIDATION;

        // For wrap-around positions, don't clamp X values as they may be outside normal range
        // The frontend sends adjusted X values for smooth wrap-around animation
        // Only clamp Y values and validate X is a number
        const validated = {
            x: x, // Preserve X value (may be outside normal range for wrap-around)
            y: Math.max(MIN_Y, Math.min(MAX_Y, y))
        };

        // Preserve row and col if provided (needed for wrap-around detection)
        if (typeof row === 'number') {
            validated.row = row;
        }
        if (typeof col === 'number') {
            validated.col = col;
        }

        return validated;
    }

    /**
     * Get all cells in a path from old position to new position
     * Uses Bresenham's line algorithm to find all cells crossed
     * @param {Object} oldPos - Old position { row, col }
     * @param {Object} newPos - New position { row, col }
     * @returns {Array} Array of cells { row, col } in the path
     */
    getCellsInPath(oldPos, newPos) {
        const cells = [];
        
        if (!oldPos || !newPos) {
            return newPos ? [newPos] : [];
        }
        
        const startRow = oldPos.row;
        const startCol = oldPos.col;
        const endRow = newPos.row;
        const endCol = newPos.col;
        
        // If same position, return just that position
        if (startRow === endRow && startCol === endCol) {
            return [{ row: endRow, col: endCol }];
        }
        
        // Bresenham's line algorithm to get all cells crossed
        let row = startRow;
        let col = startCol;
        const dRow = Math.abs(endRow - startRow);
        const dCol = Math.abs(endCol - startCol);
        const sRow = startRow < endRow ? 1 : -1;
        const sCol = startCol < endCol ? 1 : -1;
        let err = dCol - dRow;
        
        while (true) {
            cells.push({ row, col });
            
            if (row === endRow && col === endCol) break;
            
            const e2 = 2 * err;
            if (e2 > -dRow) {
                err -= dRow;
                col += sCol;
            }
            if (e2 < dCol) {
                err += dCol;
                row += sRow;
            }
        }
        
        return cells;
    }

    /**
     * Check if two positions are adjacent (within 1 cell)
     * @param {Object} pos1 - First position { row, col }
     * @param {Object} pos2 - Second position { row, col }
     * @returns {boolean} True if positions are adjacent
     */
    isAdjacent(pos1, pos2) {
        if (!pos1 || !pos2) return false;
        
        const rowDiff = Math.abs(pos1.row - pos2.row);
        const colDiff = Math.abs(pos1.col - pos2.col);
        
        // Adjacent if within 1 cell in any direction (including diagonal)
        return rowDiff <= 1 && colDiff <= 1 && !(rowDiff === 0 && colDiff === 0);
    }

    /**
     * Get all player positions in a room
     * @param {string} roomCode - Room code
     * @returns {Object} Map of playerId -> position
     */
    getRoomPositions(roomCode) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return {};

        const positions = {};
        roomPositions.forEach((position, playerId) => {
            positions[playerId] = position;
        });

        return positions;
    }

    /**
     * Get position of a specific player
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     * @returns {Object|null} Player position or null
     */
    getPlayerPosition(roomCode, playerId) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return null;

        return roomPositions.get(playerId) || null;
    }

    /**
     * Remove player position (when they leave/disconnect)
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID
     */
    removePlayerPosition(roomCode, playerId) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            roomPositions.delete(playerId);
        }
        this.lastUpdateTime.delete(playerId);
        this.lastGridPositions.delete(playerId);
        
        // Clean up combat state
        this.cleanupPlayerCombatState(playerId);
    }

    /**
     * Get full game state for synchronization
     * @param {string} roomCode - Room code
     * @returns {Object} Complete game state
     */
    getGameState(roomCode) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return null;

        return {
            roomCode: roomCode,
            players: room.players.map(player => ({
                id: player.id,
                name: player.name,
                isUnicorn: player.isUnicorn,
                coins: player.coins,
                position: this.getPlayerPosition(roomCode, player.id)
            })),
            unicornId: room.unicornId,
            leaderboard: roomManager.getLeaderboard(roomCode),
            timestamp: Date.now()
        };
    }

    /**
     * Clear all positions for a room (when game ends)
     * @param {string} roomCode - Room code
     */
    clearRoomState(roomCode) {
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            // Clear all player update times for this room
            roomPositions.forEach((_, playerId) => {
                this.lastUpdateTime.delete(playerId);
                this.lastGridPositions.delete(playerId);
            });
        }
        this.playerPositions.delete(roomCode);
        this.cleanupGameLoop(roomCode);
    }

    /**
     * OLD METHOD - NO LONGER USED
     * Grid-based collision is now handled in updatePlayerPosition()
     * Keeping this for reference/backup
     * 
     * Check for collision between unicorn and other players (PIXEL-BASED - DEPRECATED)
     * @param {string} roomCode - Room code
     * @param {string} unicornId - Unicorn player socket ID
     * @param {Object} unicornPosition - Unicorn position { x, y, row, col }
     * @param {Object} io - Socket.IO server instance for emitting events
     * @returns {Array} Array of caught player IDs
     */
    checkUnicornCollision_OLD_DEPRECATED(roomCode, unicornId, unicornPosition, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return [];

        const roomPositions = this.playerPositions.get(roomCode);
        if (!roomPositions) return [];

        const caughtPlayers = [];
        const collisionRadius = 30; // Collision distance in pixels (adjust as needed)

        // Check collision with all other players
        room.players.forEach(player => {
            if (player.id === unicornId || player.isUnicorn) return; // Skip unicorn itself

            const playerPosition = roomPositions.get(player.id);
            if (!playerPosition) return;

            // Calculate distance between unicorn and player
            // Handle wrap-around: consider both normal and wrapped positions
            const dx = playerPosition.x - unicornPosition.x;
            const dy = playerPosition.y - unicornPosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Check if collision occurred
            if (distance < collisionRadius) {
                caughtPlayers.push(player.id);
                
                // Update scores: Unicorn gets +10, caught player loses -10
                const unicornPlayer = roomManager.updatePlayerCoins(roomCode, unicornId, 10);
                const caughtPlayer = roomManager.updatePlayerCoins(roomCode, player.id, -10);
                
                // console.log(`Unicorn ${unicornId} caught player ${player.id}! Coins: Unicorn +10 (${unicornPlayer?.coins}), Caught -10 (${caughtPlayer?.coins})`);
                
                // Emit score update event to all players in room
                if (io) {
                    const updatedRoom = roomManager.getRoom(roomCode);
                    io.to(roomCode).emit('score_update', {
                        unicornId: unicornId,
                        caughtId: player.id,
                        unicornCoins: unicornPlayer?.coins,
                        caughtCoins: caughtPlayer?.coins,
                        room: updatedRoom,
                        leaderboard: roomManager.getLeaderboard(roomCode)
                    });
                }
            }
        });

        return caughtPlayers;
    }

    /**
     * Find a free spawn position that's not occupied by any player
     * @param {string} roomCode - Room code
     * @param {string} excludePlayerId - Player ID to exclude from collision check
     * @returns {Object} Free spawn position { row, col }
     */
    findFreeSpawnPosition(roomCode, excludePlayerId = null) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return GAME_CONFIG.SPAWN_POSITIONS[0];

        const spawnPositions = GAME_CONFIG.SPAWN_POSITIONS;
        
        // Collect all occupied positions
        const occupiedPositions = new Set();
        for (const player of room.players) {
            if (player.id === excludePlayerId) continue;
            
            const playerPos = this.getPlayerPosition(roomCode, player.id);
            if (playerPos) {
                occupiedPositions.add(`${playerPos.row},${playerPos.col}`);
            }
        }
        
        // Try each spawn position
        for (const spawnPos of spawnPositions) {
            const posKey = `${spawnPos.row},${spawnPos.col}`;
            if (!occupiedPositions.has(posKey)) {
                // console.log(`  ✅ Found free spawn: row=${spawnPos.row}, col=${spawnPos.col}`);
                return spawnPos;
            }
        }
        
        // If all predefined spawns occupied, generate a unique position with offset
        // Use row 1 or 26 corridors with different column offsets
        const fallbackPositions = [
            { row: 1, col: 8 }, { row: 1, col: 12 }, { row: 1, col: 20 }, { row: 1, col: 24 },
            { row: 4, col: 1 }, { row: 4, col: 12 }, { row: 4, col: 19 }, { row: 4, col: 30 },
            { row: 22, col: 8 }, { row: 22, col: 12 }, { row: 22, col: 20 }, { row: 22, col: 24 },
            { row: 26, col: 8 }, { row: 26, col: 12 }, { row: 26, col: 20 }, { row: 26, col: 24 }
        ];
        
        for (const fallbackPos of fallbackPositions) {
            const posKey = `${fallbackPos.row},${fallbackPos.col}`;
            if (!occupiedPositions.has(posKey)) {
                // console.log(`  ✅ Found fallback spawn: row=${fallbackPos.row}, col=${fallbackPos.col}`);
                return fallbackPos;
            }
        }
        
        // Last resort: return a random predefined spawn
        const randomSpawn = spawnPositions[Math.floor(Math.random() * spawnPositions.length)];
        // console.log(`  ⚠️ All spawns occupied, using random: row=${randomSpawn.row}, col=${randomSpawn.col}`);
        return randomSpawn;
    }

    /**
     * Start a quiz when unicorn catches a player
     * @param {string} roomCode - Room code
     * @param {string} unicornId - Unicorn player socket ID
     * @param {string} caughtId - Caught player socket ID
     * @param {Object} io - Socket.IO server instance
     */
    startQuiz(roomCode, unicornId, caughtId, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
            // console.log(`❌ Cannot start quiz: Room ${roomCode} not found`);
            return;
        }

        // Get player names
        const unicornPlayer = room.players.find(p => p.id === unicornId);
        const caughtPlayer = room.players.find(p => p.id === caughtId);
        
        if (!unicornPlayer || !caughtPlayer) {
            // console.log(`❌ Cannot start quiz: Players not found (unicorn=${!!unicornPlayer}, caught=${!!caughtPlayer})`);
            return;
        }

        const unicornName = unicornPlayer.name || 'Unicorn';
        const caughtName = caughtPlayer.name || 'Player';

        // Generate random quiz questions FIRST
        const questions = getRandomQuestions(QUIZ_CONFIG.QUESTIONS_PER_QUIZ);
        
        // Store quiz state
        const quizData = {
            unicornId: unicornId,
            unicornName: unicornName,
            caughtId: caughtId,
            caughtName: caughtName,
            questions: questions,
            startTime: Date.now(),
            timeLimit: QUIZ_CONFIG.TOTAL_TIME_LIMIT,
            answers: [],
            completed: false
        };
        
        this.activeQuizzes.set(roomCode, quizData);

        // console.log(`\n🎯 ===== QUIZ STARTED =====`);
        // console.log(`Room: ${roomCode}`);
        // console.log(`Unicorn: ${unicornName} (${unicornId})`);
        // console.log(`Caught: ${caughtName} (${caughtId})`);
        // console.log(`Questions: ${questions.length}`);
        // console.log(`Time limit: ${QUIZ_CONFIG.TOTAL_TIME_LIMIT}ms`);
        // console.log(`Active quizzes in memory: ${this.activeQuizzes.size}`);
        // console.log(`===========================\n`);

        // 1. FIRST: Mark room as frozen to block position updates
        this.frozenRooms.add(roomCode);
        // console.log(`❄️ Room ${roomCode} frozen - blocking all position updates`);

        // 2. Broadcast game freeze to ALL players
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.GAME_FROZEN, {
            message: `🦄 ${unicornName} caught ${caughtName}!`,
            unicornId: unicornId,
            unicornName: unicornName,
            caughtId: caughtId,
            caughtName: caughtName,
            freezeReason: 'quiz_started'
        });

        // 3. Respawn BOTH unicorn and caught player to separate locations
        // console.log(`\n🔄 Respawning both players to break collision...`);
        
        const roomPositions = this.playerPositions.get(roomCode);
        if (roomPositions) {
            // Find two different free spawn positions
            const unicornSpawn = this.findFreeSpawnPosition(roomCode, caughtId);
            const caughtSpawn = this.findFreeSpawnPosition(roomCode, unicornId);
            
            // Make sure they're different - if same, use adjacent spawn
            const spawnPositions = GAME_CONFIG.SPAWN_POSITIONS;
            let finalCaughtSpawn = caughtSpawn;
            if (unicornSpawn.row === caughtSpawn.row && unicornSpawn.col === caughtSpawn.col) {
                // Find a different spawn
                for (const spawn of spawnPositions) {
                    if (spawn.row !== unicornSpawn.row || spawn.col !== unicornSpawn.col) {
                        finalCaughtSpawn = spawn;
                        break;
                    }
                }
            }
            
            // Respawn unicorn
            const unicornCurrentPos = roomPositions.get(unicornId);
            const newUnicornPos = {
                ...unicornCurrentPos,
                row: unicornSpawn.row,
                col: unicornSpawn.col,
                x: 0,
                y: 0,
                timestamp: Date.now()
            };
            roomPositions.set(unicornId, newUnicornPos);
            this.lastGridPositions.set(unicornId, { row: unicornSpawn.row, col: unicornSpawn.col });
            this.respawnedPlayers.set(unicornId, Date.now());
            
            // Respawn caught player
            const caughtCurrentPos = roomPositions.get(caughtId);
            const newCaughtPos = {
                ...caughtCurrentPos,
                row: finalCaughtSpawn.row,
                col: finalCaughtSpawn.col,
                x: 0,
                y: 0,
                timestamp: Date.now()
            };
            roomPositions.set(caughtId, newCaughtPos);
            this.lastGridPositions.set(caughtId, { row: finalCaughtSpawn.row, col: finalCaughtSpawn.col });
            this.respawnedPlayers.set(caughtId, Date.now());
            
            // console.log(`  Unicorn respawned: row=${unicornSpawn.row}, col=${unicornSpawn.col}`);
            // console.log(`  Caught player respawned: row=${finalCaughtSpawn.row}, col=${finalCaughtSpawn.col}`);
            // console.log(`  🔒 Both positions locked for 500ms to prevent override`);
            
            // Broadcast new positions to all players
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
                playerId: unicornId,
                position: newUnicornPos
            });
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, {
                playerId: caughtId,
                position: newCaughtPos
            });
        }

        // 2. Send quiz questions to the CAUGHT player only
        // Don't send correct answers to client - only question text and options
        const questionsForClient = questions.map(q => ({
            id: q.id,
            question: q.question,
            options: q.options
            // correctAnswer is NOT sent to prevent cheating
        }));

        io.to(caughtId).emit(SOCKET_EVENTS.SERVER.QUIZ_START, {
            questions: questionsForClient,
            totalTimeLimit: QUIZ_CONFIG.TOTAL_TIME_LIMIT,
            timePerQuestion: QUIZ_CONFIG.TIME_PER_QUESTION,
            unicornName: unicornName
        });

        // Clear any existing timeout for this room (prevents stale timeouts)
        if (this.quizTimeouts.has(roomCode)) {
            clearTimeout(this.quizTimeouts.get(roomCode));
            // console.log(`🗑️ Cleared existing quiz timeout for room ${roomCode}`);
        }

        // Set timeout to auto-complete quiz after time limit
        const timeoutId = setTimeout(() => {
            if (this.activeQuizzes.has(roomCode)) {
                const quiz = this.activeQuizzes.get(roomCode);
                if (!quiz.completed) {
                    // console.log(`⏰ Quiz timeout in room ${roomCode} (${QUIZ_CONFIG.TOTAL_TIME_LIMIT}ms elapsed)`);
                    this.completeQuiz(roomCode, io, true); // true = timeout
                }
            }
            // Clean up timeout reference
            this.quizTimeouts.delete(roomCode);
        }, QUIZ_CONFIG.TOTAL_TIME_LIMIT);
        
        // Store timeout ID so we can clear it later
        this.quizTimeouts.set(roomCode, timeoutId);
        // console.log(`⏱️ Quiz timeout set for ${QUIZ_CONFIG.TOTAL_TIME_LIMIT}ms (${QUIZ_CONFIG.TOTAL_TIME_LIMIT / 1000}s)`);
    }

    /**
     * Submit an answer to the quiz
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player socket ID (must be caught player)
     * @param {number} questionId - Question ID
     * @param {number} answerIndex - Selected answer index
     * @returns {Object|null} Result or null
     */
    submitQuizAnswer(roomCode, playerId, questionId, answerIndex) {
        const quiz = this.activeQuizzes.get(roomCode);
        
        if (!quiz) {
            // console.log('No active quiz found');
            return null;
        }

        // Verify this is the caught player
        if (playerId !== quiz.caughtId) {
            // console.log('Only caught player can answer');
            return null;
        }

        // Find the question
        const question = quiz.questions.find(q => q.id === questionId);
        if (!question) {
            // console.log('Question not found');
            return null;
        }

        // Check if already answered
        const alreadyAnswered = quiz.answers.find(a => a.questionId === questionId);
        if (alreadyAnswered) {
            // console.log('Question already answered');
            return null;
        }

        // Record the answer
        const isCorrect = answerIndex === question.correctAnswer;
        quiz.answers.push({
            questionId: questionId,
            answerIndex: answerIndex,
            isCorrect: isCorrect,
            timestamp: Date.now()
        });

        // console.log(`Answer recorded: Q${questionId}, Answer: ${answerIndex}, Correct: ${isCorrect}`);

        return {
            questionId: questionId,
            isCorrect: isCorrect,
            totalAnswered: quiz.answers.length,
            totalQuestions: quiz.questions.length
        };
    }

    /**
     * Complete the quiz and unfreeze the game
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     * @param {boolean} isTimeout - Whether quiz ended due to timeout
     */
    completeQuiz(roomCode, io, isTimeout = false) {
        // console.log(`\n🏁 completeQuiz() called for room ${roomCode}, timeout=${isTimeout}`);
        
        const quiz = this.activeQuizzes.get(roomCode);
        
        if (!quiz) {
            // console.log(`❌ No active quiz found for room ${roomCode}`);
            return;
        }
        
        if (quiz.completed) {
            // console.log(`⚠️ Quiz already completed for room ${roomCode}`);
            return;
        }

        // Clear the timeout since quiz is completing (prevents double-completion)
        if (this.quizTimeouts.has(roomCode)) {
            clearTimeout(this.quizTimeouts.get(roomCode));
            this.quizTimeouts.delete(roomCode);
            // console.log(`🗑️ Cleared quiz timeout for room ${roomCode}`);
        }

        quiz.completed = true;
        const room = roomManager.getRoom(roomCode);
        
        if (!room) {
            // console.log(`❌ Room ${roomCode} not found, deleting quiz`);
            this.activeQuizzes.delete(roomCode);
            return;
        }

        // Calculate results
        const totalQuestions = quiz.questions.length;
        const correctAnswers = quiz.answers.filter(a => a.isCorrect).length;
        const scorePercentage = Math.round((correctAnswers / totalQuestions) * 100);
        const timeTaken = Date.now() - quiz.startTime;

        // console.log(`\n📊 ===== QUIZ COMPLETED =====`);
        // console.log(`Room: ${roomCode}`);
        // console.log(`Caught Player: ${quiz.caughtName}`);
        // console.log(`Score: ${correctAnswers}/${totalQuestions} (${scorePercentage}%)`);
        // console.log(`Time taken: ${timeTaken}ms`);
        // console.log(`Timeout: ${isTimeout}`);

        // Determine winner: Caught player wins if they pass (scorePercentage >= 60%)
        // Otherwise, unicorn wins (including timeout cases)
        const PASS_THRESHOLD = 60;
        const caughtPlayerWins = scorePercentage >= PASS_THRESHOLD && !isTimeout;

        if (caughtPlayerWins) {
            // // Caught player WINS - they escape and become unicorn!
            // console.log(`\n🎉 ${quiz.caughtName} WINS! (Score: ${scorePercentage}%)`);
            // console.log(`  → Caught player gets +20 coins`);
            // console.log(`  → Unicorn loses -20 coins`);
            // console.log(`  → Unicorn status transferred to ${quiz.caughtName}`);
            
            // Update coins: Winner +20, Loser -20
            const updatedCaughtPlayer = roomManager.updatePlayerCoins(roomCode, quiz.caughtId, 20);
            const updatedUnicorn = roomManager.updatePlayerCoins(roomCode, quiz.unicornId, -20);
            
            // Transfer unicorn status to caught player
            roomManager.transferUnicorn(roomCode, quiz.caughtId);
            
            // Emit score update to notify all players
            const updatedRoom = roomManager.getRoom(roomCode);
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SCORE_UPDATE, {
                unicornId: quiz.caughtId, // New unicorn
                caughtId: quiz.unicornId, // Old unicorn
                unicornCoins: updatedCaughtPlayer?.coins,
                caughtCoins: updatedUnicorn?.coins,
                room: updatedRoom,
                leaderboard: roomManager.getLeaderboard(roomCode)
            });
            
            // Emit unicorn transfer event
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, {
                newUnicornId: quiz.caughtId,
                oldUnicornId: quiz.unicornId,
                room: updatedRoom
            });
        } else {
            // Unicorn WINS - caught player failed or timed out
            // console.log(`\n🦄 ${quiz.unicornName} WINS! (Caught player score: ${scorePercentage}%${isTimeout ? ', TIMEOUT' : ''})`);
            // console.log(`  → Unicorn gets +20 coins`);
            // console.log(`  → Caught player loses -20 coins`);
            // console.log(`  → Unicorn remains unicorn`);
            
            // Update coins: Winner +20, Loser -20
            const updatedUnicorn = roomManager.updatePlayerCoins(roomCode, quiz.unicornId, 20);
            const updatedCaughtPlayer = roomManager.updatePlayerCoins(roomCode, quiz.caughtId, -20);
            
            // Emit score update to notify all players
            const updatedRoom = roomManager.getRoom(roomCode);
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SCORE_UPDATE, {
                unicornId: quiz.unicornId, // Unicorn remains
                caughtId: quiz.caughtId,
                unicornCoins: updatedUnicorn?.coins,
                caughtCoins: updatedCaughtPlayer?.coins,
                room: updatedRoom,
                leaderboard: roomManager.getLeaderboard(roomCode)
            });
        }

        // Emit quiz completion to ALL players
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

        // Unfreeze the room - allow position updates again
        this.frozenRooms.delete(roomCode);
        // console.log(`🔓 Room ${roomCode} unfrozen - position updates enabled`);

        // Clean up quiz state
        // console.log(`🗑️ Deleting quiz from activeQuizzes Map...`);
        this.activeQuizzes.delete(roomCode);
        // console.log(`✅ Quiz deleted! Active quizzes remaining: ${this.activeQuizzes.size}`);
        // console.log(`Game unfrozen in room ${roomCode}`);
        // console.log(`============================\n`);
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
     * Check if a room has an active quiz
     * @param {string} roomCode - Room code
     * @returns {boolean} True if quiz is active
     */
    hasActiveQuiz(roomCode) {
        return this.activeQuizzes.has(roomCode);
    }

    /**
     * Clear quiz state for a room (used when game starts/restarts)
     * @param {string} roomCode - Room code
     */
    clearQuizState(roomCode) {
        // Clear any pending quiz timeout
        if (this.quizTimeouts.has(roomCode)) {
            clearTimeout(this.quizTimeouts.get(roomCode));
            this.quizTimeouts.delete(roomCode);
            // console.log(`🗑️ Cleared quiz timeout for room ${roomCode}`);
        }
        
        if (this.activeQuizzes.has(roomCode)) {
            // console.log(`🗑️ Clearing stale quiz state for room ${roomCode}`);
            this.activeQuizzes.delete(roomCode);
        }
        // Also unfreeze the room
        if (this.frozenRooms.has(roomCode)) {
            // console.log(`🔓 Unfreezing room ${roomCode}`);
            this.frozenRooms.delete(roomCode);
        }
    }

    // ========== COIN SYSTEM METHODS ==========

    /**
     * Initialize coins for a room at Hunt start
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     */
    initializeCoins(roomCode, io) {
        // console.log(`\n💰 ===== INITIALIZING COINS =====`);
        // console.log(`Room: ${roomCode}`);

        // Create coin map for this room
        const coinMap = new Map();
        
        // Shuffle spawn slots and pick initial coins
        const shuffledSlots = [...COIN_CONFIG.SPAWN_SLOTS].sort(() => Math.random() - 0.5);
        const initialCoins = shuffledSlots.slice(0, COIN_CONFIG.INITIAL_SPAWN_COUNT);
        
        initialCoins.forEach((slot, index) => {
            const coinId = `coin_${index}`;
            coinMap.set(coinId, {
                id: coinId,
                row: slot.row,
                col: slot.col,
                collected: false,
                respawnTimeoutId: null
            });
        });

        this.roomCoins.set(roomCode, coinMap);

        // console.log(`Spawned ${initialCoins.length} coins`);
        // console.log(`=================================\n`);

        // Notify clients of initial coins
        const coinsData = Array.from(coinMap.values()).map(coin => ({
            id: coin.id,
            row: coin.row,
            col: coin.col
        }));

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.COIN_SPAWNED, {
            coins: coinsData
        });
    }

    /**
     * Check if a player is near a coin and can collect it
     * Called from position update
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} position - Player position { row, col }
     * @param {Object} io - Socket.IO server instance
     */
    checkCoinCollection(roomCode, playerId, position, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return;

        // Unicorns cannot collect coins
        if (player.isUnicorn) return;

        const coinMap = this.roomCoins.get(roomCode);
        if (!coinMap) return;

        // Check each coin
        coinMap.forEach((coin, coinId) => {
            if (coin.collected) return;

            // Check if player is within collection radius
            const rowDiff = Math.abs(position.row - coin.row);
            const colDiff = Math.abs(position.col - coin.col);
            
            if (rowDiff <= COIN_CONFIG.COLLECTION_RADIUS && colDiff <= COIN_CONFIG.COLLECTION_RADIUS) {
                this.collectCoin(roomCode, playerId, coinId, io);
            }
        });
    }

    /**
     * Collect a coin with race condition prevention
     * Uses locks to ensure only one player can collect a coin at a time
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} coinId - Coin ID
     * @param {Object} io - Socket.IO server instance
     * @returns {boolean} True if collection was successful
     */
    collectCoin(roomCode, playerId, coinId, io) {
        const lockKey = `${roomCode}:${coinId}`;
        
        // Check if coin is already being processed (race condition prevention)
        if (this.coinLocks.has(lockKey)) {
            // console.log(`🔒 Coin ${coinId} already being collected by another player`);
            return false;
        }

        const coinMap = this.roomCoins.get(roomCode);
        if (!coinMap) return false;

        const coin = coinMap.get(coinId);
        if (!coin || coin.collected) return false;

        const room = roomManager.getRoom(roomCode);
        const player = room?.players.find(p => p.id === playerId);
        if (!player) return false;

        // Acquire lock - first player to get here wins
        this.coinLocks.set(lockKey, playerId);

        try {
            // Double-check coin isn't collected (belt and suspenders)
            if (coin.collected) {
                return false;
            }

            // Mark coin as collected
            coin.collected = true;

            // Award score to player
            roomManager.updatePlayerCoins(roomCode, playerId, COIN_CONFIG.VALUE);
            const updatedPlayer = roomManager.getPlayer(roomCode, playerId);

            // console.log(`💰 ${player.name} collected coin! +${COIN_CONFIG.VALUE} score (total: ${updatedPlayer.coins})`);

            // Notify clients
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.COIN_COLLECTED, {
                coinId: coinId,
                playerId: playerId,
                playerName: player.name,
                value: COIN_CONFIG.VALUE,
                newScore: updatedPlayer.coins,
                leaderboard: roomManager.getLeaderboard(roomCode)
            });

            // Schedule respawn
            coin.respawnTimeoutId = setTimeout(() => {
                this.respawnCoin(roomCode, coinId, io);
            }, COIN_CONFIG.RESPAWN_TIME);

            return true;
        } finally {
            // Always release lock
            this.coinLocks.delete(lockKey);
        }
    }

    /**
     * Respawn a coin after collection
     * @param {string} roomCode - Room code
     * @param {string} coinId - Coin ID
     * @param {Object} io - Socket.IO server instance
     */
    respawnCoin(roomCode, coinId, io) {
        const coinMap = this.roomCoins.get(roomCode);
        if (!coinMap) return;

        const coin = coinMap.get(coinId);
        if (!coin) return;

        // Find a new spawn position that's not occupied
        const usedPositions = new Set();
        coinMap.forEach(c => {
            if (!c.collected) {
                usedPositions.add(`${c.row},${c.col}`);
            }
        });

        // Find available spawn slot
        const availableSlots = COIN_CONFIG.SPAWN_SLOTS.filter(
            slot => !usedPositions.has(`${slot.row},${slot.col}`)
        );

        if (availableSlots.length === 0) {
            // No available slots, keep same position
            coin.collected = false;
        } else {
            // Pick random available slot
            const newSlot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
            coin.row = newSlot.row;
            coin.col = newSlot.col;
            coin.collected = false;
        }

        coin.respawnTimeoutId = null;

        // console.log(`💰 Coin ${coinId} respawned at (${coin.row}, ${coin.col})`);

        // Notify clients
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.COIN_SPAWNED, {
            coinId: coinId,
            row: coin.row,
            col: coin.col
        });
    }

    /**
     * Get all active coins in a room
     * @param {string} roomCode - Room code
     * @returns {Array} Array of coin objects
     */
    getActiveCoins(roomCode) {
        const coinMap = this.roomCoins.get(roomCode);
        if (!coinMap) return [];

        return Array.from(coinMap.values())
            .filter(coin => !coin.collected)
            .map(coin => ({
                id: coin.id,
                row: coin.row,
                col: coin.col
            }));
    }

    /**
     * Clean up coins for a room
     * @param {string} roomCode - Room code
     */
    cleanupCoins(roomCode) {
        const coinMap = this.roomCoins.get(roomCode);
        if (coinMap) {
            // Clear all respawn timers
            coinMap.forEach(coin => {
                if (coin.respawnTimeoutId) {
                    clearTimeout(coin.respawnTimeoutId);
                }
            });
        }
        this.roomCoins.delete(roomCode);
    }

    // ========== POWERUP SYSTEM METHODS ==========

    /**
     * Start spawning powerups for a room
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     */
    startPowerupSpawning(roomCode, io) {
        // console.log(`⚡ Starting powerup spawning for room ${roomCode}`);
        
        // Initialize powerup map
        this.roomPowerups.set(roomCode, new Map());
        
        // Schedule first powerup spawn
        this.schedulePowerupSpawn(roomCode, io);
    }

    /**
     * Schedule next powerup spawn
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     */
    schedulePowerupSpawn(roomCode, io) {
        // Clear existing timer
        if (this.powerupSpawnTimers.has(roomCode)) {
            clearTimeout(this.powerupSpawnTimers.get(roomCode));
        }

        // Random interval between min and max
        const interval = POWERUP_CONFIG.SPAWN_INTERVAL_MIN + 
            Math.random() * (POWERUP_CONFIG.SPAWN_INTERVAL_MAX - POWERUP_CONFIG.SPAWN_INTERVAL_MIN);

        const timeoutId = setTimeout(() => {
            this.spawnPowerup(roomCode, io);
        }, interval);

        this.powerupSpawnTimers.set(roomCode, timeoutId);
    }

    /**
     * Spawn a powerup
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server instance
     */
    spawnPowerup(roomCode, io) {
        // Check if we're still in Hunt phase
        if (this.getGamePhase(roomCode) !== GAME_PHASE.HUNT) {
            return;
        }

        const powerupMap = this.roomPowerups.get(roomCode);
        if (!powerupMap) return;

        // Check if max powerups already on map
        const activePowerups = Array.from(powerupMap.values()).filter(p => !p.collected);
        if (activePowerups.length >= POWERUP_CONFIG.MAX_POWERUPS) {
            // Schedule next spawn check
            this.schedulePowerupSpawn(roomCode, io);
            return;
        }

        // Find available spawn slot
        const usedPositions = new Set();
        powerupMap.forEach(p => {
            if (!p.collected) {
                usedPositions.add(`${p.row},${p.col}`);
            }
        });

        const availableSlots = POWERUP_CONFIG.SPAWN_SLOTS.filter(
            slot => !usedPositions.has(`${slot.row},${slot.col}`)
        );

        if (availableSlots.length === 0) {
            this.schedulePowerupSpawn(roomCode, io);
            return;
        }

        // Pick random slot
        const slot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
        
        // Create powerup
        const powerupId = `powerup_${Date.now()}`;
        const powerup = {
            id: powerupId,
            row: slot.row,
            col: slot.col,
            type: 'immunity', // Currently only type
            collected: false
        };

        powerupMap.set(powerupId, powerup);

        // console.log(`⚡ Powerup spawned at (${slot.row}, ${slot.col})`);

        // Notify clients
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.POWERUP_SPAWNED, {
            id: powerupId,
            row: slot.row,
            col: slot.col,
            type: 'immunity'
        });

        // Schedule next spawn
        this.schedulePowerupSpawn(roomCode, io);
    }

    /**
     * Check if a player is near a powerup and can collect it
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {Object} position - Player position { row, col }
     * @param {Object} io - Socket.IO server instance
     */
    checkPowerupCollection(roomCode, playerId, position, io) {
        const room = roomManager.getRoom(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === playerId);
        if (!player) return;

        // Unicorns cannot collect powerups
        if (player.isUnicorn) return;

        const powerupMap = this.roomPowerups.get(roomCode);
        if (!powerupMap) return;

        // Check each powerup
        powerupMap.forEach((powerup, powerupId) => {
            if (powerup.collected) return;

            // Check if player is within collection radius
            const rowDiff = Math.abs(position.row - powerup.row);
            const colDiff = Math.abs(position.col - powerup.col);
            
            if (rowDiff <= POWERUP_CONFIG.COLLECTION_RADIUS && colDiff <= POWERUP_CONFIG.COLLECTION_RADIUS) {
                this.collectPowerup(roomCode, playerId, powerupId, io);
            }
        });
    }

    /**
     * Collect a powerup with race condition prevention
     * Uses locks to ensure only one player can collect a powerup at a time
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} powerupId - Powerup ID
     * @param {Object} io - Socket.IO server instance
     * @returns {boolean} True if collection was successful
     */
    collectPowerup(roomCode, playerId, powerupId, io) {
        const lockKey = `${roomCode}:${powerupId}`;
        
        // Check if powerup is already being processed (race condition prevention)
        if (this.powerupLocks.has(lockKey)) {
            // console.log(`🔒 Powerup ${powerupId} already being collected by another player`);
            return false;
        }

        const powerupMap = this.roomPowerups.get(roomCode);
        if (!powerupMap) return false;

        const powerup = powerupMap.get(powerupId);
        if (!powerup || powerup.collected) return false;

        const room = roomManager.getRoom(roomCode);
        const player = room?.players.find(p => p.id === playerId);
        if (!player) return false;

        // Acquire lock - first player to get here wins
        this.powerupLocks.set(lockKey, playerId);

        try {
            // Double-check powerup isn't collected
            if (powerup.collected) {
                return false;
            }

            // Mark as collected
            powerup.collected = true;

            // console.log(`⚡ ${player.name} collected ${powerup.type} powerup!`);

            // Notify clients of collection
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.POWERUP_COLLECTED, {
                powerupId: powerupId,
                playerId: playerId,
                playerName: player.name,
                type: powerup.type,
                row: powerup.row,    // Always include these
                col: powerup.col      // for client fallback
            });

            // Activate the powerup effect
            this.activatePowerup(roomCode, playerId, powerup.type, io);

            // Remove powerup from map after short delay
            // setTimeout(() => {
                powerupMap.delete(powerupId);
            // }, 100);

            return true;
        } finally {
            // Always release lock
            this.powerupLocks.delete(lockKey);
        }
    }

    /**
     * Activate a powerup effect
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} type - Powerup type
     * @param {Object} io - Socket.IO server instance
     */
    activatePowerup(roomCode, playerId, type, io) {
        const room = roomManager.getRoom(roomCode);
        const player = room?.players.find(p => p.id === playerId);
        if (!player) return;

        if (type === 'immunity') {
            const duration = POWERUP_CONFIG.TYPES.IMMUNITY.duration;

            // Clear any existing immunity
            const existingImmunity = this.playerImmunity.get(playerId);
            if (existingImmunity?.timeoutId) {
                clearTimeout(existingImmunity.timeoutId);
            }

            // Set immunity
            roomManager.setPlayerImmunity(roomCode, playerId, true);

            // console.log(`🛡️ ${player.name} is now IMMUNE for ${duration}ms`);

            // Notify clients
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.POWERUP_ACTIVATED, {
                playerId: playerId,
                playerName: player.name,
                type: 'immunity',
                duration: duration,
                visual: POWERUP_CONFIG.TYPES.IMMUNITY.visual
            });

            // Set expiration timer
            const timeoutId = setTimeout(() => {
                this.expirePowerup(roomCode, playerId, 'immunity', io);
            }, duration);

            this.playerImmunity.set(playerId, {
                endTime: Date.now() + duration,
                timeoutId: timeoutId
            });
        }
    }

    /**
     * Expire a powerup effect
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} type - Powerup type
     * @param {Object} io - Socket.IO server instance
     */
    expirePowerup(roomCode, playerId, type, io) {
        const room = roomManager.getRoom(roomCode);
        const player = room?.players.find(p => p.id === playerId);

        if (type === 'immunity') {
            // Remove immunity
            roomManager.setPlayerImmunity(roomCode, playerId, false);
            this.playerImmunity.delete(playerId);

            // console.log(`🛡️ ${player?.name || playerId}'s immunity expired`);

            // Notify clients
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.POWERUP_EXPIRED, {
                playerId: playerId,
                playerName: player?.name || 'Unknown',
                type: 'immunity'
            });
        }
    }

    /**
     * Get all active powerups in a room
     * @param {string} roomCode - Room code
     * @returns {Array} Array of powerup objects
     */
    getActivePowerups(roomCode) {
        const powerupMap = this.roomPowerups.get(roomCode);
        if (!powerupMap) return [];

        return Array.from(powerupMap.values())
            .filter(powerup => !powerup.collected)
            .map(powerup => ({
                id: powerup.id,
                row: powerup.row,
                col: powerup.col,
                type: powerup.type
            }));
    }

    /**
     * Clean up powerups for a room
     * @param {string} roomCode - Room code
     */
    cleanupPowerups(roomCode) {
        // Clear spawn timer
        const timerId = this.powerupSpawnTimers.get(roomCode);
        if (timerId) {
            clearTimeout(timerId);
            this.powerupSpawnTimers.delete(roomCode);
        }

        // Clear powerup map
        this.roomPowerups.delete(roomCode);

        // NEW: Clear any active locks for this room
        for (const lockKey of this.powerupLocks.keys()) {
            if (lockKey.startsWith(`${roomCode}:`)) {
                this.powerupLocks.delete(lockKey);
            }
        }
    }

    /**
     * Clean up player's immunity effect
     * @param {string} playerId - Player ID
     */
    cleanupPlayerImmunity(playerId) {
        const immunity = this.playerImmunity.get(playerId);
        if (immunity?.timeoutId) {
            clearTimeout(immunity.timeoutId);
        }
        this.playerImmunity.delete(playerId);
    }

    /**
     * Clean up all coin/powerup state for a room
     * @param {string} roomCode - Room code
     */
    cleanupMapInteractions(roomCode) {
        this.cleanupCoins(roomCode);
        this.cleanupPowerups(roomCode);
    }
}

// Export singleton instance
export default new GameStateManager();
