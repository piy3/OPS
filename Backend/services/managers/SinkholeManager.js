/**
 * Sinkhole Manager
 * Handles sinkhole (portal) spawning and teleportation
 */
import { SOCKET_EVENTS } from '../../config/constants.js';
import logger from '../../utils/logger.js';
import { getOccupiedSpawnPositions } from '../occupiedSpawnPositions.js';

const log = logger.log;

// Sinkhole configuration
const SINKHOLE_CONFIG = {
    MAX_SINKHOLES: 3,              // Maximum sinkholes on map
    INITIAL_SPAWN_COUNT: 2,        // Initial sinkholes at game start
    SPAWN_INTERVAL_MIN: 15000,     // Min time between spawns (ms)
    SPAWN_INTERVAL_MAX: 25000,     // Max time between spawns (ms)
    TELEPORT_COOLDOWN: 2000,       // Cooldown after teleporting (ms)
    COLLECTION_RADIUS: 1,          // Tiles radius for entering sinkhole
    
    // Predefined spawn slots at road INTERSECTIONS only
    // Roads are at positions where row % 4 === 0 OR col % 4 === 0
    // Intersections are where BOTH row % 4 === 0 AND col % 4 === 0
    SPAWN_SLOTS: [
        { row: 4, col: 8 }, { row: 4, col: 20 }, { row: 4, col: 32 }, { row: 4, col: 44 },
        { row: 8, col: 4 }, { row: 8, col: 16 }, { row: 8, col: 28 }, { row: 8, col: 40 },
        { row: 12, col: 8 }, { row: 12, col: 24 }, { row: 12, col: 36 },
        { row: 16, col: 4 }, { row: 16, col: 16 }, { row: 16, col: 28 }, { row: 16, col: 44 },
        { row: 20, col: 8 }, { row: 20, col: 20 }, { row: 20, col: 32 },
        { row: 24, col: 4 }, { row: 24, col: 16 }, { row: 24, col: 40 },
        { row: 28, col: 8 }, { row: 28, col: 24 }, { row: 28, col: 36 },
        { row: 32, col: 4 }, { row: 32, col: 20 }, { row: 32, col: 44 },
        { row: 36, col: 12 }, { row: 36, col: 28 },
        { row: 40, col: 8 }, { row: 40, col: 24 }, { row: 40, col: 40 },
        { row: 44, col: 4 }, { row: 44, col: 16 }, { row: 44, col: 32 }
    ]
};

class SinkholeManager {
    constructor() {
        this.roomSinkholes = new Map();      // roomCode -> Map<sinkholeId, { row, col, color }>
        this.spawnTimers = new Map();        // roomCode -> timeoutId
        this.teleportCooldowns = new Map();  // playerId -> timestamp
        this.roomMapConfigs = new Map();     // roomCode -> mapConfig
    }

    initializeSinkholes(roomCode, io, mapConfig = null) {
        // Store mapConfig for later spawns
        this.roomMapConfigs.set(roomCode, mapConfig);
        
        // Filter spawn slots to be within map bounds
        const mapWidth = mapConfig?.width ?? 30;
        const mapHeight = mapConfig?.height ?? 30;
        const validSlots = SINKHOLE_CONFIG.SPAWN_SLOTS.filter(
            slot => slot.row < mapHeight - 1 && slot.col < mapWidth - 1
        );
        
        // Exclude positions occupied by coins, sink traps, powerups
        const occupiedSet = getOccupiedSpawnPositions(roomCode);
        const availableSlots = validSlots.filter(
            slot => !occupiedSet.has(`${slot.row},${slot.col}`)
        );
        
        const sinkholeMap = new Map();
        const shuffledSlots = [...availableSlots].sort(() => Math.random() - 0.5);
        const initialSinkholes = shuffledSlots.slice(0, SINKHOLE_CONFIG.INITIAL_SPAWN_COUNT);
        
        initialSinkholes.forEach((slot, index) => {
            const sinkholeId = `sinkhole_${index}`;
            sinkholeMap.set(sinkholeId, {
                id: sinkholeId,
                row: slot.row,
                col: slot.col,
                color: `hsl(${index * 90}, 100%, 50%)`
            });
        });

        this.roomSinkholes.set(roomCode, sinkholeMap);

        const sinkholesData = Array.from(sinkholeMap.values());
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SINKHOLE_SPAWNED, { sinkholes: sinkholesData });

        this.scheduleNextSpawn(roomCode, io);

