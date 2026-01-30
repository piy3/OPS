import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react'
import Phaser from 'phaser'
import { MAZE_ROWS, MAZE_COLS, hasWrapAround, setMapLoader } from '../maze'
import { generateTilesetTexture, TILE_SIZE } from '../scripts/generateTileset'
import { TiledMapLoader, createDynamicTilemap } from '../utils/TiledMapLoader'
import { PLAYER_STATE, COMBAT_CONFIG } from '../context/CombatContext'
import log from '../utils/logger'

const PLAYER_SIZE_RATIO = 0.6 * 3  // 0.9 – base ratio 0.6, scaled 1.5x
// Phaser scene for player rendering with smooth interpolation
class PlayerScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PlayerScene' })
    this.players = new Map() // Map of playerId -> player game object
    this.playerTargets = new Map() // Map of playerId -> target position
    this.localPlayerId = null
    this.unicornId = null
    this.cellSize = 0
    this.mazeWidth = 0
    this.mazeHeight = 0
    this.interpolationSpeed = 8 // Exponential decay speed factor (higher = faster interpolation)
    
    // Particle system
    this.coinParticleEmitter = null
    this.particleTexture = null
    
    // Powerup aura system - Map of powerupId -> { container, emitters, tweens }
    this.powerupAuras = new Map()
    
    // Unicorn trail system
    this.unicornTrailEmitter = null
    this.unicornSparkleEmitter = null
    this.unicornTrailActive = false
    this.lastTrailPosition = { x: 0, y: 0 }
    
    // Tilemap system
    this.tilemap = null
    this.wallLayer = null
    this.groundLayer = null
    this.mapLoader = null
    this.tilesetGenerated = false
    this.renderMaze = true // Flag to control whether maze is rendered via Phaser
    
    // Local player rendering system
    this.localPlayerTargetGridPosRef = null  // Reference to target grid position - Phaser interpolates toward this
    this.localPlayerObj = null               // The local player's Phaser game object
    this.localPlayerCurrentPos = { x: 0, y: 0 }  // Current interpolated pixel position (managed by Phaser)
    this.localPlayerTarget = { x: 0, y: 0, row: 1, col: 1, lastRow: 1, lastCol: 1 }  // Target tracking for wrap detection
    this.renderLocalPlayer = false           // Whether to render local player in Phaser
    this.localPlayerState = {                // Local player state for visual effects
      facingDirection: 'right',
      health: 100,
      maxHealth: 100,
      isImmune: false,
      inIFrames: false,
      isFrozen: false,
      isKnockedBack: false
    }
    
    // Character system
    this.characterImageUrls = null           // Map of characterId -> image URL
    this.playerCharacters = {}               // Map of playerId -> characterId
    this.localPlayerCharacterId = null       // Local player's character ID
    this.characterTexturesLoaded = false     // Whether character textures have been loaded
    this.loadedCharacterTextures = new Set() // Set of loaded character texture keys
    
    // Local player name
    this.localPlayerName = null              // Local player's display name
    
    // Health data for remote players
    this.playersHealth = null                // Object of playerId -> health data
  }

  create() {
    // Scene is ready - calculate dimensions based on maze grid
    this.updateCellSize()
    
    // Generate tileset texture and create tilemap (if maze rendering is enabled)
    if (this.renderMaze) {
      this.createTilemap()
    }
    
    // Create particle texture for coin effects
    this.createParticleTextures()
    
    // Initialize coin particle emitter
    this.setupCoinParticles()
    
    // Load character textures if URLs are available
    if (this.characterImageUrls) {
      this.loadCharacterTextures()
    }
  }

  /**
   * Set character image URLs for texture loading
   * @param {Object} urls - Map of characterId -> imageUrl
   */
  setCharacterImageUrls(urls) {
    this.characterImageUrls = urls
    // If scene is already created, load textures now
    if (this.scene && this.scene.isActive('PlayerScene')) {
      this.loadCharacterTextures()
    }
  }

  /**
   * Set player characters map
   * @param {Object} characters - Map of playerId -> characterId
   */
  setPlayerCharacters(characters) {
    this.playerCharacters = characters || {}
  }

  /**
   * Set local player's character ID
   * @param {string} characterId - Character ID
   */
  setLocalPlayerCharacterId(characterId) {
    this.localPlayerCharacterId = characterId
  }

  /**
   * Set local player's display name
   * @param {string} name - Display name
   */
  setLocalPlayerName(name) {
    this.localPlayerName = name
  }

  /**
   * Set players health data for visual updates
   * @param {Object} healthData - Object of playerId -> health data
   */
  setPlayersHealth(healthData) {
    this.playersHealth = healthData
  }

  /**
   * Load character textures from URLs
   * Called when characterImageUrls are set
   */
  loadCharacterTextures() {
    if (!this.characterImageUrls || this.characterTexturesLoaded) return
    
    const urlsToLoad = []
    
    Object.entries(this.characterImageUrls).forEach(([characterId, url]) => {
      const textureKey = `char_${characterId}`
      // Only load if not already loaded
      if (!this.textures.exists(textureKey) && !this.loadedCharacterTextures.has(textureKey)) {
        urlsToLoad.push({ key: textureKey, url })
      }
    })
    
    if (urlsToLoad.length === 0) {
      this.characterTexturesLoaded = true
      return
    }
    
    // Load all textures
    urlsToLoad.forEach(({ key, url }) => {
      this.load.image(key, url)
      this.loadedCharacterTextures.add(key)
    })
    
    // Start loading and mark as loaded when complete
    this.load.once('complete', () => {
      this.characterTexturesLoaded = true
      log.log(`Character textures loaded: ${urlsToLoad.length}`)
      
      // Recreate local player with new textures if they exist
      if (this.localPlayerObj && this.renderLocalPlayer) {
        this.destroyLocalPlayer()
        this.createLocalPlayer()
      }
      
      // Recreate all remote players with new textures
      this.recreateAllRemotePlayers()
    })
    
    this.load.start()
  }

  /**
   * Recreate all remote players to apply character textures
   * Called after character textures are loaded
   */
  recreateAllRemotePlayers() {
    // Store current player data
    const playersToRecreate = []
    
    this.players.forEach((playerObj, playerId) => {
      // Skip local player - handled separately
      if (playerId === this.localPlayerId) return
      
      const target = this.playerTargets.get(playerId)
      if (target) {
        playersToRecreate.push({
          playerId,
          row: target.row,
          col: target.col,
          name: playerObj.getData('name'),
          direction: playerObj.getData('direction')
        })
      }
    })
    
    // Recreate each remote player
    playersToRecreate.forEach(({ playerId, row, col, name, direction }) => {
      // Remove old player
      this.removePlayer(playerId)
      
      // Create new player with character texture
      const isUnicorn = playerId === this.unicornId
      this.addPlayer(playerId, 0, 0, row, col, {
        name,
        direction,
        isUnicorn
      })
    })
    
    log.log(`Recreated ${playersToRecreate.length} remote players with character textures`)
  }

  /**
   * Get the character texture key for a player
   * If player is the unicorn, returns unicorn texture instead of their assigned character
   * @param {string} playerId - Player ID
   * @returns {string|null} Texture key or null if not available
   */
  getCharacterTextureKey(playerId) {
    // If player is the unicorn, use unicorn texture
    if (playerId === this.unicornId) {
      const unicornTextureKey = 'char_unicorn'
      if (this.textures.exists(unicornTextureKey)) {
        return unicornTextureKey
      }
    }
    
    const characterId = this.playerCharacters[playerId]
    if (!characterId) return null
    
    const textureKey = `char_${characterId}`
    if (this.textures.exists(textureKey)) {
      return textureKey
    }
    return null
  }

  /**
   * Get the local player's character texture key
   * If local player is the unicorn, returns unicorn texture instead
   * @returns {string|null} Texture key or null if not available
   */
  getLocalCharacterTextureKey() {
    // If local player is the unicorn, use unicorn texture
    if (this.localPlayerId === this.unicornId) {
      const unicornTextureKey = 'char_unicorn'
      if (this.textures.exists(unicornTextureKey)) {
        return unicornTextureKey
      }
    }
    
    const characterId = this.localPlayerCharacterId
    if (!characterId) return null
    
    const textureKey = `char_${characterId}`
    if (this.textures.exists(textureKey)) {
      return textureKey
    }
    return null
  }

  /**
   * Check if character textures are ready
   * @returns {boolean}
   */
  areCharacterTexturesReady() {
    return this.characterTexturesLoaded
  }

  /**
   * Generate the tileset texture dynamically and create the tilemap
   */
  createTilemap() {
    try {
      // Generate tileset texture using Phaser graphics
      generateTilesetTexture(this, 'maze-tiles')
      this.tilesetGenerated = true
      
      // Create map loader from maze array
      this.mapLoader = new TiledMapLoader()
      
      // Update the global map loader in maze.js for compatibility
      setMapLoader(this.mapLoader)
      
      // Create the tilemap using the generated tileset
      const result = createDynamicTilemap(this, this.mapLoader, 'maze-tiles')
      
      this.tilemap = result.tilemap
      this.groundLayer = result.layers.ground
      this.wallLayer = result.layers.walls
      
      // Set layer depths - maze should be behind everything
      if (this.groundLayer) {
        this.groundLayer.setDepth(0)
      }
      if (this.wallLayer) {
        this.wallLayer.setDepth(1)
      }
      
      // Scale tilemap to match cell size if needed
      this.updateTilemapScale()
      
      log.log('Tilemap created successfully')
    } catch (error) {
      log.error('Error creating tilemap:', error)
      this.renderMaze = false
    }
  }

  /**
   * Update tilemap scale to match the current cell size
   */
  updateTilemapScale() {
    if (!this.tilemap || !this.tilesetGenerated) return
    
    // Calculate scale factor
    const scale = this.cellSize / TILE_SIZE
    
    if (this.groundLayer) {
      this.groundLayer.setScale(scale)
    }
    if (this.wallLayer) {
      this.wallLayer.setScale(scale)
    }
  }

  /**
   * Enable or disable maze rendering
   * @param {boolean} enabled
   */
  setMazeRendering(enabled) {
    this.renderMaze = enabled
    
    if (this.groundLayer) {
      this.groundLayer.setVisible(enabled)
    }
    if (this.wallLayer) {
      this.wallLayer.setVisible(enabled)
    }
  }

  /**
   * Check if maze is being rendered via Phaser
   * @returns {boolean}
   */
  isMazeRendering() {
    return this.renderMaze && this.tilesetGenerated
  }

  createParticleTextures() {
    // Create a gold/yellow circular particle texture
    const graphics = this.add.graphics()
    
    // Coin particle - small glowing circle
    graphics.fillStyle(0xFFD700, 1) // Gold color
    graphics.fillCircle(8, 8, 6)
    graphics.fillStyle(0xFFF8DC, 1) // Light gold center
    graphics.fillCircle(8, 8, 3)
    graphics.generateTexture('coinParticle', 16, 16)
    graphics.destroy()
    
    // Create a star-shaped particle for extra sparkle
    const starGraphics = this.add.graphics()
    starGraphics.fillStyle(0xFFFF00, 1) // Bright yellow
    // Draw a simple 4-point star
    starGraphics.fillTriangle(6, 0, 8, 6, 10, 0)
    starGraphics.fillTriangle(12, 4, 6, 6, 12, 8)
    starGraphics.fillTriangle(6, 12, 8, 6, 10, 12)
    starGraphics.fillTriangle(0, 4, 6, 6, 0, 8)
    starGraphics.generateTexture('sparkleParticle', 12, 12)
    starGraphics.destroy()
    
    // Create powerup particle textures
    // Cyan/teal glowing particle for immunity powerup
    const powerupGraphics = this.add.graphics()
    powerupGraphics.fillStyle(0x00FFFF, 1) // Cyan
    powerupGraphics.fillCircle(8, 8, 6)
    powerupGraphics.fillStyle(0xE0FFFF, 1) // Light cyan center
    powerupGraphics.fillCircle(8, 8, 3)
    powerupGraphics.generateTexture('powerupParticle', 16, 16)
    powerupGraphics.destroy()
    
    // Diamond/gem shaped particle for powerup sparkle
    const gemGraphics = this.add.graphics()
    gemGraphics.fillStyle(0x00CED1, 1) // Dark cyan
    gemGraphics.fillTriangle(8, 0, 16, 8, 8, 16)
    gemGraphics.fillTriangle(8, 0, 0, 8, 8, 16)
    gemGraphics.fillStyle(0x40E0D0, 1) // Turquoise highlight
    gemGraphics.fillTriangle(8, 2, 14, 8, 8, 14)
    gemGraphics.generateTexture('gemParticle', 16, 16)
    gemGraphics.destroy()
    
    // Ring/halo particle for aura effect
    const ringGraphics = this.add.graphics()
    ringGraphics.lineStyle(2, 0x00FFFF, 1)
    ringGraphics.strokeCircle(8, 8, 6)
    ringGraphics.generateTexture('ringParticle', 16, 16)
    ringGraphics.destroy()
    
    // Unicorn trail particles - pink/magenta theme
    // Main trail particle - soft glowing circle
    const trailGraphics = this.add.graphics()
    trailGraphics.fillStyle(0xFF69B4, 1) // Hot pink
    trailGraphics.fillCircle(8, 8, 6)
    trailGraphics.fillStyle(0xFFB6C1, 1) // Light pink center
    trailGraphics.fillCircle(8, 8, 3)
    trailGraphics.generateTexture('unicornTrailParticle', 16, 16)
    trailGraphics.destroy()
    
    // Unicorn sparkle - small star shape
    const unicornSparkle = this.add.graphics()
    unicornSparkle.fillStyle(0xFF1493, 1) // Deep pink
    unicornSparkle.fillTriangle(6, 0, 8, 6, 10, 0)
    unicornSparkle.fillTriangle(12, 4, 6, 6, 12, 8)
    unicornSparkle.fillTriangle(6, 12, 8, 6, 10, 12)
    unicornSparkle.fillTriangle(0, 4, 6, 6, 0, 8)
    unicornSparkle.generateTexture('unicornSparkle', 12, 12)
    unicornSparkle.destroy()
    
    // Unicorn magic dust - tiny dots
    const dustGraphics = this.add.graphics()
    dustGraphics.fillStyle(0xFFFFFF, 1) // White
    dustGraphics.fillCircle(4, 4, 3)
    dustGraphics.fillStyle(0xFFC0CB, 0.8) // Pink tint
    dustGraphics.fillCircle(4, 4, 2)
    dustGraphics.generateTexture('unicornDust', 8, 8)
    dustGraphics.destroy()
  }

  setupCoinParticles() {
    // Create particle emitter for coin collection
    // Using Phaser 3.60+ particle system
    this.coinParticleEmitter = this.add.particles(0, 0, 'coinParticle', {
      speed: { min: 80, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 500,
      gravityY: 100,
      blendMode: 'ADD',
      emitting: false
    })
    
    // Create sparkle emitter for extra effect
    this.sparkleParticleEmitter = this.add.particles(0, 0, 'sparkleParticle', {
      speed: { min: 50, max: 150 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 400,
      rotate: { min: 0, max: 360 },
      blendMode: 'ADD',
      emitting: false
    })
    
    // Set high depth so particles appear above other elements
    this.coinParticleEmitter.setDepth(1000)
    this.sparkleParticleEmitter.setDepth(1000)
  }

  // Trigger coin collection particle burst at given grid position
  triggerCoinParticles(row, col) {
    if (!this.coinParticleEmitter || !this.sparkleParticleEmitter) return
    
    // Convert grid position to pixel position
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    // Move emitters to position and burst
    this.coinParticleEmitter.setPosition(pixelX, pixelY)
    this.sparkleParticleEmitter.setPosition(pixelX, pixelY)
    
    // Emit burst of particles
    this.coinParticleEmitter.explode(15) // 15 gold particles
    this.sparkleParticleEmitter.explode(8) // 8 sparkle particles
  }

  // Trigger powerup collection particles (can be extended for different powerup types)
  triggerPowerupParticles(row, col, type = 'immunity') {
    if (!this.coinParticleEmitter) return
    
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    // Create temporary emitter with different colors for powerup
    const powerupEmitter = this.add.particles(pixelX, pixelY, 'coinParticle', {
      speed: { min: 100, max: 250 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 600,
      gravityY: -50, // Float upward
      tint: type === 'immunity' ? 0x00FFFF : 0xFF00FF, // Cyan for immunity, magenta for others
      blendMode: 'ADD',
      emitting: false
    })
    
    powerupEmitter.setDepth(1000)
    powerupEmitter.explode(20)
    
    // Clean up emitter after particles finish
    this.time.delayedCall(700, () => {
      powerupEmitter.destroy()
    })
  }

  // ========== POWERUP AURA SYSTEM ==========

  // Add a persistent swirling aura around a powerup
  addPowerupAura(powerupId, row, col, type = 'immunity') {
    // Remove existing aura if any
    if (this.powerupAuras.has(powerupId)) {
      this.removePowerupAura(powerupId)
    }
    
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    // Get colors based on powerup type
    const colors = this.getPowerupColors(type)
    
    // Create a container to hold all aura elements
    const auraContainer = this.add.container(pixelX, pixelY)
    auraContainer.setDepth(5) // Below players but above maze
    
    // Create outer glow ring that pulses
    const glowRing = this.add.graphics()
    glowRing.lineStyle(3, colors.primary, 0.6)
    glowRing.strokeCircle(0, 0, this.cellSize * 0.45)
    auraContainer.add(glowRing)
    
    // Pulse the glow ring
    const glowTween = this.tweens.add({
      targets: glowRing,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0.2,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
    
    // Create swirling particle emitter - orbiting particles
    const orbitEmitter = this.add.particles(0, 0, 'powerupParticle', {
      speed: 0,
      lifespan: 2000,
      scale: { start: 0.6, end: 0.2 },
      alpha: { start: 0.8, end: 0.3 },
      tint: colors.primary,
      blendMode: 'ADD',
      emitting: true,
      frequency: 150,
      quantity: 1
    })
    orbitEmitter.setDepth(6)
    
    // Create sparkle emitter - random sparkles around powerup
    const sparkleEmitter = this.add.particles(pixelX, pixelY, 'gemParticle', {
      speed: { min: 10, max: 30 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 800,
      tint: colors.secondary,
      blendMode: 'ADD',
      emitting: true,
      frequency: 200,
      quantity: 1,
      radial: true,
      gravityY: -20
    })
    sparkleEmitter.setDepth(6)
    
    // Create rising particles effect
    const risingEmitter = this.add.particles(pixelX, pixelY, 'ringParticle', {
      speed: { min: 20, max: 40 },
      angle: { min: -100, max: -80 }, // Upward
      scale: { start: 0.4, end: 0.1 },
      alpha: { start: 0.7, end: 0 },
      lifespan: 1200,
      tint: colors.primary,
      blendMode: 'ADD',
      emitting: true,
      frequency: 300,
      quantity: 1
    })
    risingEmitter.setDepth(6)
    
    // Animate orbiting particles around the powerup
    const orbitAngle = { value: 0 }
    const orbitTween = this.tweens.add({
      targets: orbitAngle,
      value: 360,
      duration: 2000,
      repeat: -1,
      ease: 'Linear',
      onUpdate: () => {
        const rad = Phaser.Math.DegToRad(orbitAngle.value)
        const orbitRadius = this.cellSize * 0.35
        const ox = Math.cos(rad) * orbitRadius
        const oy = Math.sin(rad) * orbitRadius
        orbitEmitter.setPosition(pixelX + ox, pixelY + oy)
      }
    })
    
    // Store aura data for later cleanup
    this.powerupAuras.set(powerupId, {
      container: auraContainer,
      emitters: [orbitEmitter, sparkleEmitter, risingEmitter],
      tweens: [glowTween, orbitTween],
      glowRing: glowRing
    })
  }

  // Remove powerup aura
  removePowerupAura(powerupId) {
    const aura = this.powerupAuras.get(powerupId)
    if (!aura) return
    
    // Stop and destroy tweens
    aura.tweens.forEach(tween => {
      if (tween && tween.isPlaying) {
        tween.stop()
      }
    })
    
    // Stop and destroy emitters
    aura.emitters.forEach(emitter => {
      if (emitter) {
        emitter.stop()
        emitter.destroy()
      }
    })
    
    // Destroy container (includes glow ring)
    if (aura.container) {
      aura.container.destroy()
    }
    
    this.powerupAuras.delete(powerupId)
  }

  // Trigger collection burst effect
  triggerPowerupCollect(row, col, type = 'immunity') {
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    const colors = this.getPowerupColors(type)
    
    // Create implosion effect - particles spiral inward
    const implodeEmitter = this.add.particles(pixelX, pixelY, 'powerupParticle', {
      speed: { min: 150, max: 300 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 400,
      tint: colors.primary,
      blendMode: 'ADD',
      emitting: false
    })
    implodeEmitter.setDepth(1000)
    implodeEmitter.explode(25)
    
    // Create expanding ring effect
    const ringEmitter = this.add.particles(pixelX, pixelY, 'ringParticle', {
      speed: { min: 80, max: 150 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 500,
      tint: colors.secondary,
      blendMode: 'ADD',
      emitting: false
    })
    ringEmitter.setDepth(1000)
    ringEmitter.explode(12)
    
    // Create gem burst
    const gemEmitter = this.add.particles(pixelX, pixelY, 'gemParticle', {
      speed: { min: 100, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 600,
      rotate: { min: 0, max: 360 },
      tint: colors.primary,
      blendMode: 'ADD',
      gravityY: 50,
      emitting: false
    })
    gemEmitter.setDepth(1000)
    gemEmitter.explode(15)
    
    // Create flash effect
    const flash = this.add.circle(pixelX, pixelY, this.cellSize * 0.6, colors.primary, 0.8)
    flash.setDepth(999)
    flash.setBlendMode('ADD')
    
    this.tweens.add({
      targets: flash,
      scaleX: 2,
      scaleY: 2,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy()
    })
    
    // Cleanup emitters
    this.time.delayedCall(700, () => {
      implodeEmitter.destroy()
      ringEmitter.destroy()
      gemEmitter.destroy()
    })
  }

  // Get colors for powerup type
  getPowerupColors(type) {
    switch (type) {
      case 'immunity':
        return {
          primary: 0x00FFFF,   // Cyan
          secondary: 0x40E0D0  // Turquoise
        }
      case 'speed':
        return {
          primary: 0xFFFF00,   // Yellow
          secondary: 0xFFA500  // Orange
        }
      case 'damage':
        return {
          primary: 0xFF00FF,   // Magenta
          secondary: 0xFF69B4  // Pink
        }
      default:
        return {
          primary: 0x00FFFF,
          secondary: 0x40E0D0
        }
    }
  }

  // Update powerup aura position (if powerup moves, which it shouldn't but just in case)
  updatePowerupAuraPosition(powerupId, row, col) {
    const aura = this.powerupAuras.get(powerupId)
    if (!aura) return
    
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    aura.container.setPosition(pixelX, pixelY)
    aura.emitters.forEach((emitter, index) => {
      // Skip orbit emitter (index 0) as it's animated
      if (index > 0) {
        emitter.setPosition(pixelX, pixelY)
      }
    })
  }

  // Clear all powerup auras (for game reset)
  clearAllPowerupAuras() {
    this.powerupAuras.forEach((aura, powerupId) => {
      this.removePowerupAura(powerupId)
    })
  }

  // ========== UNICORN SPEED TRAIL SYSTEM ==========

  // Start the unicorn trail effect
  startUnicornTrail(playerId) {
    // Stop any existing trail
    this.stopUnicornTrail()
    
    // Get initial position
    let startX = this.mazeWidth / 2
    let startY = this.mazeHeight / 2
    
    // Try to get player position
    const playerObj = this.players.get(playerId)
    if (playerObj) {
      startX = playerObj.x
      startY = playerObj.y
    }
    
    this.lastTrailPosition = { x: startX, y: startY }
    
    // Create main trail emitter - follows behind the unicorn
    this.unicornTrailEmitter = this.add.particles(startX, startY, 'unicornTrailParticle', {
      speed: { min: 10, max: 30 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 300,
      blendMode: 'ADD',
      frequency: 20, // Emit every 20ms when moving
      quantity: 2,
      emitting: false // Start inactive, will emit based on movement
    })
    this.unicornTrailEmitter.setDepth(8)
    
    // Create sparkle emitter - magical sparkles
    this.unicornSparkleEmitter = this.add.particles(startX, startY, 'unicornSparkle', {
      speed: { min: 20, max: 50 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 400,
      rotate: { min: 0, max: 360 },
      blendMode: 'ADD',
      frequency: 50,
      quantity: 1,
      emitting: false
    })
    this.unicornSparkleEmitter.setDepth(8)
    
    // Create dust emitter - tiny particles for extra magic
    this.unicornDustEmitter = this.add.particles(startX, startY, 'unicornDust', {
      speed: { min: 5, max: 20 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 250,
      blendMode: 'ADD',
      frequency: 30,
      quantity: 1,
      emitting: false
    })
    this.unicornDustEmitter.setDepth(8)
    
    this.unicornTrailActive = true
  }

  // Update the unicorn trail position (for local unicorn)
  updateUnicornTrailPosition(pixelX, pixelY) {
    if (!this.unicornTrailActive) return
    
    // Calculate distance moved
    const dx = pixelX - this.lastTrailPosition.x
    const dy = pixelY - this.lastTrailPosition.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    
    // Only emit if moving (distance threshold)
    const isMoving = distance > 1
    
    // Update emitter positions
    if (this.unicornTrailEmitter) {
      this.unicornTrailEmitter.setPosition(pixelX, pixelY)
      this.unicornTrailEmitter.emitting = isMoving
    }
    
    if (this.unicornSparkleEmitter) {
      this.unicornSparkleEmitter.setPosition(pixelX, pixelY)
      this.unicornSparkleEmitter.emitting = isMoving
    }
    
    if (this.unicornDustEmitter) {
      this.unicornDustEmitter.setPosition(pixelX, pixelY)
      this.unicornDustEmitter.emitting = isMoving
    }
    
    // Update last position
    this.lastTrailPosition = { x: pixelX, y: pixelY }
  }

  // Update trail for remote unicorn based on their player object
  updateRemoteUnicornTrail() {
    if (!this.unicornTrailActive || !this.unicornId) return
    
    // Skip if unicorn is local player
    if (this.unicornId === this.localPlayerId) return
    
    const playerObj = this.players.get(this.unicornId)
    if (playerObj) {
      this.updateUnicornTrailPosition(playerObj.x, playerObj.y)
    }
  }

  // Stop the unicorn trail effect
  stopUnicornTrail() {
    this.unicornTrailActive = false
    
    if (this.unicornTrailEmitter) {
      this.unicornTrailEmitter.stop()
      this.unicornTrailEmitter.destroy()
      this.unicornTrailEmitter = null
    }
    
    if (this.unicornSparkleEmitter) {
      this.unicornSparkleEmitter.stop()
      this.unicornSparkleEmitter.destroy()
      this.unicornSparkleEmitter = null
    }
    
    if (this.unicornDustEmitter) {
      this.unicornDustEmitter.stop()
      this.unicornDustEmitter.destroy()
      this.unicornDustEmitter = null
    }
  }

  // Trigger a burst of particles (for special moments like becoming unicorn)
  triggerUnicornBurst(pixelX, pixelY) {
    // Create a celebratory burst when becoming the unicorn
    const burstEmitter = this.add.particles(pixelX, pixelY, 'unicornTrailParticle', {
      speed: { min: 100, max: 250 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 600,
      tint: [0xFF69B4, 0xFF1493, 0xFFB6C1, 0xFFFFFF],
      blendMode: 'ADD',
      emitting: false
    })
    burstEmitter.setDepth(1000)
    burstEmitter.explode(30)
    
    // Sparkle burst
    const sparkleBurst = this.add.particles(pixelX, pixelY, 'unicornSparkle', {
      speed: { min: 80, max: 180 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 500,
      rotate: { min: 0, max: 360 },
      tint: [0xFF69B4, 0xFF1493],
      blendMode: 'ADD',
      emitting: false
    })
    sparkleBurst.setDepth(1000)
    sparkleBurst.explode(20)
    
    // Cleanup
    this.time.delayedCall(700, () => {
      burstEmitter.destroy()
      sparkleBurst.destroy()
    })
  }

  // Check if trail is active
  isUnicornTrailActive() {
    return this.unicornTrailActive
  }

  // Trigger hit/damage particles
  triggerHitParticles(row, col) {
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    const hitEmitter = this.add.particles(pixelX, pixelY, 'coinParticle', {
      speed: { min: 60, max: 150 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 300,
      tint: 0xFF0000, // Red for damage
      blendMode: 'ADD',
      emitting: false
    })
    
    hitEmitter.setDepth(1000)
    hitEmitter.explode(12)
    
    this.time.delayedCall(400, () => {
      hitEmitter.destroy()
    })
  }

  // ========== FLOATING NUMBER POPUPS ==========

  // Show damage number floating up (red)
  showDamageNumber(row, col, amount) {
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    // Random horizontal drift (-20 to +20 pixels)
    const randomDriftX = (Math.random() - 0.5) * 40
    
    // Create the damage text
    const damageText = this.add.text(pixelX, pixelY, `-${amount}`, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: `${Math.max(16, this.cellSize * 0.5)}px`,
      fontStyle: 'bold',
      color: '#FF3333',
      stroke: '#000000',
      strokeThickness: 4,
      shadow: {
        offsetX: 2,
        offsetY: 2,
        color: '#000000',
        blur: 4,
        fill: true
      }
    })
    
    damageText.setOrigin(0.5, 0.5)
    damageText.setDepth(2000) // Above everything else
    
    // Animate: float up with drift, scale up slightly then down, fade out
    this.tweens.add({
      targets: damageText,
      y: pixelY - this.cellSize * 1.5, // Float up
      x: pixelX + randomDriftX, // Drift horizontally
      alpha: { from: 1, to: 0 },
      scale: { from: 0.5, to: 1.2 },
      duration: 1000,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        damageText.destroy()
      }
    })
    
    // Add a slight bounce/shake effect at the start
    this.tweens.add({
      targets: damageText,
      scale: { from: 1.5, to: 1 },
      duration: 150,
      ease: 'Back.easeOut'
    })
  }

  // Show coin collection number floating up (gold)
  showCoinNumber(row, col, value) {
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    // Slight random horizontal offset for variety
    const randomOffsetX = (Math.random() - 0.5) * 20
    
    // Create the coin value text
    const coinText = this.add.text(pixelX + randomOffsetX, pixelY, `+${value}`, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: `${Math.max(18, this.cellSize * 0.55)}px`,
      fontStyle: 'bold',
      color: '#FFD700', // Gold
      stroke: '#8B4513', // Dark gold/brown stroke
      strokeThickness: 4,
      shadow: {
        offsetX: 2,
        offsetY: 2,
        color: '#000000',
        blur: 4,
        fill: true
      }
    })
    
    coinText.setOrigin(0.5, 0.5)
    coinText.setDepth(2000)
    
    // Animate: float up, scale up, fade out
    this.tweens.add({
      targets: coinText,
      y: pixelY - this.cellSize * 1.8, // Float up more than damage
      alpha: { from: 1, to: 0 },
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        coinText.destroy()
      }
    })
    
    // Initial pop-in scale animation
    this.tweens.add({
      targets: coinText,
      scale: { from: 0.3, to: 1.3 },
      duration: 200,
      ease: 'Back.easeOut',
      yoyo: true,
      hold: 100
    })
  }

  // Show generic floating text (can be used for other events)
  showFloatingText(row, col, text, options = {}) {
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    const {
      color = '#FFFFFF',
      strokeColor = '#000000',
      fontSize = this.cellSize * 0.2,
      duration = 1000,
      floatDistance = this.cellSize * 1.5,
      driftX = 0
    } = options
    
    const floatText = this.add.text(pixelX, pixelY, text, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: `${Math.max(14, fontSize)}px`,
      fontStyle: 'bold',
      color: color,
      stroke: strokeColor,
      strokeThickness: 3,
      shadow: {
        offsetX: 1,
        offsetY: 1,
        color: '#000000',
        blur: 3,
        fill: true
      }
    })
    
    floatText.setOrigin(0.5, 0.5)
    floatText.setDepth(2000)
    
    this.tweens.add({
      targets: floatText,
      y: pixelY - floatDistance,
      x: pixelX + driftX,
      alpha: { from: 1, to: 0 },
      scale: { from: 1, to: 1.2 },
      duration: duration,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        floatText.destroy()
      }
    })
  }

  updateCellSize() {
    this.cellSize = Math.min(this.scale.width / MAZE_COLS, this.scale.height / MAZE_ROWS)
    this.mazeWidth = this.cellSize * MAZE_COLS
    this.mazeHeight = this.cellSize * MAZE_ROWS
  }

  updateDimensions() {
    this.updateCellSize()
    
    // Update tilemap scale
    this.updateTilemapScale()
    
    // Update all player positions based on new dimensions
    this.players.forEach((playerObj, playerId) => {
      const target = this.playerTargets.get(playerId)
      if (target) {
        const newX = target.col * this.cellSize + this.cellSize / 2
        const newY = target.row * this.cellSize + this.cellSize / 2
        playerObj.x = newX
        playerObj.y = newY
        target.x = newX
        target.y = newY
        
        // Also update the player visual size
        this.updatePlayerSize(playerObj)
      }
    })
    
    // Recreate local player with new dimensions
    if (this.renderLocalPlayer && this.localPlayerObj) {
      this.destroyLocalPlayer()
      this.createLocalPlayer()
    }
  }

  updatePlayerSize(playerObj) {
    const playerSize = this.cellSize * PLAYER_SIZE_RATIO
    const body = playerObj.getData('body')
    if (body) {
      const isUnicorn = playerObj.getData('playerId') === this.unicornId
      const isLocal = playerObj.getData('playerId') === this.localPlayerId
      const color = isLocal ? 0x4CAF50 : (isUnicorn ? 0xFF69B4 : 0x2196F3)
      
      body.clear()
      body.fillStyle(color, 1)
      body.fillCircle(0, 0, playerSize / 2)
      body.lineStyle(2, isUnicorn ? 0xFF1493 : 0xFFFFFF, 1)
      body.strokeCircle(0, 0, playerSize / 2)
    }
  }

  setLocalPlayerId(playerId) {
    this.localPlayerId = playerId
  }

  setUnicornId(unicornId) {
    this.unicornId = unicornId
    // Update player visuals based on unicorn status
    this.players.forEach((playerObj, playerId) => {
      this.updatePlayerVisual(playerId, playerObj)
    })
    // Also update local player visual if it exists
    if (this.localPlayerObj) {
      this.updateLocalPlayerVisual()
    }
  }

    /**
   * Create a dashed circle graphic for i-frames (tagged) state. Caller must add to container and rotate in update().
   * @param {number} radius - Circle radius (e.g. playerSize/2 + 4)
   * @param {number} [lineWidth=2] - Line width
   * @param {number} [color=0xffffff] - Hex color
   * @param {number} [alpha=0.8] - Line alpha
   * @returns {Phaser.GameObjects.Graphics}
   */
    createIframesDashedRing(radius, lineWidth = 2, color = 0xffffff, alpha = 0.8) {
      const graphics = this.add.graphics()
      graphics.lineStyle(lineWidth, color, alpha)
      const segments = 12
      const segmentAngle = (2 * Math.PI) / segments
      const dashRatio = 0.6
      const dashAngle = segmentAngle * dashRatio
      for (let i = 0; i < segments; i++) {
        const start = i * segmentAngle
        graphics.beginPath()
        graphics.arc(0, 0, radius, start, start + dashAngle, false)
        graphics.strokePath()
      }
      return graphics
    }

  // ========== LOCAL PLAYER RENDERING SYSTEM ==========

  /**
   * Set the reference to the local player's target grid position
   * Phaser will interpolate toward this position every frame for smooth movement
   */
  setLocalPlayerTargetGridPosRef(ref) {
    this.localPlayerTargetGridPosRef = ref
  }

  /**
   * Enable or disable local player rendering in Phaser
   */
  setRenderLocalPlayer(enabled) {
    this.renderLocalPlayer = enabled
    
    if (enabled && !this.localPlayerObj && this.localPlayerId) {
      // Create local player if it doesn't exist
      this.createLocalPlayer()
    } else if (!enabled && this.localPlayerObj) {
      // Destroy local player if rendering is disabled
      this.destroyLocalPlayer()
    }
  }

  /**
   * Update local player state (health, immunity, facing direction, etc.)
   */
  updateLocalPlayerState(state) {
    Object.assign(this.localPlayerState, state)
    
    // Update visuals if player exists
    if (this.localPlayerObj) {
      this.updateLocalPlayerVisual()
    }
  }

  /**
   * Create the local player game object
   */
  createLocalPlayer() {
    if (this.localPlayerObj) {
      this.destroyLocalPlayer()
    }
    
    if (!this.localPlayerId) return
    
    const isUnicorn = this.localPlayerId === this.unicornId
    const state = this.localPlayerState
    
    // Get initial position from target grid ref or use default
    let pixelX = this.mazeWidth / 2
    let pixelY = this.mazeHeight / 2
    let initRow = 1
    let initCol = 1
    
    if (this.localPlayerTargetGridPosRef && this.localPlayerTargetGridPosRef.current) {
      initRow = this.localPlayerTargetGridPosRef.current.row
      initCol = this.localPlayerTargetGridPosRef.current.col
      pixelX = initCol * this.cellSize + this.cellSize / 2
      pixelY = initRow * this.cellSize + this.cellSize / 2
    }
    
    // Initialize current position and target tracking (same structure as remote players)
    this.localPlayerCurrentPos = { x: pixelX, y: pixelY }
    this.localPlayerTarget = {
      x: pixelX,
      y: pixelY,
      row: initRow,
      col: initCol,
      lastRow: initRow,
      lastCol: initCol
    }
    
    // Create the player container with all visual elements
    const container = this.add.container(pixelX, pixelY)
    container.setDepth(100) // Ensure local player is always visible above remote players
    
    const playerSize = this.cellSize * PLAYER_SIZE_RATIO
    
    // Try to use character texture, fallback to circle
    const textureKey = this.getLocalCharacterTextureKey()
    let body
    
    if (textureKey) {
      // Use character image (unicorn uses unicorn.png, others use their assigned character)
      body = this.add.image(0, 0, textureKey)
        .setOrigin(0.5, 0.5)
        .setDisplaySize(playerSize, playerSize)
      
      container.setData('isImageBody', true)
      container.setData('currentTextureKey', textureKey)
    } else {
      // Fallback to circle graphics
      const color = 0x4CAF50 // Green for local player
      body = this.add.graphics()
      body.fillStyle(isUnicorn ? 0xFF69B4 : color, 1)
      body.fillCircle(0, 0, playerSize / 2)
      body.lineStyle(2, isUnicorn ? 0xFF1493 : 0xFFFFFF, 1)
      body.strokeCircle(0, 0, playerSize / 2)
      
      container.setData('isImageBody', false)
    }
    container.add(body)
    
    // Unicorn rotating pink dashed ring (keep visual effect, emoji now in name text)
    if (isUnicorn) {
      const unicornRing = this.createIframesDashedRing(playerSize / 2 + 6, 3, 0xFF69B4, 0.9)
      container.add(unicornRing)
      container.setData('unicornRing', unicornRing)
    }
    
    // Player name text (positioned at top, above player)
    // Always show "You" for local player (other players see our actual name on their screens)
    const playerName = 'You'
    const isFrozen = state.isFrozen
    const namePrefix = isUnicorn ? '🦄 ' : (isFrozen ? '❄️ ' : '')
    const nameText = this.add.text(0, -playerSize / 2 - 8, namePrefix + playerName, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: isUnicorn ? '#FF69B4' : '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 4, fill: true }
    }).setOrigin(0.5, 1)
    container.add(nameText)
    container.setData('nameText', nameText)
    container.setData('name', playerName)
    
    // Immunity shield (visual ring)
    if (state.isImmune) {
      const shield = this.add.graphics()
      shield.lineStyle(3, 0x00FFFF, 0.8)
      shield.strokeCircle(0, 0, playerSize / 2 + 5)
      container.add(shield)
      container.setData('shield', shield)
    }
    
    // Frozen overlay
    if (state.isFrozen) {
      const frozenOverlay = this.add.graphics()
      frozenOverlay.fillStyle(0x87CEEB, 0.5)
      frozenOverlay.fillCircle(0, 0, playerSize / 2 + 3)
      container.add(frozenOverlay)
      container.setData('frozenOverlay', frozenOverlay)
      
      // Add frozen text above
      const frozenText = this.add.text(0, -playerSize / 2 - 15, '❄️', {
        fontSize: `${playerSize * 0.5}px`,
      }).setOrigin(0.5, 0.5)
      container.add(frozenText)
      container.setData('frozenText', frozenText)
    }
    
    // Health bar (only for survivors, not unicorn)
    if (!isUnicorn) {
      const healthBarWidth = playerSize * 1.2
      const healthBarHeight = 4
      const healthBarY = -playerSize / 2 - 8
      
      // Background
      const healthBg = this.add.graphics()
      healthBg.fillStyle(0x333333, 1)
      healthBg.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight)
      container.add(healthBg)
      
      // Health fill
      const healthPercent = state.health / state.maxHealth
      const healthColor = healthPercent <= 0.3 ? 0xFF0000 : (healthPercent <= 0.6 ? 0xFFAA00 : 0x00FF00)
      const healthFill = this.add.graphics()
      healthFill.fillStyle(healthColor, 1)
      healthFill.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth * healthPercent, healthBarHeight)
      container.add(healthFill)
      
      container.setData('healthFill', healthFill)
      container.setData('healthBg', healthBg)
      container.setData('healthBarWidth', healthBarWidth)
      container.setData('healthBarHeight', healthBarHeight)
      container.setData('healthBarY', healthBarY)
    }
    
    // I-frames effect (blinking/transparency)
    if (state.inIFrames) {
      container.setAlpha(0.5)
      const iframesRing = this.createIframesDashedRing(playerSize / 2 + 4)
      container.add(iframesRing)
      container.setData('iframesRing', iframesRing)
    }
    
    container.setData('body', body)
    container.setData('playerId', this.localPlayerId)
    container.setData('isLocalPlayer', true)
    
    this.localPlayerObj = container
    
    return container
  }

  /**
   * Update the local player's visual elements (called when state changes)
   */
  updateLocalPlayerVisual() {
    if (!this.localPlayerObj) return
    
    const container = this.localPlayerObj
    const state = this.localPlayerState
    const isUnicorn = this.localPlayerId === this.unicornId
    const playerSize = this.cellSize * PLAYER_SIZE_RATIO
    const isImageBody = container.getData('isImageBody')
    
    // Update body based on type
    const body = container.getData('body')
    const currentTextureKey = container.getData('currentTextureKey')
    const expectedTextureKey = this.getLocalCharacterTextureKey()
    
    if (body) {
      if (isImageBody) {
        // Check if texture needs to be swapped (unicorn status changed)
        if (expectedTextureKey && currentTextureKey !== expectedTextureKey) {
          // Swap texture
          body.setTexture(expectedTextureKey)
          container.setData('currentTextureKey', expectedTextureKey)
        }
        // Clear any tint - unicorn now uses unicorn.png directly
        body.clearTint()
        body.setDisplaySize(playerSize, playerSize)
      } else {
        // For graphics body, redraw the circle
        body.clear()
        body.fillStyle(isUnicorn ? 0xFF69B4 : 0x4CAF50, 1)
        body.fillCircle(0, 0, playerSize / 2)
        body.lineStyle(2, isUnicorn ? 0xFF1493 : 0xFFFFFF, 1)
        body.strokeCircle(0, 0, playerSize / 2)
      }
    }
    
    // Update name text prefix based on unicorn/frozen status
    const existingNameText = container.getData('nameText')
    if (existingNameText) {
      // Always show "You" for local player
      const namePrefix = isUnicorn ? '🦄 ' : (state.isFrozen ? '❄️ ' : '')
      existingNameText.setText(namePrefix + 'You')
      existingNameText.setColor(isUnicorn ? '#FF69B4' : '#ffffff')
    }
    
    // Update or create unicorn rotating pink ring
    const existingUnicornRing = container.getData('unicornRing')
    if (isUnicorn && !existingUnicornRing) {
      const unicornRing = this.createIframesDashedRing(playerSize / 2 + 6, 3, 0xFF69B4, 0.9)
      container.add(unicornRing)
      container.setData('unicornRing', unicornRing)
    } else if (!isUnicorn && existingUnicornRing) {
      existingUnicornRing.destroy()
      container.setData('unicornRing', null)
    }
    
    // Update immunity shield
    const existingShield = container.getData('shield')
    if (state.isImmune && !existingShield) {
      const shield = this.add.graphics()
      shield.lineStyle(3, 0x00FFFF, 0.8)
      shield.strokeCircle(0, 0, playerSize / 2 + 5)
      container.add(shield)
      container.setData('shield', shield)
    } else if (!state.isImmune && existingShield) {
      existingShield.destroy()
      container.setData('shield', null)
    }
    
    // Update frozen overlay
    const existingFrozen = container.getData('frozenOverlay')
    const existingFrozenText = container.getData('frozenText')
    if (state.isFrozen && !existingFrozen) {
      const frozenOverlay = this.add.graphics()
      frozenOverlay.fillStyle(0x87CEEB, 0.5)
      frozenOverlay.fillCircle(0, 0, playerSize / 2 + 3)
      container.add(frozenOverlay)
      container.setData('frozenOverlay', frozenOverlay)
      
      const frozenText = this.add.text(0, -playerSize / 2 - 15, '❄️', {
        fontSize: `${playerSize * 0.5}px`,
      }).setOrigin(0.5, 0.5)
      container.add(frozenText)
      container.setData('frozenText', frozenText)
    } else if (!state.isFrozen && existingFrozen) {
      existingFrozen.destroy()
      container.setData('frozenOverlay', null)
      if (existingFrozenText) {
        existingFrozenText.destroy()
        container.setData('frozenText', null)
      }
    }
    
    // Update health bar (only for non-unicorn)
    if (!isUnicorn) {
      const healthFill = container.getData('healthFill')
      const healthBg = container.getData('healthBg')
      const healthBarWidth = container.getData('healthBarWidth') || playerSize * 1.2
      const healthBarHeight = container.getData('healthBarHeight') || 4
      const healthBarY = container.getData('healthBarY') || -playerSize / 2 - 8
      
      if (healthFill) {
        healthFill.clear()
        const healthPercent = Math.max(0, Math.min(1, state.health / state.maxHealth))
        const healthColor = healthPercent <= 0.3 ? 0xFF0000 : (healthPercent <= 0.6 ? 0xFFAA00 : 0x00FF00)
        healthFill.fillStyle(healthColor, 1)
        healthFill.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth * healthPercent, healthBarHeight)
      } else if (!healthBg) {
        // Create health bar if it doesn't exist
        const newHealthBg = this.add.graphics()
        newHealthBg.fillStyle(0x333333, 1)
        newHealthBg.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight)
        container.add(newHealthBg)
        
        const healthPercent = Math.max(0, Math.min(1, state.health / state.maxHealth))
        const healthColor = healthPercent <= 0.3 ? 0xFF0000 : (healthPercent <= 0.6 ? 0xFFAA00 : 0x00FF00)
        const newHealthFill = this.add.graphics()
        newHealthFill.fillStyle(healthColor, 1)
        newHealthFill.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth * healthPercent, healthBarHeight)
        container.add(newHealthFill)
        
        container.setData('healthFill', newHealthFill)
        container.setData('healthBg', newHealthBg)
        container.setData('healthBarWidth', healthBarWidth)
        container.setData('healthBarHeight', healthBarHeight)
        container.setData('healthBarY', healthBarY)
      }
    } else {
      // Remove health bar if player became unicorn
      const healthFill = container.getData('healthFill')
      const healthBg = container.getData('healthBg')
      if (healthFill) {
        healthFill.destroy()
        container.setData('healthFill', null)
      }
      if (healthBg) {
        healthBg.destroy()
        container.setData('healthBg', null)
      }
    }
    
    // Update i-frames alpha
    container.setAlpha(state.inIFrames ? 0.5 : 1)

    // Update i-frames dashed ring
    const existingIframesRing = container.getData('iframesRing')
    if (state.inIFrames && !existingIframesRing) {
      const iframesRing = this.createIframesDashedRing(playerSize / 2 + 4)
      container.add(iframesRing)
      container.setData('iframesRing', iframesRing)
    } else if (!state.inIFrames && existingIframesRing) {
      existingIframesRing.destroy()
      container.setData('iframesRing', null)
    }
    
    // Apply facing direction rotation for unicorn (only for non-image bodies)
    if (isUnicorn && !isImageBody) {
      const rotation = this.getDirectionRotation(state.facingDirection)
      container.setRotation(rotation)
    } else {
      container.setRotation(0)
    }
  }

  /**
   * Get rotation angle for facing direction
   */
  getDirectionRotation(direction) {
    switch (direction) {
      case 'up': return -Math.PI / 2
      case 'down': return Math.PI / 2
      case 'left': return Math.PI
      case 'right':
      default: return 0
    }
  }

  /**
   * Destroy the local player game object
   */
  destroyLocalPlayer() {
    if (this.localPlayerObj) {
      this.localPlayerObj.destroy()
      this.localPlayerObj = null
    }
  }

  /**
   * Update local player position with smooth interpolation (called every frame in update())
   * This mirrors EXACTLY how remote players are interpolated for consistent smoothness
   */
  updateLocalPlayerPosition(delta) {
    if (!this.renderLocalPlayer || !this.localPlayerObj || !this.localPlayerTargetGridPosRef) return
    
    const targetGridPos = this.localPlayerTargetGridPosRef.current
    if (!targetGridPos) return
    
    const newRow = targetGridPos.row
    const newCol = targetGridPos.col
    const target = this.localPlayerTarget
    const currentPos = this.localPlayerCurrentPos
    
    // Check if grid position changed (new target)
    if (newRow !== target.row || newCol !== target.col) {
      // Calculate new target pixel position from grid
      const newPixelX = newCol * this.cellSize + this.cellSize / 2
      const newPixelY = newRow * this.cellSize + this.cellSize / 2
      
      // Detect wrap-around (same logic as remote players)
      const colDiff = newCol - target.lastCol
      let adjustedTargetX = newPixelX
      
      if (hasWrapAround(newRow) && hasWrapAround(target.row)) {
        // Detect wrap from right to left (31 -> 0)
        if (colDiff < -MAZE_COLS / 2 || (target.lastCol === MAZE_COLS - 1 && newCol === 0)) {
          // Player wrapped from right edge to left edge
          // Snap current position to right side if on left, then move toward off-screen right
          if (currentPos.x < this.mazeWidth / 2) {
            currentPos.x += this.mazeWidth
          }
          adjustedTargetX = newPixelX + this.mazeWidth
        }
        // Detect wrap from left to right (0 -> 31)
        else if (colDiff > MAZE_COLS / 2 || (target.lastCol === 0 && newCol === MAZE_COLS - 1)) {
          // Player wrapped from left edge to right edge
          // Snap current position to left side if on right, then move toward off-screen left
          if (currentPos.x > this.mazeWidth / 2) {
            currentPos.x -= this.mazeWidth
          }
          adjustedTargetX = newPixelX - this.mazeWidth
        }
      }
      
      // Update target tracking
      target.x = adjustedTargetX
      target.y = newPixelY
      target.lastRow = target.row
      target.lastCol = target.col
      target.row = newRow
      target.col = newCol
    }
    
    // Smooth exponential interpolation toward target (same as remote players)
    let targetX = target.x
    let targetY = target.y
    
    // Handle wrap-around interpolation (same as remote player update loop)
    if (hasWrapAround(target.row)) {
      // Choose shortest path for wrap-around
      const dxNormal = targetX - currentPos.x
      const dxWrappedLeft = (targetX + this.mazeWidth) - currentPos.x
      const dxWrappedRight = (targetX - this.mazeWidth) - currentPos.x
      
      if (Math.abs(dxWrappedLeft) < Math.abs(dxNormal) && targetX < currentPos.x) {
        targetX += this.mazeWidth
      } else if (Math.abs(dxWrappedRight) < Math.abs(dxNormal) && targetX > currentPos.x) {
        targetX -= this.mazeWidth
      }
    }
    
    const dx = targetX - currentPos.x
    const dy = targetY - currentPos.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    
    if (distance > 0.5) {
      // Use exponential smoothing for frame-rate independent interpolation
      const dt = delta / 1000 // Convert delta ms to seconds
      const factor = 1 - Math.exp(-this.interpolationSpeed * dt)
      currentPos.x += dx * factor
      currentPos.y += dy * factor
    } else {
      // Snap when very close
      currentPos.x = target.col * this.cellSize + this.cellSize / 2
      currentPos.y = target.row * this.cellSize + this.cellSize / 2
    }
    
    // Normalize position after interpolation (handle wrap-around)
    if (hasWrapAround(target.row)) {
      while (currentPos.x < 0) currentPos.x += this.mazeWidth
      while (currentPos.x >= this.mazeWidth) currentPos.x -= this.mazeWidth
    }
    
    // Update the Phaser game object position
    this.localPlayerObj.x = currentPos.x
    this.localPlayerObj.y = currentPos.y
  }

  createPlayerGraphic(isUnicorn, isLocal, health, maxHealth, inIFrames, isFrozen, hasImmunity, isKnockedBack, playerId = null, playerName = null) {
    const container = this.add.container(0, 0)
    
    const playerSize = this.cellSize * PLAYER_SIZE_RATIO
    
    // Try to use character texture, fallback to circle
    const textureKey = playerId ? this.getCharacterTextureKey(playerId) : null
    let body
    
    if (textureKey) {
      // Use character image (unicorn uses unicorn.png, others use their assigned character)
      body = this.add.image(0, 0, textureKey)
        .setOrigin(0.5, 0.5)
        .setDisplaySize(playerSize, playerSize)
      
      container.setData('isImageBody', true)
      container.setData('currentTextureKey', textureKey)
    } else {
      // Fallback to circle graphics
      const color = isLocal ? 0x4CAF50 : (isUnicorn ? 0xFF69B4 : 0x2196F3)
      
      body = this.add.graphics()
      body.fillStyle(color, 1)
      body.fillCircle(0, 0, playerSize / 2)
      
      // Add border
      body.lineStyle(2, isUnicorn ? 0xFF1493 : 0xFFFFFF, 1)
      body.strokeCircle(0, 0, playerSize / 2)
      
      container.setData('isImageBody', false)
    }
    
    container.add(body)
    
    // Unicorn rotating pink dashed ring (keep visual effect, emoji now in name text)
    if (isUnicorn) {
      const unicornRing = this.createIframesDashedRing(playerSize / 2 + 6, 3, 0xFF69B4, 0.9)
      container.add(unicornRing)
      container.setData('unicornRing', unicornRing)
    }
    
    // Player name text (positioned at top, above player)
    const displayName = playerName || 'Player'
    const namePrefix = isUnicorn ? '🦄 ' : (isFrozen ? '❄️ ' : '')
    const nameText = this.add.text(0, -playerSize / 2 - 8, namePrefix + displayName, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: isUnicorn ? '#FF69B4' : '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 4, fill: true }
    }).setOrigin(0.5, 1)
    container.add(nameText)
    container.setData('nameText', nameText)
    container.setData('name', displayName)
    
    // Immunity shield
    if (hasImmunity) {
      const shield = this.add.graphics()
      shield.lineStyle(3, 0x00FFFF, 0.8)
      shield.strokeCircle(0, 0, playerSize / 2 + 5)
      container.add(shield)
      container.setData('shield', shield)
    }
    
    // I-frames effect (blinking)
    if (inIFrames) {
      container.setAlpha(0.5)
      const iframesRing = this.createIframesDashedRing(playerSize / 2 + 4)
      container.add(iframesRing)
      container.setData('iframesRing', iframesRing)
    }
    
    // Frozen effect
    if (isFrozen) {
      const frozenOverlay = this.add.graphics()
      frozenOverlay.fillStyle(0x87CEEB, 0.5)
      frozenOverlay.fillCircle(0, 0, playerSize / 2 + 3)
      container.add(frozenOverlay)
    }
    
    // Health bar for survivors (not unicorn)
    if (!isUnicorn && health !== undefined && maxHealth !== undefined) {
      const healthBarWidth = playerSize * 1.2
      const healthBarHeight = 4
      const healthBarY = -playerSize / 2 - 8
      
      // Background
      const healthBg = this.add.graphics()
      healthBg.fillStyle(0x333333, 1)
      healthBg.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight)
      container.add(healthBg)
      
      // Health fill
      const healthPercent = health / maxHealth
      const healthColor = healthPercent <= 0.3 ? 0xFF0000 : (healthPercent <= 0.6 ? 0xFFAA00 : 0x00FF00)
      const healthFill = this.add.graphics()
      healthFill.fillStyle(healthColor, 1)
      healthFill.fillRect(-healthBarWidth / 2, healthBarY, healthBarWidth * healthPercent, healthBarHeight)
      container.add(healthFill)
      
      container.setData('healthFill', healthFill)
      container.setData('healthBg', healthBg)
    }
    
    container.setData('body', body)
    
    return container
  }

  updatePlayerVisual(playerId, playerObj) {
    const target = this.playerTargets.get(playerId)
    if (!target) return
    
    const isUnicorn = playerId === this.unicornId
    const isLocal = playerId === this.localPlayerId
    const playerSize = this.cellSize * PLAYER_SIZE_RATIO
    const isImageBody = playerObj.getData('isImageBody')
    
    // Update body based on type
    const body = playerObj.getData('body')
    const currentTextureKey = playerObj.getData('currentTextureKey')
    const expectedTextureKey = this.getCharacterTextureKey(playerId)
    
    if (body) {
      if (isImageBody) {
        // Check if texture needs to be swapped (unicorn status changed)
        if (expectedTextureKey && currentTextureKey !== expectedTextureKey) {
          // Swap texture
          body.setTexture(expectedTextureKey)
          playerObj.setData('currentTextureKey', expectedTextureKey)
        }
        // Clear any tint - unicorn now uses unicorn.png directly
        body.clearTint()
        body.setDisplaySize(playerSize, playerSize)
      } else {
        // For graphics body, redraw the circle
        const color = isLocal ? 0x4CAF50 : (isUnicorn ? 0xFF69B4 : 0x2196F3)
        body.clear()
        body.fillStyle(color, 1)
        body.fillCircle(0, 0, playerSize / 2)
        body.lineStyle(2, isUnicorn ? 0xFF1493 : 0xFFFFFF, 1)
        body.strokeCircle(0, 0, playerSize / 2)
      }
    }
    
    // Update name text prefix based on unicorn/frozen status
    const existingNameText = playerObj.getData('nameText')
    if (existingNameText) {
      const playerName = playerObj.getData('name') || 'Player'
      // Get frozen state from playersHealth if available
      const healthData = this.playersHealth?.[playerId] || {}
      const isFrozen = healthData.state === 'frozen'
      const namePrefix = isUnicorn ? '🦄 ' : (isFrozen ? '❄️ ' : '')
      existingNameText.setText(namePrefix + playerName)
      existingNameText.setColor(isUnicorn ? '#FF69B4' : '#ffffff')
    }
    
    // Update unicorn rotating pink ring
    const existingUnicornRing = playerObj.getData('unicornRing')
    if (isUnicorn && !existingUnicornRing) {
      const unicornRing = this.createIframesDashedRing(playerSize / 2 + 6, 3, 0xFF69B4, 0.9)
      playerObj.add(unicornRing)
      playerObj.setData('unicornRing', unicornRing)
    } else if (!isUnicorn && existingUnicornRing) {
      existingUnicornRing.destroy()
      playerObj.setData('unicornRing', null)
    }
  }

  addPlayer(playerId, x, y, row, col, options = {}) {
    // Remove existing player if any
    if (this.players.has(playerId)) {
      this.removePlayer(playerId)
    }
    
    const isUnicorn = playerId === this.unicornId
    const isLocal = playerId === this.localPlayerId
    
    const pixelX = col * this.cellSize + this.cellSize / 2
    const pixelY = row * this.cellSize + this.cellSize / 2
    
    const playerObj = this.createPlayerGraphic(
      isUnicorn, 
      isLocal,
      options.health,
      options.maxHealth,
      options.inIFrames,
      options.isFrozen,
      options.hasImmunity,
      options.isKnockedBack,
      playerId, // Pass playerId for character texture lookup
      options.name // Pass player name for name text rendering
    )
    
    playerObj.x = pixelX
    playerObj.y = pixelY
    
    // Set depth so remote players appear above walls (wall layer is depth 1, local player is 100)
    playerObj.setDepth(50)
    
    // Store player data
    playerObj.setData('playerId', playerId)
    playerObj.setData('name', options.name || 'Player')
    playerObj.setData('direction', options.direction || 'right')
    
    this.players.set(playerId, playerObj)
    this.playerTargets.set(playerId, {
      x: pixelX,
      y: pixelY,
      row: row,
      col: col,
      lastRow: row,
      lastCol: col,
      initialized: true
    })
    
    return playerObj
  }

  updatePlayerTarget(playerId, newRow, newCol, options = {}) {
    let target = this.playerTargets.get(playerId)
    const playerObj = this.players.get(playerId)
    
    if (!target || !playerObj) {
      // Player doesn't exist, create it
      this.addPlayer(playerId, 0, 0, newRow, newCol, options)
      return
    }
    
    const newPixelX = newCol * this.cellSize + this.cellSize / 2
    const newPixelY = newRow * this.cellSize + this.cellSize / 2
    
    // Detect wrap-around
    const colDiff = newCol - target.lastCol
    let adjustedTargetX = newPixelX
    let wrapDetected = false
    
    if (hasWrapAround(newRow) && hasWrapAround(target.row)) {
      // Detect wrap from right to left (31 -> 0)
      if (colDiff < -MAZE_COLS / 2 || (target.lastCol === MAZE_COLS - 1 && newCol === 0)) {
        wrapDetected = true
        // Snap current position for wrap
        if (playerObj.x < this.mazeWidth / 2) {
          playerObj.x += this.mazeWidth
        }
        adjustedTargetX = newPixelX + this.mazeWidth
      }
      // Detect wrap from left to right (0 -> 31)
      else if (colDiff > MAZE_COLS / 2 || (target.lastCol === 0 && newCol === MAZE_COLS - 1)) {
        wrapDetected = true
        // Snap current position for wrap
        if (playerObj.x > this.mazeWidth / 2) {
          playerObj.x -= this.mazeWidth
        }
        adjustedTargetX = newPixelX - this.mazeWidth
      }
    }
    
    // Update target
    target.x = adjustedTargetX
    target.y = newPixelY
    target.lastRow = target.row
    target.lastCol = target.col
    target.row = newRow
    target.col = newCol
    target.wrapDetected = wrapDetected
    
    // Update player state visuals
    if (options.inIFrames !== undefined) {
      playerObj.setAlpha(options.inIFrames ? 0.5 : 1)
    }

    // update i-frames dashed ring for remote players
    if (options.inIFrames !== undefined) {
      const existingIframesRing = playerObj.getData('iframesRing')
      const playerSize = this.cellSize * PLAYER_SIZE_RATIO
      if (options.inIFrames && !existingIframesRing) {
        const iframesRing = this.createIframesDashedRing(playerSize / 2 + 4)
        playerObj.add(iframesRing)
        playerObj.setData('iframesRing', iframesRing)
      } else if (!options.inIFrames && existingIframesRing) {
        existingIframesRing.destroy()
        playerObj.setData('iframesRing', null)
      }
    }
    
    // Update direction
    if (colDiff !== 0) {
      const direction = Math.abs(colDiff) > MAZE_COLS / 2 
        ? (colDiff > 0 ? 'left' : 'right')
        : (colDiff > 0 ? 'right' : 'left')
      playerObj.setData('direction', direction)
    } else if (newRow !== target.lastRow) {
      const direction = newRow > target.lastRow ? 'down' : 'up'
      playerObj.setData('direction', direction)
    }
    
    // Update immunity shield visual for remote players
    if (options.hasImmunity !== undefined) {
      const existingShield = playerObj.getData('shield')
      const playerSize = this.cellSize * PLAYER_SIZE_RATIO
      
      if (options.hasImmunity && !existingShield) {
        // Add immunity shield - cyan ring matching local player style
        const shield = this.add.graphics()
        shield.lineStyle(3, 0x00FFFF, 0.8)
        shield.strokeCircle(0, 0, playerSize / 2 + 5)
        playerObj.add(shield)
        playerObj.setData('shield', shield)
      } else if (!options.hasImmunity && existingShield) {
        // Remove immunity shield
        existingShield.destroy()
        playerObj.setData('shield', null)
      }
    }
    
    // Update frozen visual for remote players
    if (options.isFrozen !== undefined) {
      const existingFrozen = playerObj.getData('frozenOverlay')
      const existingFrozenText = playerObj.getData('frozenText')
      const playerSize = this.cellSize * PLAYER_SIZE_RATIO
      
      if (options.isFrozen && !existingFrozen) {
        // Add frozen overlay - light blue fill matching local player style
        const frozenOverlay = this.add.graphics()
        frozenOverlay.fillStyle(0x87CEEB, 0.5)
        frozenOverlay.fillCircle(0, 0, playerSize / 2 + 3)
        playerObj.add(frozenOverlay)
        playerObj.setData('frozenOverlay', frozenOverlay)
        
        // Add frozen icon above player
        const frozenText = this.add.text(0, -playerSize / 2 - 15, '❄️', {
          fontSize: `${playerSize * 0.5}px`,
        }).setOrigin(0.5, 0.5)
        playerObj.add(frozenText)
        playerObj.setData('frozenText', frozenText)
      } else if (!options.isFrozen && existingFrozen) {
        // Remove frozen overlay
        existingFrozen.destroy()
        playerObj.setData('frozenOverlay', null)
        if (existingFrozenText) {
          existingFrozenText.destroy()
          playerObj.setData('frozenText', null)
        }
      }
    }
  }

  removePlayer(playerId) {
    const playerObj = this.players.get(playerId)
    if (playerObj) {
      playerObj.destroy()
      this.players.delete(playerId)
      this.playerTargets.delete(playerId)
    }
  }

  clearAllPlayers() {
    this.players.forEach((playerObj) => {
      playerObj.destroy()
    })
    this.players.clear()
    this.playerTargets.clear()
  }

  update(time, delta) {
    // ========== UPDATE LOCAL PLAYER POSITION ==========
    // Interpolate local player position toward target grid position
    // This happens entirely in Phaser's game loop for true 60fps smooth movement
    this.updateLocalPlayerPosition(delta)
    
    // ========== SMOOTH INTERPOLATION FOR REMOTE PLAYERS ==========
    this.players.forEach((playerObj, playerId) => {
      // Skip local player - position is now handled above via ref
      if (playerId === this.localPlayerId) return
      
      const target = this.playerTargets.get(playerId)
      if (!target) return
      
      // Calculate interpolation
      let targetX = target.x
      let targetY = target.y
      
      // Handle wrap-around interpolation
      if (hasWrapAround(target.row)) {
        // Normalize target position if needed
        if (!target.wrapDetected) {
          while (targetX < 0) targetX += this.mazeWidth
          while (targetX >= this.mazeWidth) targetX -= this.mazeWidth
        }
        
        // Choose shortest path
        const dxNormal = targetX - playerObj.x
        const dxWrappedLeft = (targetX + this.mazeWidth) - playerObj.x
        const dxWrappedRight = (targetX - this.mazeWidth) - playerObj.x
        
        if (Math.abs(dxWrappedLeft) < Math.abs(dxNormal) && targetX < playerObj.x) {
          targetX += this.mazeWidth
        } else if (Math.abs(dxWrappedRight) < Math.abs(dxNormal) && targetX > playerObj.x) {
          targetX -= this.mazeWidth
        }
      }
      
      // Smooth exponential interpolation
      const dx = targetX - playerObj.x
      const dy = targetY - playerObj.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      if (distance > 0.5) {
        // Use exponential smoothing for frame-rate independent interpolation
        // Formula: 1 - exp(-speed * dt) gives smooth exponential decay
        const dt = delta / 1000 // Convert delta ms to seconds
        const factor = 1 - Math.exp(-this.interpolationSpeed * dt)
        playerObj.x += dx * factor
        playerObj.y += dy * factor
      } else {
        // Snap when very close
        playerObj.x = target.x
        playerObj.y = target.y
      }
      
      // Normalize position after interpolation
      if (hasWrapAround(target.row)) {
        while (playerObj.x < 0) playerObj.x += this.mazeWidth
        while (playerObj.x >= this.mazeWidth) playerObj.x -= this.mazeWidth
      }
    })

    // Rotate i-frames dashed rings (local + remote)
    const IFRAMES_RING_ROTATION_SPEED = Math.PI // radians per second (one full turn per 2s)
    const UNICORN_RING_ROTATION_SPEED = Math.PI * 0.5 // radians per second (slower rotation for unicorn)
    if (this.localPlayerObj) {
      const ring = this.localPlayerObj.getData('iframesRing')
      if (ring) ring.rotation += (delta / 1000) * IFRAMES_RING_ROTATION_SPEED
      const unicornRing = this.localPlayerObj.getData('unicornRing')
      if (unicornRing) unicornRing.rotation += (delta / 1000) * UNICORN_RING_ROTATION_SPEED
    }
    this.players.forEach((playerObj) => {
      const ring = playerObj.getData('iframesRing')
      if (ring) ring.rotation += (delta / 1000) * IFRAMES_RING_ROTATION_SPEED
      const unicornRing = playerObj.getData('unicornRing')
      if (unicornRing) unicornRing.rotation += (delta / 1000) * UNICORN_RING_ROTATION_SPEED
    })
    
    // Update remote unicorn trail (if unicorn is not local player)
    this.updateRemoteUnicornTrail()
  }
}

