/**
 * Tileset Generator Configuration
 * 
 * This file exports the configuration and tile generation functions
 * that can be used with Phaser's graphics to dynamically generate tiles.
 * 
 * The tileset is generated at runtime using Phaser's graphics API,
 * which avoids native dependencies like node-canvas.
 * 
 * Tile Layout (8 tiles wide, 4 tiles tall = 32 tiles):
 * - Tile 0: Empty/path tile (dark floor with subtle grid pattern)
 * - Tiles 1-15: Auto-tile wall pieces using 4-bit bitmask pattern
 * - Tile 16+: Corner/edge decorative tiles with neon glow effects
 */

import log from '../utils/logger';

// Tile dimensions
export const TILE_SIZE = 32;
export const TILES_PER_ROW = 8;
export const TOTAL_ROWS = 4;
export const TILESET_WIDTH = TILE_SIZE * TILES_PER_ROW;  // 256px
export const TILESET_HEIGHT = TILE_SIZE * TOTAL_ROWS;    // 128px

// Colors - Neon/Cyberpunk Theme
export const COLORS = {
  // Background/floor
  floorBase: 0x0d001a,        // Very dark purple
  floorGrid: 0x1a0033,        // Slightly lighter purple for grid
  
  // Wall colors
  wallBase: 0x1a0033,         // Dark purple base
  wallGlow: 0xbf00ff,         // Bright purple glow
  wallGlowInner: 0x0d001a,    // Lighter purple for inner glow
  wallBorder: 0x8000aa,       // Medium purple for wall borders
  
  // Decoration
  decorGlow: 0x0d001a,        // Cyan accent
  decorGlowDim: 0x008888,     // Dimmer cyan
};

// 4-bit bitmask neighbor flags
// Using NESW (North, East, South, West) convention
export const NEIGHBOR = {
  NORTH: 1,  // bit 0
  EAST: 2,   // bit 1
  SOUTH: 4,  // bit 2
  WEST: 8,   // bit 3
};

/**
 * Get the tile index for a wall based on its neighbors
 * @param {boolean} hasNorth - Has wall neighbor to the north
 * @param {boolean} hasEast - Has wall neighbor to the east
 * @param {boolean} hasSouth - Has wall neighbor to the south
 * @param {boolean} hasWest - Has wall neighbor to the west
 * @returns {number} Tile index (1-16)
 */
export function getWallTileIndex(hasNorth, hasEast, hasSouth, hasWest) {
  let mask = 0;
  if (hasNorth) mask |= NEIGHBOR.NORTH;
  if (hasEast) mask |= NEIGHBOR.EAST;
  if (hasSouth) mask |= NEIGHBOR.SOUTH;
  if (hasWest) mask |= NEIGHBOR.WEST;
  
  // Tile index = mask + 1 (tile 0 is empty, tiles 1-16 are walls)
  // But we need to map to our tileset layout:
  // Row 0: tiles 0-7 (mask 0-6)
  // Row 1: tiles 8-15 (mask 7-14)
  // Row 2: tile 16 (mask 15)
  if (mask === 15) {
    return 16; // Full wall (all neighbors)
  }
  return mask + 1;
}

/**
 * Generate tileset texture using Phaser graphics
 * Call this in preload() after scene is created
 * 
 * @param {Phaser.Scene} scene - The Phaser scene
 * @param {string} textureKey - Key to save the texture as (default: 'maze-tiles')
 */
