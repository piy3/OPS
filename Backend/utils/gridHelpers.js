/**
 * Grid-based helper utilities for position and collision calculations
 */

/**
 * Check if two positions are within a given radius
 * Used for coin/powerup collection detection
 * 
 * @param {{ row: number, col: number }} pos1 - First position
 * @param {{ row: number, col: number }} pos2 - Second position
 * @param {number} radius - Collection radius in cells
 * @returns {boolean} True if positions are within radius
 */
export function isWithinRadius(pos1, pos2, radius) {
  const rowDiff = Math.abs(pos1.row - pos2.row);
  const colDiff = Math.abs(pos1.col - pos2.col);
  return rowDiff <= radius && colDiff <= radius;
}

/**
 * Calculate Manhattan distance between two positions
 * 
 * @param {{ row: number, col: number }} pos1 - First position
 * @param {{ row: number, col: number }} pos2 - Second position
 * @returns {number} Manhattan distance in cells
 */
export function getManhattanDistance(pos1, pos2) {
  return Math.abs(pos1.row - pos2.row) + Math.abs(pos1.col - pos2.col);
}

/**
 * Check if two positions are the same cell
 * 
 * @param {{ row: number, col: number }} pos1 - First position
 * @param {{ row: number, col: number }} pos2 - Second position
 * @returns {boolean} True if positions are in the same cell
 */
export function isSameCell(pos1, pos2) {
  return pos1.row === pos2.row && pos1.col === pos2.col;
}
