/**
 * Occupied spawn positions helper
 * Returns a read-only Set of "row,col" strings for all positions occupied by
 * coins, sinkholes, sink trap collectibles, deployed sink traps, and powerups.
 * Used by each manager when choosing spawn slots to prevent overlaps.
 */

import coinManager from './managers/CoinManager.js';
import sinkholeManager from './managers/SinkholeManager.js';
import sinkTrapManager from './managers/SinkTrapManager.js';

/**
 * Get the set of occupied spawn positions for a room (all collectibles + deployed traps).
 * @param {string} roomCode - Room code
 * @returns {Set<string>} Set of "row,col" keys
 */
export function getOccupiedSpawnPositions(roomCode) {
    const occupied = new Set();

    try {
        const coins = coinManager.getActiveCoins(roomCode);
        coins.forEach(c => occupied.add(`${c.row},${c.col}`));

        const sinkholes = sinkholeManager.getActiveSinkholes(roomCode);
        sinkholes.forEach(s => occupied.add(`${s.row},${s.col}`));

        const sinkCollectibles = sinkTrapManager.getActiveCollectibles(roomCode);
        sinkCollectibles.forEach(c => occupied.add(`${c.row},${c.col}`));

        const deployedTraps = sinkTrapManager.getDeployedTraps(roomCode);
        deployedTraps.forEach(t => occupied.add(`${t.row},${t.col}`));
    } catch (_) {
        // Missing room or manager error: return current set (may be empty)
    }

    return occupied;
}