export function generateTilesetTexture(scene, textureKey = 'maze-tiles') {
  const graphics = scene.add.graphics();
  
  // Create a render texture to draw to
  const renderTexture = scene.add.renderTexture(0, 0, TILESET_WIDTH, TILESET_HEIGHT);
  
  // === ROW 0: Tiles 0-7 ===
  
  // Tile 0: Empty/floor tile
  drawFloorTile(graphics, 0, 0);
  
  // Tiles 1-7: Wall with neighbor masks 0-6
  for (let mask = 0; mask <= 6; mask++) {
    drawWallTile(graphics, (mask + 1) * TILE_SIZE, 0, mask);
  }
  
  // === ROW 1: Tiles 8-15 (masks 7-14) ===
  for (let mask = 7; mask <= 14; mask++) {
    drawWallTile(graphics, (mask - 7) * TILE_SIZE, TILE_SIZE, mask);
  }
  
  // === ROW 2: Tile 16 (mask 15) + decorative ===
  // Tile 16: Full wall
  drawWallTile(graphics, 0, 2 * TILE_SIZE, 15);
  
  // Tiles 17-20: Corner decorations
  drawCornerTile(graphics, 1 * TILE_SIZE, 2 * TILE_SIZE, 'TL');
  drawCornerTile(graphics, 2 * TILE_SIZE, 2 * TILE_SIZE, 'TR');
  drawCornerTile(graphics, 3 * TILE_SIZE, 2 * TILE_SIZE, 'BL');
  drawCornerTile(graphics, 4 * TILE_SIZE, 2 * TILE_SIZE, 'BR');
  
  // Fill rest with floor
  for (let i = 5; i < 8; i++) {
    drawFloorTile(graphics, i * TILE_SIZE, 2 * TILE_SIZE);
  }
  
  // === ROW 3: Reserved (floor pattern) ===
  for (let i = 0; i < 8; i++) {
    drawFloorTile(graphics, i * TILE_SIZE, 3 * TILE_SIZE);
  }
  
  // Draw graphics to render texture
  renderTexture.draw(graphics);
  
  // Generate texture from render texture
  renderTexture.saveTexture(textureKey);
  
  // Cleanup
  graphics.destroy();
  renderTexture.destroy();
  
  log.log(`Tileset generated: ${textureKey} (${TILESET_WIDTH}x${TILESET_HEIGHT})`);
  
  return textureKey;
}

/**
 * Draw floor/empty tile
 */
function drawFloorTile(graphics, x, y) {
  // Base color
  graphics.fillStyle(COLORS.floorBase, 1);
  graphics.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  
  // // Subtle grid lines
  // graphics.lineStyle(0.5, COLORS.floorGrid, 0.5);
  // const gridSpacing = 8;
  
  // for (let i = gridSpacing; i < TILE_SIZE; i += gridSpacing) {
  //   // Horizontal
  //   graphics.lineBetween(x, y + i, x + TILE_SIZE, y + i);
  //   // Vertical
  //   graphics.lineBetween(x + i, y, x + i, y + TILE_SIZE);
  // }
  
  // Center dot
  // graphics.fillStyle(COLORS.floorGrid, 0.5);
  // graphics.fillCircle(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 1);
}

/**
 * Draw wall tile with borders based on neighbor mask
 * Features rounded corners on outer edges with clean single-stroke borders
 */
function drawWallTile(graphics, x, y, mask) {
  // const inset = 4;  // pixels on each side (e.g. 4 → 24×24 wall in 32×32 tile)
  // const wx = x + inset;
  // const wy = y + inset;
  // const ww = TILE_SIZE - 3 * inset;
  // const wh = TILE_SIZE - 3 * inset;

  const borderWidth = 3;
  const cornerRadius = 10; // Larger radius for more rounded corners
  
  // Check which sides have wall neighbors (no border needed)
  const hasNorth = (mask & NEIGHBOR.NORTH) !== 0;
  const hasEast = (mask & NEIGHBOR.EAST) !== 0;
  const hasSouth = (mask & NEIGHBOR.SOUTH) !== 0;
  const hasWest = (mask & NEIGHBOR.WEST) !== 0;
  
  // Determine which corners should be rounded (outer corners only)
  const roundTL = !hasNorth && !hasWest;
  const roundTR = !hasNorth && !hasEast;
  const roundBL = !hasSouth && !hasWest;
  const roundBR = !hasSouth && !hasEast;
  
  // Draw base wall fill with rounded corners
  graphics.fillStyle(COLORS.wallBase, 1);
  drawRoundedRectWithSelectiveCorners(graphics, x, y, TILE_SIZE, TILE_SIZE, {
    tl: roundTL ? cornerRadius : 0,
    tr: roundTR ? cornerRadius : 0,
    bl: roundBL ? cornerRadius : 0,
    br: roundBR ? cornerRadius : 0
  });
  
  // Draw glowing border as a single continuous stroke path
  drawWallBorderPath(graphics, x, y, TILE_SIZE, TILE_SIZE, {
    hasNorth,
    hasEast,
    hasSouth,
    hasWest,
    cornerRadius,
    borderWidth
  });
}