const PhaserPlayerLayer = forwardRef(({ 
  localPlayerId,
  remotePlayers,
  remotePlayerPositions,
  unicornId,
  playersHealth,
  immunePlayers,
  knockbackPlayers,
  width,
  height,
  renderMaze = true,  // Whether to render maze via Phaser
  onMapLoaded = null, // Callback when map is ready
  // Local player rendering props - for smooth 60fps updates
  // Pass refs so Phaser can read them every frame for smooth interpolation
  localPlayerTargetGridPosRef = null,  // Ref to target grid position { row, col } - Phaser interpolates toward this
  localPlayerFacingDirection = 'right',
  localPlayerHealth = 100,
  localPlayerIsImmune = false,
  localPlayerInIFrames = false,
  localPlayerState = null,
  localPlayerKnockback = false,
  renderLocalPlayer = false,      // Whether to render local player in Phaser
  // Character system props
  playerCharacters = {},           // Map of playerId -> characterId
  localPlayerCharacterId = null,   // Local player's character ID
  characterImageUrls = null,       // Map of characterId -> imageUrl
  // Local player name prop
  localPlayerName = null,          // Local player's display name
}, ref) => {
  const gameRef = useRef(null)
  const sceneRef = useRef(null)
  const containerRef = useRef(null)
  const [sceneReady, setSceneReady] = useState(false) // Track when scene is ready for setup

  // Initialize Phaser game
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return

    // Calculate initial maze dimensions
    const cellSize = Math.min((width || window.innerWidth) / MAZE_COLS, (height || window.innerHeight) / MAZE_ROWS)
    const mazeWidth = cellSize * MAZE_COLS
    const mazeHeight = cellSize * MAZE_ROWS

    const config = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: mazeWidth,
      height: mazeHeight,
      transparent: true,
      scene: PlayerScene,
      fps: {
        target: 60,
        forceSetTimeOut: false
      },
      render: {
        antialias: false,
        pixelArt: true,
        roundPixels: true
      },
      scale: {
        mode: Phaser.Scale.NONE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    }

    gameRef.current = new Phaser.Game(config)
    
    // Get scene reference once ready - use a polling approach for reliability
    const checkScene = () => {
      const scene = gameRef.current?.scene?.getScene('PlayerScene')
      if (scene) {
        sceneRef.current = scene
        setSceneReady(true) // Trigger re-render so useEffects can run
      } else if (gameRef.current) {
        requestAnimationFrame(checkScene)
      }
    }
    
    gameRef.current.events.once('ready', checkScene)

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
        sceneRef.current = null
        setSceneReady(false)
      }
    }
  }, [])

  // Handle resize
  useEffect(() => {
    if (!gameRef.current || !sceneReady || !sceneRef.current) return
    
    // Calculate maze dimensions based on the passed width/height
    const cellSize = Math.min((width || window.innerWidth) / MAZE_COLS, (height || window.innerHeight) / MAZE_ROWS)
    const mazeWidth = cellSize * MAZE_COLS
    const mazeHeight = cellSize * MAZE_ROWS
    
    gameRef.current.scale.resize(mazeWidth, mazeHeight)
    sceneRef.current.updateDimensions()
  }, [width, height, sceneReady])

  // Set local player ID
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.setLocalPlayerId(localPlayerId)
  }, [localPlayerId, sceneReady])

  // Set unicorn ID
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.setUnicornId(unicornId)
  }, [unicornId, sceneReady])

  // ========== CHARACTER SYSTEM SETUP ==========
  
  // Set character image URLs for texture loading - must run early
  useEffect(() => {
    if (!sceneReady || !sceneRef.current || !characterImageUrls) return
    sceneRef.current.setCharacterImageUrls(characterImageUrls)
  }, [characterImageUrls, sceneReady])

  // Set player characters map - must run before remote players are created
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.setPlayerCharacters(playerCharacters)
    
    // If textures are already loaded, recreate players that need character textures
    if (sceneRef.current.characterTexturesLoaded && Object.keys(playerCharacters).length > 0) {
      sceneRef.current.recreateAllRemotePlayers()
    }
  }, [playerCharacters, sceneReady])

  // Set local player character ID
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.setLocalPlayerCharacterId(localPlayerCharacterId)
    
    // If textures are loaded and local player exists with circle, recreate it
    if (sceneRef.current.characterTexturesLoaded && sceneRef.current.localPlayerObj) {
      const isUsingCircle = !sceneRef.current.localPlayerObj.getData('isImageBody')
      const hasTexture = sceneRef.current.getLocalCharacterTextureKey() !== null
      if (isUsingCircle && hasTexture) {
        sceneRef.current.destroyLocalPlayer()
        sceneRef.current.createLocalPlayer()
      }
    }
  }, [localPlayerCharacterId, sceneReady])

  // Set local player name (stored for reference, but display always shows "You")
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.setLocalPlayerName(localPlayerName)
  }, [localPlayerName, sceneReady])

  // Set players health data for frozen status in name display
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.setPlayersHealth(playersHealth)
  }, [playersHealth, sceneReady])

  // Handle renderMaze prop changes
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.renderMaze = renderMaze
    sceneRef.current.setMazeRendering(renderMaze)
  }, [renderMaze, sceneReady])

  // Call onMapLoaded callback when map is ready
  useEffect(() => {
    if (!sceneReady || !sceneRef.current || !onMapLoaded) return
    
    const checkMapLoaded = () => {
      if (sceneRef.current?.isMazeRendering()) {
        onMapLoaded(sceneRef.current.mapLoader)
      }
    }
    
    // Check immediately and set up polling
    const interval = setInterval(() => {
      if (sceneRef.current?.isMazeRendering()) {
        onMapLoaded(sceneRef.current.mapLoader)
        clearInterval(interval)
      }
    }, 100)
    
    return () => clearInterval(interval)
  }, [onMapLoaded, sceneReady])

  // ========== LOCAL PLAYER RENDERING SETUP ==========
  
  // Set local player target grid position ref (for 60fps smooth interpolation in Phaser)
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.setLocalPlayerTargetGridPosRef(localPlayerTargetGridPosRef)
  }, [localPlayerTargetGridPosRef, sceneReady])

  // Enable/disable local player rendering
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    sceneRef.current.setRenderLocalPlayer(renderLocalPlayer)
    
    // Create local player if enabled and scene is ready
    if (renderLocalPlayer && localPlayerId) {
      sceneRef.current.createLocalPlayer()
    }
  }, [renderLocalPlayer, localPlayerId, sceneReady])

  // Update local player state when props change
  useEffect(() => {
    if (!sceneReady || !sceneRef.current || !renderLocalPlayer) return
    
    sceneRef.current.updateLocalPlayerState({
      facingDirection: localPlayerFacingDirection,
      health: localPlayerHealth,
      maxHealth: COMBAT_CONFIG.MAX_HEALTH,
      isImmune: localPlayerIsImmune,
      inIFrames: localPlayerInIFrames,
      isFrozen: localPlayerState === PLAYER_STATE.FROZEN,
      isKnockedBack: localPlayerKnockback
    })
  }, [
    sceneReady,
    renderLocalPlayer,
    localPlayerFacingDirection,
    localPlayerHealth,
    localPlayerIsImmune,
    localPlayerInIFrames,
    localPlayerState,
    localPlayerKnockback
  ])

  // Update remote players
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return
    
    const scene = sceneRef.current
    
    // Ensure playerCharacters is set on the scene before creating players
    if (playerCharacters && Object.keys(playerCharacters).length > 0) {
      scene.setPlayerCharacters(playerCharacters)
    }
    
    // Get current player IDs in scene
    const currentPlayerIds = new Set(scene.players.keys())
    currentPlayerIds.delete(localPlayerId) // Don't remove local player
    
    // Update or add remote players
    Object.entries(remotePlayers || {}).forEach(([playerId, player]) => {
      currentPlayerIds.delete(playerId)
      
      const posData = remotePlayerPositions?.[playerId]
      const healthData = playersHealth?.[playerId] || { health: 100, maxHealth: 100 }
      
      const row = posData?.row ?? 1
      const col = posData?.col ?? 1
      
      // Check if player exists but doesn't have character texture yet
      const existingPlayer = scene.players.get(playerId)
      const hasTextureNow = scene.getCharacterTextureKey(playerId) !== null
      const isUsingCircle = existingPlayer && !existingPlayer.getData('isImageBody')
      
      // If player exists with circle but texture is now available, recreate them
      if (existingPlayer && isUsingCircle && hasTextureNow && scene.characterTexturesLoaded) {
        scene.removePlayer(playerId)
        scene.addPlayer(playerId, 0, 0, row, col, {
          name: player.name,
          health: healthData.health,
          maxHealth: healthData.maxHealth,
          inIFrames: healthData.inIFrames,
          isFrozen: healthData.state === PLAYER_STATE.FROZEN,
          hasImmunity: immunePlayers?.has?.(playerId),
          isKnockedBack: knockbackPlayers?.has?.(playerId),
          isUnicorn: player.isUnicorn || playerId === unicornId
        })
      } else {
        scene.updatePlayerTarget(playerId, row, col, {
          name: player.name,
          health: healthData.health,
          maxHealth: healthData.maxHealth,
          inIFrames: healthData.inIFrames,
          isFrozen: healthData.state === PLAYER_STATE.FROZEN,
          hasImmunity: immunePlayers?.has?.(playerId),
          isKnockedBack: knockbackPlayers?.has?.(playerId),
          isUnicorn: player.isUnicorn || playerId === unicornId
        })
      }
    })
    
    // Remove players that are no longer in the game
    currentPlayerIds.forEach(playerId => {
      scene.removePlayer(playerId)
    })
  }, [sceneReady, remotePlayers, remotePlayerPositions, playersHealth, immunePlayers, knockbackPlayers, unicornId, localPlayerId, playerCharacters])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getScene: () => sceneRef.current,
    clearPlayers: () => sceneRef.current?.clearAllPlayers(),
    // Particle effect methods
    triggerCoinParticles: (row, col) => sceneRef.current?.triggerCoinParticles(row, col),
    triggerPowerupParticles: (row, col, type) => sceneRef.current?.triggerPowerupParticles(row, col, type),
    triggerHitParticles: (row, col) => sceneRef.current?.triggerHitParticles(row, col),
    // Floating number methods
    showDamageNumber: (row, col, amount) => sceneRef.current?.showDamageNumber(row, col, amount),
    showCoinNumber: (row, col, value) => sceneRef.current?.showCoinNumber(row, col, value),
    showFloatingText: (row, col, text, options) => sceneRef.current?.showFloatingText(row, col, text, options),
    // Powerup aura methods
    addPowerupAura: (powerupId, row, col, type) => sceneRef.current?.addPowerupAura(powerupId, row, col, type),
    removePowerupAura: (powerupId) => sceneRef.current?.removePowerupAura(powerupId),
    triggerPowerupCollect: (row, col, type) => sceneRef.current?.triggerPowerupCollect(row, col, type),
    clearAllPowerupAuras: () => sceneRef.current?.clearAllPowerupAuras(),
    // Unicorn trail methods
    startUnicornTrail: (playerId) => sceneRef.current?.startUnicornTrail(playerId),
    updateUnicornTrailPosition: (x, y) => sceneRef.current?.updateUnicornTrailPosition(x, y),
    stopUnicornTrail: () => sceneRef.current?.stopUnicornTrail(),
    triggerUnicornBurst: (x, y) => sceneRef.current?.triggerUnicornBurst(x, y),
    isUnicornTrailActive: () => sceneRef.current?.isUnicornTrailActive(),
    // Maze/Tilemap methods
    isMazeRendering: () => sceneRef.current?.isMazeRendering() || false,
    setMazeRendering: (enabled) => sceneRef.current?.setMazeRendering(enabled),
    getMapLoader: () => sceneRef.current?.mapLoader,
    getTilemap: () => sceneRef.current?.tilemap,
    // Local player methods
    createLocalPlayer: () => sceneRef.current?.createLocalPlayer(),
    destroyLocalPlayer: () => sceneRef.current?.destroyLocalPlayer(),
    updateLocalPlayerState: (state) => sceneRef.current?.updateLocalPlayerState(state),
    getLocalPlayerObj: () => sceneRef.current?.localPlayerObj,
  }))

  return (
    <div 
      ref={containerRef}
      className="phaser-player-layer"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10
      }}
    />
  )
})

PhaserPlayerLayer.displayName = 'PhaserPlayerLayer'

export default PhaserPlayerLayer
