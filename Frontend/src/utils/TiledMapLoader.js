/**
 * TiledMapLoader - Utility to load, parse, and work with Tiled maps
 * 
 * Provides:
 * - Legacy compatibility (isWall, hasWrapAround, getWrappedCol)
 * - Collision detection via tilemap data
 * - Auto-tile index calculation for seamless wall rendering
 * - Phaser tilemap integration helpers
 */

import { maze, MAZE_ROWS, MAZE_COLS } from '../maze';
import { NEIGHBOR, getWallTileIndex } from '../scripts/generateTileset';

/**
 * 4-bit neighbor mask constants
 * Used for auto-tiling wall connections
 */
export const NEIGHBORS = {
  NORTH: 1,  // bit 0
  EAST: 2,   // bit 1
  SOUTH: 4,  // bit 2
  WEST: 8,   // bit 3
};

/**
 * TiledMapLoader class for managing Tiled map data
 */
export class TiledMapLoader {
  constructor(mapData = null) {
    this.mapData = mapData;
    this.width = mapData?.width || MAZE_COLS;
    this.height = mapData?.height || MAZE_ROWS;
    this.tileWidth = mapData?.tilewidth || 32;
    this.tileHeight = mapData?.tileheight || 32;
    
    // Parse layers from map data or generate from maze array
    this.layers = {};
    this.properties = {};
    this.wrapRows = [];
    
    if (mapData) {
      this._parseMapData(mapData);
    } else {
      this._generateFromMazeArray();
    }
  }
  
  /**
   * Parse Tiled JSON map data
   */
  _parseMapData(mapData) {
    // Extract layers
    if (mapData.layers) {
      mapData.layers.forEach(layer => {
        this.layers[layer.name] = {
          data: layer.data,
          width: layer.width,
          height: layer.height,
          visible: layer.visible,
          type: layer.type,
        };
      });
    }
    
    // Extract custom properties
    if (mapData.properties) {
      mapData.properties.forEach(prop => {
        this.properties[prop.name] = prop.value;
        
        // Parse wrapRows
        if (prop.name === 'wrapRows' && prop.value) {
          this.wrapRows = prop.value.split(',').map(n => parseInt(n.trim(), 10));
        }
      });
    }
  }
  
  /**
   * Generate layer data from the legacy maze array
   */
  _generateFromMazeArray() {
    // Create collision/ground data from maze array
    const groundData = [];
    const wallData = [];
    const collisionData = [];
    
    for (let row = 0; row < MAZE_ROWS; row++) {
      for (let col = 0; col < MAZE_COLS; col++) {
        const isWall = maze[row][col] === 1;
        
        // Ground layer - all floor tiles (tile 1 = firstgid + 0)
        groundData.push(1);
        
        // Collision layer - 1 for wall, 0 for empty
        collisionData.push(isWall ? 1 : 0);
        
        // Wall layer - auto-tiled wall index or 0 for empty
        if (isWall) {
          const tileIndex = this._calculateAutoTileIndex(row, col);
          wallData.push(tileIndex);
        } else {
          wallData.push(0);
        }
      }
    }
    
    this.layers = {
      ground: {
        data: groundData,
        width: MAZE_COLS,
        height: MAZE_ROWS,
        visible: true,
        type: 'tilelayer',
      },
      walls: {
        data: wallData,
        width: MAZE_COLS,
        height: MAZE_ROWS,
        visible: true,
        type: 'tilelayer',
      },
      collision: {
        data: collisionData,
        width: MAZE_COLS,
        height: MAZE_ROWS,
        visible: false,
        type: 'tilelayer',
      },
    };
    
    // Set wrap rows based on maze data
    this.wrapRows = [];
    for (let row = 0; row < MAZE_ROWS; row++) {
      if (maze[row][0] === 0 && maze[row][MAZE_COLS - 1] === 0) {
        this.wrapRows.push(row);
      }
    }
    
    this.properties = {
      wrapRows: this.wrapRows.join(','),
    };
  }
  
