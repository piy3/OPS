import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import Phaser from 'phaser'
import { MAZE_ROWS, MAZE_COLS, hasWrapAround, setMapLoader } from '../maze'
import { generateTilesetTexture, TILE_SIZE } from '../scripts/generateTileset'
import { TiledMapLoader, createDynamicTilemap } from '../utils/TiledMapLoader'

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
      
      console.log('Tilemap created successfully')
    } catch (error) {
      console.error('Error creating tilemap:', error)
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
      fontSize = this.cellSize * 0.5,
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
  }

  updatePlayerSize(playerObj) {
    const playerSize = this.cellSize * 0.6
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
  }

  createPlayerGraphic(isUnicorn, isLocal, health, maxHealth, inIFrames, isFrozen, hasImmunity, isKnockedBack) {
    const container = this.add.container(0, 0)
    
    // Player body - circle
    const playerSize = this.cellSize * 0.6
    const color = isLocal ? 0x4CAF50 : (isUnicorn ? 0xFF69B4 : 0x2196F3)
    
    const body = this.add.graphics()
    body.fillStyle(color, 1)
    body.fillCircle(0, 0, playerSize / 2)
    
    // Add border
    body.lineStyle(2, isUnicorn ? 0xFF1493 : 0xFFFFFF, 1)
    body.strokeCircle(0, 0, playerSize / 2)
    
    container.add(body)
    
    // Unicorn emoji indicator
    if (isUnicorn) {
      const unicornEmoji = this.add.text(0, 0, '🦄', {
        fontSize: `${playerSize * 0.8}px`,
      }).setOrigin(0.5, 0.5)
      container.add(unicornEmoji)
    }
    
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
    const playerSize = this.cellSize * 0.6
    const color = isLocal ? 0x4CAF50 : (isUnicorn ? 0xFF69B4 : 0x2196F3)
    
    // Update body color
    const body = playerObj.getData('body')
    if (body) {
      body.clear()
      body.fillStyle(color, 1)
      body.fillCircle(0, 0, playerSize / 2)
      body.lineStyle(2, isUnicorn ? 0xFF1493 : 0xFFFFFF, 1)
      body.strokeCircle(0, 0, playerSize / 2)
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
      options.isKnockedBack
    )
    
    playerObj.x = pixelX
    playerObj.y = pixelY
    
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
    // Smooth interpolation for all remote players
    this.players.forEach((playerObj, playerId) => {
      // Skip local player - position is updated directly
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
}, ref) => {
  const gameRef = useRef(null)
  const sceneRef = useRef(null)
  const containerRef = useRef(null)

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
        antialias: true,
        pixelArt: false,
        roundPixels: false
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
      }
    }
  }, [])

  // Handle resize
  useEffect(() => {
    if (!gameRef.current || !sceneRef.current) return
    
    // Calculate maze dimensions based on the passed width/height
    const cellSize = Math.min((width || window.innerWidth) / MAZE_COLS, (height || window.innerHeight) / MAZE_ROWS)
    const mazeWidth = cellSize * MAZE_COLS
    const mazeHeight = cellSize * MAZE_ROWS
    
    gameRef.current.scale.resize(mazeWidth, mazeHeight)
    sceneRef.current.updateDimensions()
  }, [width, height])

  // Set local player ID
  useEffect(() => {
    if (!sceneRef.current) return
    sceneRef.current.setLocalPlayerId(localPlayerId)
  }, [localPlayerId])

  // Set unicorn ID
  useEffect(() => {
    if (!sceneRef.current) return
    sceneRef.current.setUnicornId(unicornId)
  }, [unicornId])

  // Handle renderMaze prop changes
  useEffect(() => {
    if (!sceneRef.current) return
    sceneRef.current.renderMaze = renderMaze
    sceneRef.current.setMazeRendering(renderMaze)
  }, [renderMaze])

  // Call onMapLoaded callback when map is ready
  useEffect(() => {
    if (!sceneRef.current || !onMapLoaded) return
    
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
  }, [onMapLoaded])

  // Note: Local player is rendered via DOM (already has smooth interpolation)
  // Phaser layer only handles remote players for network jitter smoothing

  // Update remote players
  useEffect(() => {
    if (!sceneRef.current) return
    
    const scene = sceneRef.current
    
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
      
      scene.updatePlayerTarget(playerId, row, col, {
        name: player.name,
        health: healthData.health,
        maxHealth: healthData.maxHealth,
        inIFrames: healthData.inIFrames,
        isFrozen: healthData.state === 'frozen',
        hasImmunity: immunePlayers?.has?.(playerId),
        isKnockedBack: knockbackPlayers?.has?.(playerId),
        isUnicorn: player.isUnicorn || playerId === unicornId
      })
    })
    
    // Remove players that are no longer in the game
    currentPlayerIds.forEach(playerId => {
      scene.removePlayer(playerId)
    })
  }, [remotePlayers, remotePlayerPositions, playersHealth, immunePlayers, knockbackPlayers, unicornId, localPlayerId])

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