        log(`[SinkholeManager] Initialized ${initialSinkholes.length} sinkholes for room ${roomCode}`);
    }

    scheduleNextSpawn(roomCode, io) {
        const existingTimer = this.spawnTimers.get(roomCode);
        if (existingTimer) clearTimeout(existingTimer);

        const delay = SINKHOLE_CONFIG.SPAWN_INTERVAL_MIN + 
            Math.random() * (SINKHOLE_CONFIG.SPAWN_INTERVAL_MAX - SINKHOLE_CONFIG.SPAWN_INTERVAL_MIN);

        const timer = setTimeout(() => this.spawnSinkhole(roomCode, io), delay);
        this.spawnTimers.set(roomCode, timer);
    }

    spawnSinkhole(roomCode, io) {
        const sinkholeMap = this.roomSinkholes.get(roomCode);
        if (!sinkholeMap || sinkholeMap.size >= SINKHOLE_CONFIG.MAX_SINKHOLES) {
            this.scheduleNextSpawn(roomCode, io);
            return;
        }

        // Get stored mapConfig for this room
        const mapConfig = this.roomMapConfigs.get(roomCode);
        const mapWidth = mapConfig?.width ?? 30;
        const mapHeight = mapConfig?.height ?? 30;

        const usedPositions = new Set(getOccupiedSpawnPositions(roomCode));
        sinkholeMap.forEach(s => usedPositions.add(`${s.row},${s.col}`));

        // Filter slots to be within map bounds
        const validSlots = SINKHOLE_CONFIG.SPAWN_SLOTS.filter(
            slot => slot.row < mapHeight - 1 && slot.col < mapWidth - 1
        );
        
        const availableSlots = validSlots.filter(
            slot => !usedPositions.has(`${slot.row},${slot.col}`)
        );

        if (availableSlots.length === 0) {
            this.scheduleNextSpawn(roomCode, io);
            return;
        }

        const newSlot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
        const sinkholeId = `sinkhole_${Date.now()}`;
        
        const sinkhole = {
            id: sinkholeId,
            row: newSlot.row,
            col: newSlot.col,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`
        };

        sinkholeMap.set(sinkholeId, sinkhole);
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SINKHOLE_SPAWNED, { sinkholes: [sinkhole] });

        log(`[SinkholeManager] Spawned sinkhole ${sinkholeId} at (${newSlot.row}, ${newSlot.col}) in room ${roomCode}`);

        this.scheduleNextSpawn(roomCode, io);
    }

    getSinkholeAtPosition(roomCode, position) {
        const sinkholeMap = this.roomSinkholes.get(roomCode);
        if (!sinkholeMap) return null;

        for (const [sinkholeId, sinkhole] of sinkholeMap) {
            const rowDiff = Math.abs(position.row - sinkhole.row);
            const colDiff = Math.abs(position.col - sinkhole.col);
            if (rowDiff <= SINKHOLE_CONFIG.COLLECTION_RADIUS && colDiff <= SINKHOLE_CONFIG.COLLECTION_RADIUS) {
                return sinkholeId;
            }
        }
        return null;
    }

    enterSinkhole(roomCode, playerId, playerName, sinkholeId, io, updatePlayerPosition, updateLastMoveAsTeleport) {
        const sinkholeMap = this.roomSinkholes.get(roomCode);
        if (!sinkholeMap || !sinkholeMap.has(sinkholeId)) return null;

        // Check cooldown
        const now = Date.now();
        const lastTeleport = this.teleportCooldowns.get(playerId);
        if (lastTeleport && (now - lastTeleport) < SINKHOLE_CONFIG.TELEPORT_COOLDOWN) {
            return null;
        }

        const sourceSinkhole = sinkholeMap.get(sinkholeId);
        const otherSinkholes = Array.from(sinkholeMap.values()).filter(s => s.id !== sinkholeId);
        
        if (otherSinkholes.length === 0) return null;

        const destSinkhole = otherSinkholes[Math.floor(Math.random() * otherSinkholes.length)];
        
        const TILE_SIZE = 64;
        const fromPosition = {
            x: sourceSinkhole.col * TILE_SIZE + TILE_SIZE / 2,
            y: sourceSinkhole.row * TILE_SIZE + TILE_SIZE / 2,
            row: sourceSinkhole.row,
            col: sourceSinkhole.col
        };

        const toPosition = {
            x: destSinkhole.col * TILE_SIZE + TILE_SIZE / 2,
            y: destSinkhole.row * TILE_SIZE + TILE_SIZE / 2,
            row: destSinkhole.row,
            col: destSinkhole.col
        };

        // Update cooldown
        this.teleportCooldowns.set(playerId, now);

        // Update player position
        if (updatePlayerPosition) {
            if (updateLastMoveAsTeleport) updateLastMoveAsTeleport(roomCode, playerId);
            updatePlayerPosition(roomCode, playerId, toPosition);
        }

        // Notify all clients
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.PLAYER_TELEPORTED, {
            playerId,
            playerName,
            fromPosition,
            toPosition,
            timestamp: now
        });

        log(`[SinkholeManager] Player ${playerName} teleported from (${sourceSinkhole.row}, ${sourceSinkhole.col}) to (${destSinkhole.row}, ${destSinkhole.col})`);

        return { fromPosition, toPosition };
    }

    getActiveSinkholes(roomCode) {
        const sinkholeMap = this.roomSinkholes.get(roomCode);
        if (!sinkholeMap) return [];
        return Array.from(sinkholeMap.values());
    }

    cleanupRoom(roomCode) {
        const timer = this.spawnTimers.get(roomCode);
        if (timer) clearTimeout(timer);
        this.spawnTimers.delete(roomCode);
        this.roomSinkholes.delete(roomCode);
        this.roomMapConfigs.delete(roomCode);
    }

    clearPlayerCooldown(playerId) {
        this.teleportCooldowns.delete(playerId);
    }
}

export default new SinkholeManager();