  /**
   * Calculate auto-tile index based on wall neighbors
   * Returns tile index (2-17 in Tiled format, where firstgid=1)
   */
  _calculateAutoTileIndex(row, col) {
    // Check each neighbor
    const hasNorth = row > 0 && maze[row - 1][col] === 1;
    const hasSouth = row < MAZE_ROWS - 1 && maze[row + 1][col] === 1;
    const hasWest = col > 0 && maze[row][col - 1] === 1;
    const hasEast = col < MAZE_COLS - 1 && maze[row][col + 1] === 1;
    
    // Calculate 4-bit neighbor mask
    let mask = 0;
    if (hasNorth) mask |= NEIGHBORS.NORTH;
    if (hasEast) mask |= NEIGHBORS.EAST;
    if (hasSouth) mask |= NEIGHBORS.SOUTH;
    if (hasWest) mask |= NEIGHBORS.WEST;
    
    // Map mask to tile index
    // Tiles 1-16 correspond to masks 0-15
    // In Tiled format with firstgid=1: tile index = mask + 2
    // (tile 1 is empty/floor, tiles 2-17 are walls with masks 0-15)
    return mask + 2;
  }
  
  // ========== LEGACY COMPATIBILITY ==========
  
  /**
   * Check if a position is a wall
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {boolean}
   */
  isWall(row, col) {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return true; // Out of bounds is considered a wall
    }
    
    // Use collision layer if available
    if (this.layers.collision) {
      const index = row * this.width + col;
      return this.layers.collision.data[index] !== 0;
    }
    
    // Fallback to maze array
    return maze[row]?.[col] === 1;
  }
  
  /**
   * Check if a row has wrap-around capability
   * @param {number} row - Row index
   * @returns {boolean}
   */
  hasWrapAround(row) {
    if (row < 0 || row >= this.height) return false;
    return this.wrapRows.includes(row);
  }
  
  /**
   * Get wrapped column position for tunnel mechanics
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {number} Wrapped column index
   */
  getWrappedCol(row, col) {
    if (!this.hasWrapAround(row)) {
      if (col < 0) return 0;
      if (col >= this.width) return this.width - 1;
      return col;
    }
    
    // Wrap from left to right
    if (col < 0) return this.width - 1;
    // Wrap from right to left
    if (col >= this.width) return 0;
    return col;
  }
  
  /**
   * Check if a position is empty/passable
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {boolean}
   */
  isEmpty(row, col) {
    return !this.isWall(row, col);
  }
  
  /**
   * Get the value at a position (0 = empty, 1 = wall)
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {number}
   */
  getMazeValue(row, col) {
    return this.isWall(row, col) ? 1 : 0;
  }
  
  // ========== TILEMAP DATA ACCESS ==========
  
  /**
   * Get collision layer data as 2D array
   * @returns {number[][]}
   */
  getCollisionData() {
    const layer = this.layers.collision;
    if (!layer) return maze; // Fallback to original maze
    
    const result = [];
    for (let row = 0; row < this.height; row++) {
      const rowData = [];
      for (let col = 0; col < this.width; col++) {
        rowData.push(layer.data[row * this.width + col]);
      }
      result.push(rowData);
    }
    return result;
  }
  
  /**
   * Get a specific layer's data
   * @param {string} layerName - Name of the layer
   * @returns {object|null} Layer object or null
   */
  getLayerData(layerName) {
    return this.layers[layerName] || null;
  }
  
  /**
   * Get flat tile data array for a layer (for Phaser tilemap)
   * @param {string} layerName - Name of the layer
   * @returns {number[]} Flat array of tile indices
   */
  getLayerTileData(layerName) {
    const layer = this.layers[layerName];
    return layer ? layer.data : [];
  }
  
  /**
   * Get the auto-tiled wall data with proper tile indices
   * @returns {number[]} Flat array of wall tile indices
   */
  getAutoTiledWallData() {
    return this.getLayerTileData('walls');
  }
  
  /**
   * Get map dimensions
   * @returns {object} { width, height, tileWidth, tileHeight }
   */
  getDimensions() {
    return {
      width: this.width,
      height: this.height,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      pixelWidth: this.width * this.tileWidth,
      pixelHeight: this.height * this.tileHeight,
    };
  }
  
  /**
   * Get tile at position
   * @param {string} layerName - Layer name
   * @param {number} row - Row index
   * @param {number} col - Column index
   * @returns {number} Tile index
   */
  getTileAt(layerName, row, col) {
    const layer = this.layers[layerName];
    if (!layer || row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return 0;
    }
    return layer.data[row * this.width + col];
  }
}

// ========== PHASER INTEGRATION HELPERS ==========