/**
 * Draw wall border as a continuous path to avoid corner overlaps
 */
function drawWallBorderPath(graphics, x, y, width, height, options) {
  const { hasNorth, hasEast, hasSouth, hasWest, cornerRadius, borderWidth } = options;

  const roundTL = !hasNorth && !hasWest;
  const roundTR = !hasNorth && !hasEast;
  const roundBL = !hasSouth && !hasWest;
  const roundBR = !hasSouth && !hasEast;

  if (hasNorth && hasEast && hasSouth && hasWest) {
    return;
  }

  graphics.lineStyle(borderWidth, COLORS.wallGlow, 1);
  graphics.beginPath();

  const r = cornerRadius;
  const inset = borderWidth / 2;

  if (!hasNorth) {
    const endX = roundTR ? x + width - r : x + width;
    if (roundTL) {
      graphics.arc(x + r + inset, y + r + inset, r, Math.PI, Math.PI * 1.5, false);
    } else {
      graphics.moveTo(x + inset, y + inset);
    }
    graphics.lineTo(endX - inset, y + inset);
    if (roundTR) {
      graphics.arc(x + width - r - inset, y + r + inset, r, Math.PI * 1.5, 0, false);
    }
  }

  if (!hasEast) {
    const startY = roundTR ? y + r : y;
    const endY = roundBR ? y + height - r : y + height;
    if (!hasNorth || !roundTR) {
      if (hasNorth) {
        graphics.moveTo(x + width - inset, startY + inset);
      }
    }
    graphics.lineTo(x + width - inset, endY - inset);
    if (roundBR) {
      graphics.arc(x + width - r - inset, y + height - r - inset, r, 0, Math.PI / 2, false);
    }
  }

  if (!hasSouth) {
    const startX = roundBR ? x + width - r : x + width;
    const endX = roundBL ? x + r : x;
    if (!hasEast || !roundBR) {
      if (hasEast) {
        graphics.moveTo(startX - inset, y + height - inset);
      }
    }
    graphics.lineTo(endX + inset, y + height - inset);
    if (roundBL) {
      graphics.arc(x + r + inset, y + height - r - inset, r, Math.PI / 2, Math.PI, false);
    }
  }

  if (!hasWest) {
    const startY = roundBL ? y + height - r : y + height;
    const endY = roundTL ? y + r : y;
    if (!hasSouth || !roundBL) {
      if (hasSouth) {
        graphics.moveTo(x + inset, startY - inset);
      }
    }
    graphics.lineTo(x + inset, endY + inset);
    if (roundTL && hasNorth) {
      graphics.arc(x + r + inset, y + r + inset, r, Math.PI, Math.PI * 1.5, false);
    }
  }

  graphics.strokePath();

  graphics.lineStyle(1, COLORS.wallGlowInner, 0.5);
  const glowInset = borderWidth + 1;

  if (!hasNorth) {
    graphics.beginPath();
    graphics.moveTo(x + (roundTL ? r + glowInset : glowInset), y + glowInset);
    graphics.lineTo(x + width - (roundTR ? r + glowInset : glowInset), y + glowInset);
    graphics.strokePath();
  }
  if (!hasEast) {
    graphics.beginPath();
    graphics.moveTo(x + width - glowInset, y + (roundTR ? r + glowInset : glowInset));
    graphics.lineTo(x + width - glowInset, y + height - (roundBR ? r + glowInset : glowInset));
    graphics.strokePath();
  }
  if (!hasSouth) {
    graphics.beginPath();
    graphics.moveTo(x + width - (roundBR ? r + glowInset : glowInset), y + height - glowInset);
    graphics.lineTo(x + (roundBL ? r + glowInset : glowInset), y + height - glowInset);
    graphics.strokePath();
  }
  if (!hasWest) {
    graphics.beginPath();
    graphics.moveTo(x + glowInset, y + height - (roundBL ? r + glowInset : glowInset));
    graphics.lineTo(x + glowInset, y + (roundTL ? r + glowInset : glowInset));
    graphics.strokePath();
  }
}

