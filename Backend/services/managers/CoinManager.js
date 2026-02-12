/**
 * Coin Manager
 * Handles coin spawning, collection, and respawning
 */

import { SOCKET_EVENTS, COIN_CONFIG } from '../../config/constants.js';
import log from '../../utils/logger.js';
import { getOccupiedSpawnPositions } from '../occupiedSpawnPositions.js';

class CoinManager {
    constructor() {
        // Track coins in each room: roomCode -> Map<coinId, { row, col, collected, respawnTimeoutId }>
        this.roomCoins = new Map();
        
        // Track coin pickup locks: `roomCode:coinId` -> playerId (race condition prevention)
        this.coinLocks = new Map();
        
        // Store mapConfig per room for respawn filtering
        this.roomMapConfigs = new Map();
    }
        /**
     * Check if slot is at least n blocks (Chebyshev) away from all positions
     * @param {{ row: number, col: number }} slot
     * @param {Array<{ row: number, col: number }>} positions
     * @param {number} n
     * @returns {boolean}
     */
        _isAtLeastNApart(slot, positions, n) {
            for (const pos of positions) {
                const dr = Math.abs(slot.row - pos.row);
                const dc = Math.abs(slot.col - pos.col);
                if (Math.max(dr, dc) < n) return false;
            }
            return true;
        }

