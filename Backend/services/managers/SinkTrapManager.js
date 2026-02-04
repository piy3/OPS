/**
 * Sink Trap Manager
 * Handles sink trap collectible spawning, collection, deployment, and triggering
 */
import { SOCKET_EVENTS } from '../../config/constants.js';
import logger from '../../utils/logger.js';
import { getOccupiedSpawnPositions } from '../occupiedSpawnPositions.js';

const log = logger;

const SINK_TRAP_CONFIG = {
    MAX_COLLECTIBLES: 4,
    SPAWN_INTERVAL_MIN: 20000,
    SPAWN_INTERVAL_MAX: 35000,
    MAX_INVENTORY: 3,
    COLLECTION_RADIUS: 1,
    TRIGGER_RADIUS: 0,
    TELEPORT_MIN_DISTANCE: 10,
    
    // Spawn slots at road intersections
    SPAWN_SLOTS: [
        { row: 4, col: 12 }, { row: 4, col: 36 },
        { row: 8, col: 8 }, { row: 8, col: 32 },
        { row: 12, col: 4 }, { row: 12, col: 20 }, { row: 12, col: 40 },
        { row: 16, col: 12 }, { row: 16, col: 36 },
        { row: 20, col: 4 }, { row: 20, col: 24 }, { row: 20, col: 44 },
        { row: 24, col: 12 }, { row: 24, col: 32 },
        { row: 28, col: 4 }, { row: 28, col: 20 },
        { row: 32, col: 16 }, { row: 32, col: 40 },
        { row: 36, col: 8 }, { row: 36, col: 32 },
        { row: 40, col: 4 }, { row: 40, col: 20 },
        { row: 44, col: 12 }, { row: 44, col: 36 }
    ]
};

class SinkTrapManager {
    constructor() {
        this.roomCollectibles = new Map();
        this.roomDeployedTraps = new Map();
        this.playerInventories = new Map();
        this.spawnTimers = new Map();
        this.roomMapConfigs = new Map();  // roomCode -> mapConfig
    }

    initializeSinkTraps(roomCode, io, mapConfig = null) {
        // Store mapConfig for later spawns
        this.roomMapConfigs.set(roomCode, mapConfig);
        
        this.roomCollectibles.set(roomCode, new Map());
        this.roomDeployedTraps.set(roomCode, new Map());
        this.playerInventories.set(roomCode, new Map());

        for (let i = 0; i < 2; i++) {
            this.spawnCollectible(roomCode, io);
        }

        this.scheduleNextSpawn(roomCode, io);

        log.info(`[SinkTrapManager] Initialized for room ${roomCode}`);
    }

    scheduleNextSpawn(roomCode, io) {
        const existingTimer = this.spawnTimers.get(roomCode);
        if (existingTimer) clearTimeout(existingTimer);

        const delay = SINK_TRAP_CONFIG.SPAWN_INTERVAL_MIN + 
            Math.random() * (SINK_TRAP_CONFIG.SPAWN_INTERVAL_MAX - SINK_TRAP_CONFIG.SPAWN_INTERVAL_MIN);

        const timer = setTimeout(() => this.spawnCollectible(roomCode, io), delay);
        this.spawnTimers.set(roomCode, timer);
    }

    spawnCollectible(roomCode, io) {
        const collectibles = this.roomCollectibles.get(roomCode);
        if (!collectibles || collectibles.size >= SINK_TRAP_CONFIG.MAX_COLLECTIBLES) {
            this.scheduleNextSpawn(roomCode, io);
            return;
        }

        // Get stored mapConfig for this room
        const mapConfig = this.roomMapConfigs.get(roomCode);
        const mapWidth = mapConfig?.width ?? 30;
        const mapHeight = mapConfig?.height ?? 30;

        const usedPositions = new Set(getOccupiedSpawnPositions(roomCode));
        collectibles.forEach(c => usedPositions.add(`${c.row},${c.col}`));
        
        const deployedTraps = this.roomDeployedTraps.get(roomCode);
        if (deployedTraps) {
            deployedTraps.forEach(t => usedPositions.add(`${t.row},${t.col}`));
        }

        // Filter slots to be within map bounds
        const validSlots = SINK_TRAP_CONFIG.SPAWN_SLOTS.filter(
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
        const trapId = `sinktrap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        collectibles.set(trapId, { id: trapId, row: newSlot.row, col: newSlot.col });

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SINK_TRAP_SPAWNED, {
            id: trapId, row: newSlot.row, col: newSlot.col
        });

        log.debug(`[SinkTrapManager] Spawned collectible ${trapId} at (${newSlot.row}, ${newSlot.col}) in room ${roomCode}`);

        this.scheduleNextSpawn(roomCode, io);
    }

    getCollectibleAtPosition(roomCode, position) {
        const collectibles = this.roomCollectibles.get(roomCode);
        if (!collectibles) return null;

        for (const [trapId, trap] of collectibles) {
            const rowDiff = Math.abs(position.row - trap.row);
            const colDiff = Math.abs(position.col - trap.col);
            if (rowDiff <= SINK_TRAP_CONFIG.COLLECTION_RADIUS && colDiff <= SINK_TRAP_CONFIG.COLLECTION_RADIUS) {
                return trapId;
            }
        }
        return null;
    }

    collectTrap(roomCode, playerId, trapId, playerName, io) {
        const collectibles = this.roomCollectibles.get(roomCode);
        if (!collectibles || !collectibles.has(trapId)) return false;

        const inventories = this.playerInventories.get(roomCode);
        if (!inventories) return false;

        const currentCount = inventories.get(playerId) || 0;
        if (currentCount >= SINK_TRAP_CONFIG.MAX_INVENTORY) return false;

        collectibles.delete(trapId);
        inventories.set(playerId, currentCount + 1);

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SINK_TRAP_COLLECTED, {
            trapId, playerId, playerName, newInventoryCount: currentCount + 1
        });

        log.debug(`[SinkTrapManager] Player ${playerName} collected trap, inventory: ${currentCount + 1}`);

        return true;
    }

    deployTrap(roomCode, playerId, playerName, position, io) {
        const inventories = this.playerInventories.get(roomCode);
        if (!inventories) return null;

        const currentCount = inventories.get(playerId) || 0;
        if (currentCount <= 0) return null;

        inventories.set(playerId, currentCount - 1);

        const deployedTraps = this.roomDeployedTraps.get(roomCode);
        if (!deployedTraps) return null;

        const trapId = `deployed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        deployedTraps.set(trapId, {
            id: trapId, row: position.row, col: position.col,
            deployedBy: playerId, deployTime: Date.now()
        });

        const TILE_SIZE = 64;
        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SINK_TRAP_DEPLOYED, {
            trapId, playerId, playerName,
            row: position.row, col: position.col,
            x: position.col * TILE_SIZE + TILE_SIZE / 2,
            y: position.row * TILE_SIZE + TILE_SIZE / 2,
            newInventoryCount: currentCount - 1
        });

        log.debug(`[SinkTrapManager] Player ${playerName} deployed trap at (${position.row}, ${position.col})`);

        return { trapId, row: position.row, col: position.col };
    }