/**
 * Preload Tiled map assets for Phaser
 * @param {Phaser.Scene} scene - The Phaser scene
 * @param {string} mapKey - Key for the map
 * @param {string} mapPath - Path to the map JSON
 * @param {string} tilesetKey - Key for the tileset texture
 * @param {string} tilesetPath - Path to the tileset image (optional, for pre-generated)
 */
export function preloadTiledMap(scene, mapKey, mapPath, tilesetKey, tilesetPath = null) {
  // Load map JSON
  scene.load.tilemapTiledJSON(mapKey, mapPath);
  
  // Load tileset image if provided (for pre-generated tilesets)
  if (tilesetPath) {
    scene.load.image(tilesetKey, tilesetPath);
  }
}

/**
 * Create a Phaser tilemap from loaded assets
 * @param {Phaser.Scene} scene - The Phaser scene
 * @param {string} mapKey - Key of the loaded map
 * @param {string} tilesetName - Name of tileset in the map
 * @param {string} tilesetKey - Key of the loaded tileset image
 * @returns {object} { tilemap, layers }
 */
export function createTilemap(scene, mapKey, tilesetName, tilesetKey) {
  const tilemap = scene.make.tilemap({ key: mapKey });
  const tileset = tilemap.addTilesetImage(tilesetName, tilesetKey);
  
  const layers = {};
  
  // Create ground layer
  if (tilemap.getLayer('ground')) {
    layers.ground = tilemap.createLayer('ground', tileset, 0, 0);
  }
  
  // Create wall layer
  if (tilemap.getLayer('walls')) {
    layers.walls = tilemap.createLayer('walls', tileset, 0, 0);
    // Set collision on wall tiles
    layers.walls.setCollisionByProperty({ collision: true });
  }
  
  return { tilemap, tileset, layers };
}

/**
 * Create a dynamic tilemap from maze array using Phaser's graphics
 * This avoids the need for pre-generated tileset images
 * @param {Phaser.Scene} scene - The Phaser scene
 * @param {TiledMapLoader} mapLoader - Map loader instance
 * @param {string} tilesetKey - Key for the generated tileset texture
 * @returns {object} { tilemap, layers }
 */
export function createDynamicTilemap(scene, mapLoader, tilesetKey = 'maze-tiles') {
  const { width, height, tileWidth, tileHeight } = mapLoader.getDimensions();
  
  // Create blank tilemap
  const tilemap = scene.make.tilemap({
    tileWidth,
    tileHeight,
    width,
    height,
  });
  
  // Add tileset (assumes texture was generated with generateTilesetTexture)
  const tileset = tilemap.addTilesetImage(tilesetKey, tilesetKey, tileWidth, tileHeight, 0, 0);
  
  const layers = {};
  
  // Create ground layer
  const groundData = mapLoader.getLayerTileData('ground');
  if (groundData.length > 0) {
    layers.ground = tilemap.createBlankLayer('ground', tileset, 0, 0, width, height);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tileIndex = groundData[row * width + col];
        if (tileIndex > 0) {
          layers.ground.putTileAt(tileIndex - 1, col, row); // Phaser uses 0-indexed tiles
        }
      }
    }
  }
  
  // Create wall layer with auto-tiled walls
  const wallData = mapLoader.getAutoTiledWallData();
  if (wallData.length > 0) {
    layers.walls = tilemap.createBlankLayer('walls', tileset, 0, 0, width, height);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tileIndex = wallData[row * width + col];
        if (tileIndex > 0) {
          layers.walls.putTileAt(tileIndex - 1, col, row); // Phaser uses 0-indexed tiles
        }
      }
    }
    
    // Set collision on wall layer
    layers.walls.setCollisionBetween(1, 16); // Tiles 1-16 are walls
  }
  
  return { tilemap, tileset, layers };
}

// ========== SINGLETON INSTANCE ==========

let mapLoaderInstance = null;

/**
 * Get or create the global map loader instance
 * @param {object} mapData - Optional Tiled map JSON data
 * @returns {TiledMapLoader}
 */
export function getMapLoader(mapData = null) {
  if (!mapLoaderInstance || mapData) {
    mapLoaderInstance = new TiledMapLoader(mapData);
  }
  return mapLoaderInstance;
}

/**
 * Initialize map loader from Tiled JSON data
 * @param {object} tiledMapData - Tiled map JSON
 */
export function initFromTiledMap(tiledMapData) {
  mapLoaderInstance = new TiledMapLoader(tiledMapData);
  return mapLoaderInstance;
}

// Export default map loader (using maze array)
export default TiledMapLoader;
