/**
 * Phaser Sound Manager
 * Manages all game sounds using Phaser's audio system
 * Can be used standalone or integrated with existing Phaser scenes
 */

import Phaser from 'phaser';
import log from '../utils/logger';

// Sound effect keys
export const SOUNDS = {
  COIN_COLLECT: 'coin_collect',
  POWERUP_PICKUP: 'powerup_pickup',
  PLAYER_HIT: 'player_hit',
  FREEZE: 'freeze',
  TAG: 'tag',
  QUIZ_CORRECT: 'quiz_correct',
  QUIZ_WRONG: 'quiz_wrong',
  GAME_START: 'game_start',
  BLITZ_START: 'blitz_start',
  HUNT_START: 'hunt_start',
  TIMER_WARNING: 'timer_warning'
};

// Audio Scene for sound management
class AudioScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AudioScene' });
    this.sounds = {};
    this.volume = 0.5;
    this.muted = false;
  }

  preload() {
    // Use base64-encoded simple sounds or URLs to free sound effects
    // These are placeholder URLs - in production, host these locally
    
    // Free sound effect URLs (using freesound.org or similar free assets)
    // For development, we'll use simple synthesized sounds via Web Audio API fallback
    
    // Load sounds from public assets folder
    this.load.audio(SOUNDS.COIN_COLLECT, '/sounds/coin.mp3');
    this.load.audio(SOUNDS.POWERUP_PICKUP, '/sounds/powerup.mp3');
    this.load.audio(SOUNDS.PLAYER_HIT, '/sounds/hit.mp3');
    this.load.audio(SOUNDS.FREEZE, '/sounds/freeze.mp3');
    this.load.audio(SOUNDS.TAG, '/sounds/tag.mp3');
    this.load.audio(SOUNDS.QUIZ_CORRECT, '/sounds/correct.mp3');
    this.load.audio(SOUNDS.QUIZ_WRONG, '/sounds/wrong.mp3');
    this.load.audio(SOUNDS.GAME_START, '/sounds/game_start.mp3');
    this.load.audio(SOUNDS.BLITZ_START, '/sounds/blitz.mp3');
    this.load.audio(SOUNDS.HUNT_START, '/sounds/hunt.mp3');
    this.load.audio(SOUNDS.TIMER_WARNING, '/sounds/timer_warning.mp3');
    
    // Handle load errors gracefully - sounds are optional
    this.load.on('loaderror', (file) => {
      log.warn(`Failed to load sound: ${file.key} - will use fallback`);
    });
  }

  create() {
    // Create sound instances for each loaded audio
    Object.values(SOUNDS).forEach(key => {
      if (this.cache.audio.exists(key)) {
        this.sounds[key] = this.sound.add(key, { volume: this.volume });
      }
    });
    
    log.log('🔊 Audio Scene initialized with sounds:', Object.keys(this.sounds));
  }

  playSound(key, config = {}) {
    if (this.muted) return;
    
    const sound = this.sounds[key];
    if (sound) {
      sound.play({
        volume: (config.volume ?? 1) * this.volume,
        ...config
      });
    } else {
      // Fallback to Web Audio API for missing sounds
      this.playFallbackSound(key, config);
    }
  }

  // Fallback synthesized sounds using Web Audio API
  playFallbackSound(key, config = {}) {
    if (this.muted) return;
    
    const audioContext = this.sound.context;
    if (!audioContext) return;

    const volume = (config.volume ?? 1) * this.volume;
    const gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    gainNode.gain.value = volume * 0.3; // Lower volume for synthesized sounds

    const oscillator = audioContext.createOscillator();
    oscillator.connect(gainNode);

    const now = audioContext.currentTime;

    switch (key) {
      case SOUNDS.COIN_COLLECT:
        // Cheerful ding sound
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.setValueAtTime(1174.66, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        oscillator.start(now);
        oscillator.stop(now + 0.2);
        break;

      case SOUNDS.POWERUP_PICKUP:
        // Rising power-up sound
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(300, now);
        oscillator.frequency.exponentialRampToValueAtTime(600, now + 0.15);
        oscillator.frequency.exponentialRampToValueAtTime(900, now + 0.3);
        gainNode.gain.setValueAtTime(volume * 0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        oscillator.start(now);
        oscillator.stop(now + 0.35);
        break;

      case SOUNDS.PLAYER_HIT:
        // Impact/damage sound
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(200, now);
        oscillator.frequency.exponentialRampToValueAtTime(80, now + 0.15);
        gainNode.gain.setValueAtTime(volume * 0.4, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        oscillator.start(now);
        oscillator.stop(now + 0.2);
        break;

      case SOUNDS.FREEZE:
        // Ice/freeze crystalline sound
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(1500, now);
        oscillator.frequency.setValueAtTime(2000, now + 0.05);
        oscillator.frequency.setValueAtTime(1800, now + 0.1);
        oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.4);
        gainNode.gain.setValueAtTime(volume * 0.25, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        oscillator.start(now);
        oscillator.stop(now + 0.5);
        break;

      case SOUNDS.TAG:
        // Tag/catch sound
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(523.25, now);
        oscillator.frequency.setValueAtTime(659.25, now + 0.08);
        oscillator.frequency.setValueAtTime(783.99, now + 0.16);
        gainNode.gain.setValueAtTime(volume * 0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        oscillator.start(now);
        oscillator.stop(now + 0.3);
        break;

      case SOUNDS.QUIZ_CORRECT:
        // Success/correct answer chime
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(523.25, now);
        oscillator.frequency.setValueAtTime(659.25, now + 0.1);
        oscillator.frequency.setValueAtTime(783.99, now + 0.2);
        oscillator.frequency.setValueAtTime(1046.5, now + 0.3);
        gainNode.gain.setValueAtTime(volume * 0.3, now);
        gainNode.gain.setValueAtTime(volume * 0.3, now + 0.35);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        oscillator.start(now);
        oscillator.stop(now + 0.5);
        break;

      case SOUNDS.QUIZ_WRONG:
        // Wrong answer buzzer
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(200, now);
        oscillator.frequency.setValueAtTime(180, now + 0.15);
        gainNode.gain.setValueAtTime(volume * 0.35, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        oscillator.start(now);
        oscillator.stop(now + 0.4);
        break;

      case SOUNDS.GAME_START:
      case SOUNDS.HUNT_START:
        // Game start fanfare
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(261.63, now);
        oscillator.frequency.setValueAtTime(329.63, now + 0.12);
        oscillator.frequency.setValueAtTime(392, now + 0.24);
        oscillator.frequency.setValueAtTime(523.25, now + 0.36);
        gainNode.gain.setValueAtTime(volume * 0.25, now);
        gainNode.gain.setValueAtTime(volume * 0.3, now + 0.36);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        oscillator.start(now);
        oscillator.stop(now + 0.6);
        break;

      case SOUNDS.BLITZ_START:
        // Urgent blitz quiz sound
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(800, now);
        oscillator.frequency.setValueAtTime(600, now + 0.1);
        oscillator.frequency.setValueAtTime(800, now + 0.2);
        oscillator.frequency.setValueAtTime(600, now + 0.3);
        gainNode.gain.setValueAtTime(volume * 0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        oscillator.start(now);
        oscillator.stop(now + 0.4);
        break;

      case SOUNDS.TIMER_WARNING:
        // Warning beep
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(1000, now);
        gainNode.gain.setValueAtTime(volume * 0.25, now);
        gainNode.gain.setValueAtTime(0, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 0.25, now + 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        oscillator.start(now);
        oscillator.stop(now + 0.35);
        break;

      default:
        // Generic beep
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, now);
        gainNode.gain.setValueAtTime(volume * 0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        oscillator.start(now);
        oscillator.stop(now + 0.15);
    }
  }

  setVolume(newVolume) {
    this.volume = Math.max(0, Math.min(1, newVolume));
    // Update volume for all existing sounds
    Object.values(this.sounds).forEach(sound => {
      if (sound.setVolume) {
        sound.setVolume(this.volume);
      }
    });
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.sound) {
      this.sound.mute = muted;
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  getVolume() {
    return this.volume;
  }

  isMuted() {
    return this.muted;
  }
}

// Singleton Sound Manager class
class PhaserSoundManager {
  constructor() {
    this.game = null;
    this.scene = null;
    this.initialized = false;
    this.pendingSounds = [];
    // Standalone Web Audio context - independent of Phaser
    this.standaloneAudioContext = null;
    this.volume = 0.5;
    this.muted = false;
  }

  init(parentElement = null) {
    if (this.initialized) {
      log.log('🔊 Sound Manager already initialized');
      return Promise.resolve(this);
    }

    // Initialize standalone Web Audio context first (works without Phaser)
    try {
      this.standaloneAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      log.log('🔊 Standalone Web Audio context initialized');
    } catch (e) {
      log.warn('Failed to create standalone audio context:', e);
    }

    return new Promise((resolve) => {
      // Create a minimal Phaser game just for audio
      const config = {
        type: Phaser.HEADLESS, // No rendering needed, just audio
        parent: parentElement,
        width: 1,
        height: 1,
        audio: {
          disableWebAudio: false,
          context: null
        },
        scene: AudioScene
      };

      this.game = new Phaser.Game(config);

      // Wait for scene to be ready
      const checkReady = () => {
        this.scene = this.game.scene.getScene('AudioScene');
        if (this.scene && this.scene.sound) {
          this.initialized = true;
          log.log('🔊 Phaser Sound Manager initialized');
          
          // Play any pending sounds
          this.pendingSounds.forEach(({ key, config }) => {
            this.play(key, config);
          });
          this.pendingSounds = [];
          
          resolve(this);
        } else {
          requestAnimationFrame(checkReady);
        }
      };

      this.game.events.once('ready', checkReady);
    });
  }

  // Play sound using standalone Web Audio API (bypasses Phaser completely)
  playStandaloneSound(soundKey, config = {}) {
    if (this.muted) return;
    
    const audioContext = this.standaloneAudioContext;
    if (!audioContext) return;

    // Resume audio context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const volume = (config.volume ?? 1) * this.volume;
    const gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    gainNode.gain.value = volume * 0.3;

    const oscillator = audioContext.createOscillator();
    oscillator.connect(gainNode);

    const now = audioContext.currentTime;

    switch (soundKey) {
      case SOUNDS.COIN_COLLECT:
        // Cheerful ding sound
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.setValueAtTime(1174.66, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        oscillator.start(now);
        oscillator.stop(now + 0.2);
        break;

      case SOUNDS.POWERUP_PICKUP:
        // Rising power-up sound
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(300, now);
        oscillator.frequency.exponentialRampToValueAtTime(600, now + 0.15);
        oscillator.frequency.exponentialRampToValueAtTime(900, now + 0.3);
        gainNode.gain.setValueAtTime(volume * 0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        oscillator.start(now);
        oscillator.stop(now + 0.35);
        break;

      case SOUNDS.PLAYER_HIT:
        // Impact/damage sound
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(200, now);
        oscillator.frequency.exponentialRampToValueAtTime(80, now + 0.15);
        gainNode.gain.setValueAtTime(volume * 0.4, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        oscillator.start(now);
        oscillator.stop(now + 0.2);
        break;

      case SOUNDS.TAG:
        // Tag sound - quick double beep
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(600, now);
        oscillator.frequency.setValueAtTime(800, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 0.3, now);
        gainNode.gain.setValueAtTime(0.01, now + 0.08);
        gainNode.gain.setValueAtTime(volume * 0.3, now + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        oscillator.start(now);
        oscillator.stop(now + 0.2);
        break;

      case SOUNDS.BLITZ_START:
        // Urgent blitz quiz sound
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(440, now);
        oscillator.frequency.setValueAtTime(550, now + 0.1);
        oscillator.frequency.setValueAtTime(660, now + 0.2);
        oscillator.frequency.setValueAtTime(880, now + 0.3);
        gainNode.gain.setValueAtTime(volume * 0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        oscillator.start(now);
        oscillator.stop(now + 0.4);
        break;

      case SOUNDS.TIMER_WARNING:
        // Urgent timer warning - double beep
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(1000, now);
        gainNode.gain.setValueAtTime(volume * 0.35, now);
        gainNode.gain.setValueAtTime(0.01, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 0.35, now + 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        oscillator.start(now);
        oscillator.stop(now + 0.35);
        break;

      default:
        // Generic beep for unknown sounds
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, now);
        gainNode.gain.setValueAtTime(volume * 0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        oscillator.start(now);
        oscillator.stop(now + 0.15);
    }
  }

  play(soundKey, config = {}) {
    // Always try standalone audio first (more reliable with multiple Phaser games)
    if (this.standaloneAudioContext) {
      this.playStandaloneSound(soundKey, config);
      return;
    }
    
    // Fallback to Phaser audio if standalone not available
    if (!this.initialized || !this.scene) {
      // Queue sound for later
      this.pendingSounds.push({ key: soundKey, config });
      return;
    }
    this.scene.playSound(soundKey, config);
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.scene) {
      this.scene.setVolume(volume);
    }
  }

  getVolume() {
    return this.volume;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.scene) {
      this.scene.setMuted(muted);
    }
  }

  isMuted() {
    return this.muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.scene) {
      this.scene.setMuted(this.muted);
    }
    return this.muted;
  }

  // Convenience methods for specific sounds
  playCoinCollect() {
    this.play(SOUNDS.COIN_COLLECT);
  }

  playPowerupPickup() {
    this.play(SOUNDS.POWERUP_PICKUP);
  }

  playPlayerHit() {
    this.play(SOUNDS.PLAYER_HIT);
  }

  playFreeze() {
    this.play(SOUNDS.FREEZE);
  }

  playTag() {
    this.play(SOUNDS.TAG);
  }

  playQuizCorrect() {
    this.play(SOUNDS.QUIZ_CORRECT);
  }

  playQuizWrong() {
    this.play(SOUNDS.QUIZ_WRONG);
  }

  playGameStart() {
    this.play(SOUNDS.GAME_START);
  }

  playBlitzStart() {
    this.play(SOUNDS.BLITZ_START);
  }

  playHuntStart() {
    this.play(SOUNDS.HUNT_START);
  }

  playTimerWarning() {
    this.play(SOUNDS.TIMER_WARNING);
  }

  destroy() {
    if (this.game) {
      this.game.destroy(true);
      this.game = null;
      this.scene = null;
      this.initialized = false;
    }
  }
}

// Export singleton instance
const soundManager = new PhaserSoundManager();
export default soundManager;
export { PhaserSoundManager, AudioScene };