    /**
     * Initialize coins for a room at Hunt start
     * @param {string} roomCode - Room code
     * @param {Object} io - Socket.IO server
     * @param {Object} mapConfig - Room's map configuration (optional)
     */
    initializeCoins(roomCode, io, mapConfig = null) {
        const coinMap = new Map();
        
        // Filter spawn slots to only include positions within map bounds
        const mapWidth = mapConfig?.width ?? 30;
        const mapHeight = mapConfig?.height ?? 30;
        const validSlots = COIN_CONFIG.SPAWN_SLOTS.filter(
            slot => slot.row < mapHeight - 1 && slot.col < mapWidth - 1
        );
        
        // Use mapConfig's coinSpawnSlots if available, otherwise use filtered valid slots
        const spawnSlots = mapConfig?.coinSpawnSlots ?? validSlots;
        
        // Exclude positions occupied by sinkholes, sink traps, powerups (and other coins)
        const occupiedSet = getOccupiedSpawnPositions(roomCode);
        const availableSlots = spawnSlots.filter(
            slot => !occupiedSet.has(`${slot.row},${slot.col}`)
        );
        
        // Pick initial coins so each is at least MIN_SPAWN_DISTANCE apart
        const minDist = COIN_CONFIG.MIN_SPAWN_DISTANCE ?? 3;
        const chosenSlots = [];
        const shuffledSlots = [...availableSlots].sort(() => Math.random() - 0.5);

        for (const slot of shuffledSlots) {
            if (chosenSlots.length >= COIN_CONFIG.INITIAL_SPAWN_COUNT) break;
            if (this._isAtLeastNApart(slot, chosenSlots, minDist)) {
                chosenSlots.push(slot);
            }
        }

        chosenSlots.forEach((slot, index) => {
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
        this.roomMapConfigs.set(roomCode, mapConfig);

        // Notify clients
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
     * Check if player can collect a coin at position
     * @param {string} roomCode - Room code
     * @param {Object} position - Player position { row, col }
     * @returns {string|null} Coin ID if collectible, null otherwise
     */
    getCollectibleCoinAtPosition(roomCode, position) {
        const coinMap = this.roomCoins.get(roomCode);
        if (!coinMap) return null;

        for (const [coinId, coin] of coinMap) {
            if (coin.collected) continue;

            const rowDiff = Math.abs(position.row - coin.row);
            const colDiff = Math.abs(position.col - coin.col);
            
            if (rowDiff <= COIN_CONFIG.COLLECTION_RADIUS && colDiff <= COIN_CONFIG.COLLECTION_RADIUS) {
                return coinId;
            }
        }

        return null;
    }

    /**
     * Collect a coin with race condition prevention
     * @param {string} roomCode - Room code
     * @param {string} playerId - Player ID
     * @param {string} coinId - Coin ID
     * @param {string} playerName - Player name
     * @param {Object} io - Socket.IO server
     * @param {Function} updatePlayerCoins - Callback to update player coins
     * @param {Function} getLeaderboard - Callback to get leaderboard
     * @returns {boolean} True if collection was successful
     */
    collectCoin(roomCode, playerId, coinId, playerName, io, updatePlayerCoins, getLeaderboard) {
        const lockKey = `${roomCode}:${coinId}`;
        
        // Race condition check
        if (this.coinLocks.has(lockKey)) {
            return false;
        }

        const coinMap = this.roomCoins.get(roomCode);
        if (!coinMap) return false;

        const coin = coinMap.get(coinId);
        if (!coin || coin.collected) return false;

        // Acquire lock
        this.coinLocks.set(lockKey, playerId);

        try {
            // Double-check
            if (coin.collected) {
                return false;
            }

            // Mark as collected
            coin.collected = true;

            // Award score
            const updatedPlayer = updatePlayerCoins(roomCode, playerId, COIN_CONFIG.VALUE);

            // Notify clients (include row/col so clients can identify which coin was collected)
            io.to(roomCode).emit(SOCKET_EVENTS.SERVER.COIN_COLLECTED, {
                coinId: coinId,
                row: coin.row,
                col: coin.col,
                playerId: playerId,
                playerName: playerName,
                value: COIN_CONFIG.VALUE,
                newScore: updatedPlayer?.coins || 0,
                leaderboard: getLeaderboard(roomCode)
            });

            // Schedule respawn
            coin.respawnTimeoutId = setTimeout(() => {
                this.respawnCoin(roomCode, coinId, io);
            }, COIN_CONFIG.RESPAWN_TIME);

            return true;
        } finally {
            this.coinLocks.delete(lockKey);
        }
    }

    /**
     * Respawn a coin after collection
     * @param {string} roomCode - Room code
     * @param {string} coinId - Coin ID
     * @param {Object} io - Socket.IO server
     */
    respawnCoin(roomCode, coinId, io) {
        const coinMap = this.roomCoins.get(roomCode);
        if (!coinMap) return;

        const coin = coinMap.get(coinId);
        if (!coin) return;

        // Get stored mapConfig for this room
        const mapConfig = this.roomMapConfigs.get(roomCode);
        const mapWidth = mapConfig?.width ?? 30;
        const mapHeight = mapConfig?.height ?? 30;

        // Find unused position (coins + all other collectibles/traps)
        const usedPositions = new Set(getOccupiedSpawnPositions(roomCode));
        coinMap.forEach(c => {
            if (!c.collected) {
                usedPositions.add(`${c.row},${c.col}`);
            }
        });

        // Filter slots to be within map bounds
        const validSlots = (mapConfig?.coinSpawnSlots ?? COIN_CONFIG.SPAWN_SLOTS).filter(
            slot => slot.row < mapHeight - 1 && slot.col < mapWidth - 1
        );
        
        let availableSlots = validSlots.filter(
            slot => !usedPositions.has(`${slot.row},${slot.col}`)
        );

        // Only use slots at least MIN_SPAWN_DISTANCE from other coins
        const minDist = COIN_CONFIG.MIN_SPAWN_DISTANCE ?? 3;
        const otherCoinPositions = [];
        coinMap.forEach((c, cid) => {
            if (cid !== coinId && !c.collected) {
                otherCoinPositions.push({ row: c.row, col: c.col });
            }
        });
        if (otherCoinPositions.length > 0) {
            availableSlots = availableSlots.filter(
                slot => this._isAtLeastNApart(slot, otherCoinPositions, minDist)
            );
        }

        if (availableSlots.length > 0) {
            const newSlot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
            coin.row = newSlot.row;
            coin.col = newSlot.col;
        }
        
        coin.collected = false;
        coin.respawnTimeoutId = null;

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.COIN_SPAWNED, {
            coinId: coinId,
            row: coin.row,
            col: coin.col
        });
    }

    /**
     * Get all active (uncollected) coins in a room
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
    cleanupRoom(roomCode) {
        const coinMap = this.roomCoins.get(roomCode);
        if (coinMap) {
            coinMap.forEach(coin => {
                if (coin.respawnTimeoutId) {
                    clearTimeout(coin.respawnTimeoutId);
                }
            });
        }
        this.roomCoins.delete(roomCode);
        this.roomMapConfigs.delete(roomCode);
        
        // Clear locks for this room
        for (const lockKey of this.coinLocks.keys()) {
            if (lockKey.startsWith(`${roomCode}:`)) {
                this.coinLocks.delete(lockKey);
            }
        }
    }
}

export default new CoinManager();
