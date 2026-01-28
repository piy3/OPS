// Maze configuration for Pacman game
// 1 = wall, 0 = empty space
// Dimensions: 28 rows x 32 columns
//
// This module provides both legacy array-based maze data and 
// optional integration with TiledMapLoader for Phaser tilemap rendering.

// TiledMapLoader integration (lazy loaded to avoid circular dependencies)
let mapLoader = null;

/**
 * Initialize the maze system from a Tiled map
 * @param {object} tiledMapData - Tiled map JSON data
 */
export function initFromTiledMap(tiledMapData) {
  // Lazy import to avoid circular dependencies
  import('./utils/TiledMapLoader.js').then(({ TiledMapLoader }) => {
    mapLoader = new TiledMapLoader(tiledMapData);
    console.log('Maze initialized from Tiled map');
  });
}

/**
 * Get the TiledMapLoader instance (if initialized)
 * @returns {TiledMapLoader|null}
 */
export function getMapLoader() {
  return mapLoader;
}

/**
 * Set the map loader instance directly
 * @param {TiledMapLoader} loader
 */
export function setMapLoader(loader) {
  mapLoader = loader;
}

export const maze = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,0,1],
  [1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,0,1,1,1,1,1,0,1,1,0,0,1,1,0,1,1,1,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,1,1,1,0,1,0,0,0,0,1,0,1,1,1,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0,0],
  [1,1,1,1,1,1,0,1,1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,0,1,1,0,0,0,0,1,1,0,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,0,1,0,0,0,0,0,0,1,0,1,0,1,1,0,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0],
  [1,1,1,1,1,1,0,1,1,0,1,0,1,0,0,0,0,0,0,1,0,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,0,1,1,1,1,1,1,1,1,0,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1,1,0,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0,0],
  [1,1,1,1,1,1,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1],
  [1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,0,0,0,1,1,0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0,1,1,0,0,0,1],
  [1,1,1,0,1,1,0,1,1,0,1,1,1,1,1,0,0,1,1,1,1,1,0,1,1,0,1,1,0,1,1,1],
  [1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
];

// Helper function to get the value at a specific position
export const getMazeValue = (row, col) => {
  // Use TiledMapLoader if initialized
  if (mapLoader) {
    return mapLoader.getMazeValue(row, col);
  }
  
  if (row < 0 || row >= maze.length || col < 0 || col >= maze[0].length) {
    return 1; // Out of bounds is considered a wall
  }
  return maze[row][col];
};

// Helper function to check if a position is a wall
export const isWall = (row, col) => {
  // Use TiledMapLoader if initialized
  if (mapLoader) {
    return mapLoader.isWall(row, col);
  }
  return getMazeValue(row, col) === 1;
};

// Helper function to check if a position is empty
export const isEmpty = (row, col) => {
  // Use TiledMapLoader if initialized
  if (mapLoader) {
    return mapLoader.isEmpty(row, col);
  }
  return getMazeValue(row, col) === 0;
};

// Helper function to check if a row has wrap-around (0s on both ends)
export const hasWrapAround = (row) => {
  // Use TiledMapLoader if initialized
  if (mapLoader) {
    return mapLoader.hasWrapAround(row);
  }
  
  if (row < 0 || row >= MAZE_ROWS) return false;
  // Check if both leftmost (col 0) and rightmost (col 31) are empty
  return maze[row][0] === 0 && maze[row][MAZE_COLS - 1] === 0;
};

// Helper function to get wrapped column position
export const getWrappedCol = (row, col) => {
  // Use TiledMapLoader if initialized
  if (mapLoader) {
    return mapLoader.getWrappedCol(row, col);
  }
  
  if (!hasWrapAround(row)) {
    // No wrap-around, but handle out of bounds
    if (col < 0) return 0;
    if (col >= MAZE_COLS) return MAZE_COLS - 1;
    return col;
  }
  
  // Wrap from left edge to right edge
  if (col < 0) {
    return MAZE_COLS - 1;
  }
  // Wrap from right edge to left edge
  if (col >= MAZE_COLS) {
    return 0;
  }
  return col;
};

// Maze dimensions
export const MAZE_ROWS = 28;
export const MAZE_COLS = 32;

// Helper function to get border data for a wall cell
// Returns object with which borders should be visible (adjacent to empty cells or maze edge)
// Also returns corner info for rounded corners
export const getWallBorders = (row, col) => {
  if (maze[row][col] !== 1) return null; // Not a wall
  
  // Check each neighbor - also show border if at maze edge
  const top = row === 0 || (row > 0 && maze[row - 1][col] === 0);
  const bottom = row === MAZE_ROWS - 1 || (row < MAZE_ROWS - 1 && maze[row + 1][col] === 0);
  const left = col === 0 || (col > 0 && maze[row][col - 1] === 0);
  const right = col === MAZE_COLS - 1 || (col < MAZE_COLS - 1 && maze[row][col + 1] === 0);
  
  // If no borders visible, return null
  if (!top && !bottom && !left && !right) return null;
  
  // Detect corners - where two perpendicular borders meet
  const corners = {
    topLeft: top && left,
    topRight: top && right,
    bottomLeft: bottom && left,
    bottomRight: bottom && right
  };
  
  return { top, bottom, left, right, corners };
};
