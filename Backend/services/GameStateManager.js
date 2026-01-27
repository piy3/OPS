/**
 * Game State Management Service
 * Handles player positions and game state synchronization
 */

import roomManager from './RoomManager.js';
import { GAME_CONFIG, SOCKET_EVENTS } from '../config/constants.js';
import { getRandomQuestions, QUIZ_CONFIG } from '../config/questions.js';

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
                console.log(`✓ Player ${player.id} already has position, skipping init`);
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
                console.log(`⚠️ Using fallback spawn position for player ${player.id}`);
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

            console.log(`🎬 Initializing player ${player.id} at spawn: row=${spawnPos.row}, col=${spawnPos.col}`);
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
        // Check not just the current position, but also cells crossed between old and new positions
        // Game freeze prevents multiple simultaneous quizzes, so no need to check hasActiveQuiz
        if (io && typeof validatedPosition.row === 'number' && typeof validatedPosition.col === 'number') {
            // console.log(`\n🔍 COLLISION CHECK for ${playerId} at row=${validatedPosition.row}, col=${validatedPosition.col}`);
            
            // Find the unicorn in this room
            const unicornPlayer = room.players.find(p => p.isUnicorn);
            // console.log(`  Unicorn player: ${unicornPlayer ? unicornPlayer.name : 'NONE FOUND!'}`);
            // console.log(`  Current player isUnicorn: ${isUnicorn}`);
            
            if (unicornPlayer) {
                const unicornPos = this.getPlayerPosition(roomCode, unicornPlayer.id);
                // console.log(`  Unicorn position: row=${unicornPos?.row}, col=${unicornPos?.col}`);
                
                // Check ALL other players against current position
                // console.log(`  Checking all players in room:`);
                // room.players.forEach(p => {
                //     const pos = this.getPlayerPosition(roomCode, p.id);
                //     console.log(`    ${p.name} (unicorn=${p.isUnicorn}): row=${pos?.row}, col=${pos?.col}`);
                // });
                
                // Get the path of cells this player crossed (from old position to new position)
                const oldPos = oldPosition || lastGridPos;
                const newPos = { row: validatedPosition.row, col: validatedPosition.col };
                const pathCells = this.getCellsInPath(oldPos, newPos);
                // console.log(`  Path crossed: ${pathCells.map(c => `(${c.row},${c.col})`).join(' -> ')}`);
                
                // If this player (who just moved) is a regular player, check if they crossed the unicorn
                if (!isUnicorn && unicornPos) {
                    // Check if any cell in the path matches the unicorn's position
                    const crossedUnicorn = pathCells.some(cell => 
                        cell.row === unicornPos.row && cell.col === unicornPos.col
                    );
                    
                    // Also check proximity (adjacent cells) for near-miss collision
                    const isAdjacent = this.isAdjacent(newPos, unicornPos);
                    
                    if (crossedUnicorn || (newPos.row === unicornPos.row && newPos.col === unicornPos.col)) {
                    //     console.log(`\n🦄 ✅ COLLISION DETECTED: Player crossed unicorn path!`);
                    //     console.log(`  Player path: ${pathCells.map(c => `(${c.row},${c.col})`).join(' -> ')}`);
                    //     console.log(`  Unicorn at: row=${unicornPos.row}, col=${unicornPos.col}`);
                        this.startQuiz(roomCode, unicornPlayer.id, playerId, io);
                    } else {
                        // console.log(`  Regular player moved, did not cross unicorn position`);
                    }
                }
                // If unicorn just moved, check if it crossed any other player's position
                else if (isUnicorn) {
                    // console.log(`  Unicorn moved, checking for crossed players...`);
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
                        
                        // console.log(`    Checking ${p.name}: pos=(${playerPos?.row},${playerPos?.col}), crossed=${crossedPlayer}, direct=${directMatch}`);
                        return crossedPlayer || directMatch;
                    });
                    
                    if (caughtPlayer) {
                        // const caughtPos = this.getPlayerPosition(roomCode, caughtPlayer.id);
                        // console.log(`\n🦄 ✅ COLLISION DETECTED: Unicorn crossed player!`);
                        // console.log(`  Unicorn path: ${pathCells.map(c => `(${c.row},${c.col})`).join(' -> ')}`);
                        // console.log(`  Player ${caughtPlayer.name} at: row=${caughtPos?.row}, col=${caughtPos?.col}`);
                        
                        this.startQuiz(roomCode, playerId, caughtPlayer.id, io);
                    } else {
                        // console.log(`  No collision found with any player`);
                    }
                }
            } else {
                // console.log(`  ⚠️ WARNING: No unicorn found in room!`);
            }
            // console.log(`🔍 End collision check\n`);
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
            console.log(`❌ Cannot start quiz: Room ${roomCode} not found`);
            return;
        }

        // Get player names
        const unicornPlayer = room.players.find(p => p.id === unicornId);
        const caughtPlayer = room.players.find(p => p.id === caughtId);
        
        if (!unicornPlayer || !caughtPlayer) {
            console.log(`❌ Cannot start quiz: Players not found (unicorn=${!!unicornPlayer}, caught=${!!caughtPlayer})`);
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

        console.log(`\n🎯 ===== QUIZ STARTED =====`);
        console.log(`Room: ${roomCode}`);
        console.log(`Unicorn: ${unicornName} (${unicornId})`);
        console.log(`Caught: ${caughtName} (${caughtId})`);
        console.log(`Questions: ${questions.length}`);
        console.log(`Time limit: ${QUIZ_CONFIG.TOTAL_TIME_LIMIT}ms`);
        console.log(`Active quizzes in memory: ${this.activeQuizzes.size}`);
        console.log(`===========================\n`);

        // 1. FIRST: Mark room as frozen to block position updates
        this.frozenRooms.add(roomCode);
        console.log(`❄️ Room ${roomCode} frozen - blocking all position updates`);

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
            console.log(`🗑️ Cleared existing quiz timeout for room ${roomCode}`);
        }

        // Set timeout to auto-complete quiz after time limit
        const timeoutId = setTimeout(() => {
            if (this.activeQuizzes.has(roomCode)) {
                const quiz = this.activeQuizzes.get(roomCode);
                if (!quiz.completed) {
                    console.log(`⏰ Quiz timeout in room ${roomCode} (${QUIZ_CONFIG.TOTAL_TIME_LIMIT}ms elapsed)`);
                    this.completeQuiz(roomCode, io, true); // true = timeout
                }
            }
            // Clean up timeout reference
            this.quizTimeouts.delete(roomCode);
        }, QUIZ_CONFIG.TOTAL_TIME_LIMIT);
        
        // Store timeout ID so we can clear it later
        this.quizTimeouts.set(roomCode, timeoutId);
        console.log(`⏱️ Quiz timeout set for ${QUIZ_CONFIG.TOTAL_TIME_LIMIT}ms (${QUIZ_CONFIG.TOTAL_TIME_LIMIT / 1000}s)`);
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
            console.log('No active quiz found');
            return null;
        }

        // Verify this is the caught player
        if (playerId !== quiz.caughtId) {
            console.log('Only caught player can answer');
            return null;
        }

        // Find the question
        const question = quiz.questions.find(q => q.id === questionId);
        if (!question) {
            console.log('Question not found');
            return null;
        }

        // Check if already answered
        const alreadyAnswered = quiz.answers.find(a => a.questionId === questionId);
        if (alreadyAnswered) {
            console.log('Question already answered');
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

        console.log(`Answer recorded: Q${questionId}, Answer: ${answerIndex}, Correct: ${isCorrect}`);

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
        console.log(`\n🏁 completeQuiz() called for room ${roomCode}, timeout=${isTimeout}`);
        
        const quiz = this.activeQuizzes.get(roomCode);
        
        if (!quiz) {
            console.log(`❌ No active quiz found for room ${roomCode}`);
            return;
        }
        
        if (quiz.completed) {
            console.log(`⚠️ Quiz already completed for room ${roomCode}`);
            return;
        }

        // Clear the timeout since quiz is completing (prevents double-completion)
        if (this.quizTimeouts.has(roomCode)) {
            clearTimeout(this.quizTimeouts.get(roomCode));
            this.quizTimeouts.delete(roomCode);
            console.log(`🗑️ Cleared quiz timeout for room ${roomCode}`);
        }

        quiz.completed = true;
        const room = roomManager.getRoom(roomCode);
        
        if (!room) {
            console.log(`❌ Room ${roomCode} not found, deleting quiz`);
            this.activeQuizzes.delete(roomCode);
            return;
        }

        // Calculate results
        const totalQuestions = quiz.questions.length;
        const correctAnswers = quiz.answers.filter(a => a.isCorrect).length;
        const scorePercentage = Math.round((correctAnswers / totalQuestions) * 100);
        const timeTaken = Date.now() - quiz.startTime;

        console.log(`\n📊 ===== QUIZ COMPLETED =====`);
        console.log(`Room: ${roomCode}`);
        console.log(`Caught Player: ${quiz.caughtName}`);
        console.log(`Score: ${correctAnswers}/${totalQuestions} (${scorePercentage}%)`);
        console.log(`Time taken: ${timeTaken}ms`);
        console.log(`Timeout: ${isTimeout}`);

        // Determine winner: Caught player wins if they pass (scorePercentage >= 60%)
        // Otherwise, unicorn wins (including timeout cases)
        const PASS_THRESHOLD = 60;
        const caughtPlayerWins = scorePercentage >= PASS_THRESHOLD && !isTimeout;

        if (caughtPlayerWins) {
            // Caught player WINS - they escape and become unicorn!
            console.log(`\n🎉 ${quiz.caughtName} WINS! (Score: ${scorePercentage}%)`);
            console.log(`  → Caught player gets +20 coins`);
            console.log(`  → Unicorn loses -20 coins`);
            console.log(`  → Unicorn status transferred to ${quiz.caughtName}`);
            
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
            console.log(`\n🦄 ${quiz.unicornName} WINS! (Caught player score: ${scorePercentage}%${isTimeout ? ', TIMEOUT' : ''})`);
            console.log(`  → Unicorn gets +20 coins`);
            console.log(`  → Caught player loses -20 coins`);
            console.log(`  → Unicorn remains unicorn`);
            
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
        console.log(`🔓 Room ${roomCode} unfrozen - position updates enabled`);

        // Clean up quiz state
        console.log(`🗑️ Deleting quiz from activeQuizzes Map...`);
        this.activeQuizzes.delete(roomCode);
        console.log(`✅ Quiz deleted! Active quizzes remaining: ${this.activeQuizzes.size}`);
        console.log(`Game unfrozen in room ${roomCode}`);
        console.log(`============================\n`);
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
            console.log(`🗑️ Cleared quiz timeout for room ${roomCode}`);
        }
        
        if (this.activeQuizzes.has(roomCode)) {
            console.log(`🗑️ Clearing stale quiz state for room ${roomCode}`);
            this.activeQuizzes.delete(roomCode);
        }
        // Also unfreeze the room
        if (this.frozenRooms.has(roomCode)) {
            console.log(`🔓 Unfreezing room ${roomCode}`);
            this.frozenRooms.delete(roomCode);
        }
    }
}

// Export singleton instance
export default new GameStateManager();
