/**
 * Wrap-around detection utility for horizontal maze tunnels
 */

import { MAZE_COLS, hasWrapAround } from '../maze';

/**
 * Detect wrap-around direction based on column change
 * Used for smooth animation across tunnel edges
 * 
 * @param {number} currentCol - Current column position
 * @param {number} newCol - New column position
 * @param {number} currentRow - Current row position
 * @returns {{ wrapDetected: boolean, direction: 'left'|'right'|null }}
 */
export function detectWrapAround(currentCol, newCol, currentRow) {
  if (!hasWrapAround(currentRow)) {
    return { wrapDetected: false, direction: null };
  }
  
  const colDiff = newCol - currentCol;
  
  // Wrap right to left (31 -> 0)
  if (colDiff < -MAZE_COLS / 2 || (currentCol === MAZE_COLS - 1 && newCol === 0)) {
    return { wrapDetected: true, direction: 'left' };
  }
  
  // Wrap left to right (0 -> 31)
  if (colDiff > MAZE_COLS / 2 || (currentCol === 0 && newCol === MAZE_COLS - 1)) {
    return { wrapDetected: true, direction: 'right' };
  }
  
  return { wrapDetected: false, direction: null };
}

/**
 * Calculate adjusted X position for wrap-around animation
 * 
 * @param {number} targetX - Target pixel X position
 * @param {number} currentX - Current pixel X position
 * @param {number} mazeWidth - Total maze width in pixels
 * @param {'left'|'right'} direction - Wrap direction
 * @returns {number} Adjusted X position for smooth animation
 */
export function getWrapAdjustedX(targetX, currentX, mazeWidth, direction) {
  if (direction === 'left') {
    // Moving right to left (31 -> 0): add mazeWidth to target
    return targetX + mazeWidth;
  } else if (direction === 'right') {
    // Moving left to right (0 -> 31): subtract mazeWidth from target
    return targetX - mazeWidth;
  }
  return targetX;
}

/**
 * Normalize X position to stay within maze bounds
 * 
 * @param {number} x - X position to normalize
 * @param {number} mazeWidth - Total maze width in pixels
 * @returns {number} Normalized X position
 */
export function normalizeX(x, mazeWidth) {
  while (x < 0) x += mazeWidth;
  while (x >= mazeWidth) x -= mazeWidth;
  return x;
}