    checkTrapTrigger(roomCode, unicornPosition) {
        const deployedTraps = this.roomDeployedTraps.get(roomCode);
        if (!deployedTraps) return null;

        for (const [trapId, trap] of deployedTraps) {
            const rowDiff = Math.abs(unicornPosition.row - trap.row);
            const colDiff = Math.abs(unicornPosition.col - trap.col);
            if (rowDiff <= SINK_TRAP_CONFIG.TRIGGER_RADIUS && colDiff <= SINK_TRAP_CONFIG.TRIGGER_RADIUS) {
                return trapId;
            }
        }
        return null;
    }

    triggerTrap(roomCode, trapId, unicornId, unicornName, io, updatePlayerPosition, destinationPosition = null) {
        const deployedTraps = this.roomDeployedTraps.get(roomCode);
        if (!deployedTraps || !deployedTraps.has(trapId)) return null;

        const trap = deployedTraps.get(trapId);
        deployedTraps.delete(trapId);

        // Get stored mapConfig for this room (for fallback)
        const mapConfig = this.roomMapConfigs.get(roomCode);
        const TILE_SIZE = 64;
        const fromPosition = {
            x: trap.col * TILE_SIZE + TILE_SIZE / 2,
            y: trap.row * TILE_SIZE + TILE_SIZE / 2,
            row: trap.row, col: trap.col
        };

        // Use valid road destination (no buildings, no other players); fallback to first spawn if not provided
        let destRow, destCol;
        if (destinationPosition && typeof destinationPosition.row === 'number' && typeof destinationPosition.col === 'number') {
            destRow = destinationPosition.row;
            destCol = destinationPosition.col;
        } else {
            const spawnPositions = mapConfig?.spawnPositions || [];
            const first = spawnPositions[0];
            if (first) {
                destRow = first.row;
                destCol = first.col;
            } else {
                destRow = 4;
                destCol = 4;
            }
        }

        const toPosition = {
            x: destCol * TILE_SIZE + TILE_SIZE / 2,
            y: destRow * TILE_SIZE + TILE_SIZE / 2,
            row: destRow, col: destCol
        };

        if (updatePlayerPosition) {
            updatePlayerPosition(roomCode, unicornId, toPosition);
        }

        io.to(roomCode).emit(SOCKET_EVENTS.SERVER.SINK_TRAP_TRIGGERED, {
            trapId, unicornId, unicornName,
            deployedBy: trap.deployedBy,
            fromPosition, toPosition, timestamp: Date.now()
        });

        log.info(`[SinkTrapManager] Unicorn ${unicornName} triggered trap, teleported from (${trap.row}, ${trap.col}) to (${destRow}, ${destCol})`);

        return { fromPosition, toPosition };
    }

    getPlayerInventory(roomCode, playerId) {
        const inventories = this.playerInventories.get(roomCode);
        return inventories?.get(playerId) || 0;
    }

    getActiveCollectibles(roomCode) {
        const collectibles = this.roomCollectibles.get(roomCode);
        return collectibles ? Array.from(collectibles.values()) : [];
    }

    getDeployedTraps(roomCode) {
        const deployedTraps = this.roomDeployedTraps.get(roomCode);
        return deployedTraps ? Array.from(deployedTraps.values()) : [];
    }

    cleanupRoom(roomCode) {
        const timer = this.spawnTimers.get(roomCode);
        if (timer) clearTimeout(timer);
        this.spawnTimers.delete(roomCode);
        this.roomCollectibles.delete(roomCode);
        this.roomDeployedTraps.delete(roomCode);
        this.playerInventories.delete(roomCode);
        this.roomMapConfigs.delete(roomCode);

        log.debug(`[SinkTrapManager] Cleaned up room ${roomCode}`);
    }
}

export default new SinkTrapManager();