/**
 * Draw a rectangle with selectively rounded corners using path
 * @param {Phaser.GameObjects.Graphics} graphics
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} width - Width
 * @param {number} height - Height
 * @param {object} radii - { tl, tr, bl, br } corner radii
 */
function drawRoundedRectWithSelectiveCorners(graphics, x, y, width, height, radii) {
  const { tl = 0, tr = 0, bl = 0, br = 0 } = radii;
  
  graphics.beginPath();
  
  // Start at top-left, after the corner radius
  graphics.moveTo(x + tl, y);
  
  // Top edge
  graphics.lineTo(x + width - tr, y);
  
  // Top-right corner
  if (tr > 0) {
    graphics.arc(x + width - tr, y + tr, tr, -Math.PI / 2, 0, false);
  }
  
  // Right edge
  graphics.lineTo(x + width, y + height - br);
  
  // Bottom-right corner
  if (br > 0) {
    graphics.arc(x + width - br, y + height - br, br, 0, Math.PI / 2, false);
  }
  
  // Bottom edge
  graphics.lineTo(x + bl, y + height);
  
  // Bottom-left corner
  if (bl > 0) {
    graphics.arc(x + bl, y + height - bl, bl, Math.PI / 2, Math.PI, false);
  }
  
  // Left edge
  graphics.lineTo(x, y + tl);
  
  // Top-left corner
  if (tl > 0) {
    graphics.arc(x + tl, y + tl, tl, Math.PI, Math.PI * 1.5, false);
  }
  
  graphics.closePath();
  graphics.fillPath();
}

/**
 * Draw decorative corner tile
 */
function drawCornerTile(graphics, x, y, corner) {
  // Base
  graphics.fillStyle(COLORS.floorBase, 1);
  graphics.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  
  const cornerSize = TILE_SIZE * 0.6;
  
  graphics.fillStyle(COLORS.decorGlowDim, 0.8);
  graphics.lineStyle(2, COLORS.decorGlow, 1);
  
  let points;
  switch (corner) {
    case 'TL':
      points = [x, y, x + cornerSize, y, x, y + cornerSize];
      break;
    case 'TR':
      points = [x + TILE_SIZE, y, x + TILE_SIZE - cornerSize, y, x + TILE_SIZE, y + cornerSize];
      break;
    case 'BL':
      points = [x, y + TILE_SIZE, x + cornerSize, y + TILE_SIZE, x, y + TILE_SIZE - cornerSize];
      break;
    case 'BR':
      points = [x + TILE_SIZE, y + TILE_SIZE, x + TILE_SIZE - cornerSize, y + TILE_SIZE, x + TILE_SIZE, y + TILE_SIZE - cornerSize];
      break;
  }
  
  graphics.fillTriangle(points[0], points[1], points[2], points[3], points[4], points[5]);
  graphics.strokeTriangle(points[0], points[1], points[2], points[3], points[4], points[5]);
}

// Export default configuration
export default {
  TILE_SIZE,
  TILES_PER_ROW,
  TOTAL_ROWS,
  TILESET_WIDTH,
  TILESET_HEIGHT,
  COLORS,
  NEIGHBOR,
  getWallTileIndex,
  generateTilesetTexture,
};
