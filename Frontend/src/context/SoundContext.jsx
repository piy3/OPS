/**
 * Sound Context for React
 * Provides sound manager access and controls to all components
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import soundManager, { SOUNDS } from '../services/PhaserSoundManager';

const SoundContext = createContext(null);

export const useSound = () => {
  const context = useContext(SoundContext);
  if (!context) {
    throw new Error('useSound must be used within a SoundProvider');
  }
  return context;
};

// Re-export sound keys for convenience
export { SOUNDS };

export const SoundProvider = ({ children }) => {
  const [initialized, setInitialized] = useState(false);
  const [volume, setVolumeState] = useState(0.5);
  const [muted, setMutedState] = useState(false);
  const initAttempted = useRef(false);

  // Initialize sound manager on mount
  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    // Initialize sound manager
    soundManager.init().then(() => {
      setInitialized(true);
      // Load saved preferences from localStorage
      const savedVolume = localStorage.getItem('gameVolume');
      const savedMuted = localStorage.getItem('gameMuted');
      
      if (savedVolume !== null) {
        const vol = parseFloat(savedVolume);
        soundManager.setVolume(vol);
        setVolumeState(vol);
      }
      
      if (savedMuted !== null) {
        const isMuted = savedMuted === 'true';
        soundManager.setMuted(isMuted);
        setMutedState(isMuted);
      }
    }).catch(err => {
      console.error('Failed to initialize sound manager:', err);
    });

    return () => {
      // Don't destroy on unmount - keep sounds available
    };
  }, []);

  // Volume control
  const setVolume = useCallback((newVolume) => {
    const vol = Math.max(0, Math.min(1, newVolume));
    soundManager.setVolume(vol);
    setVolumeState(vol);
    localStorage.setItem('gameVolume', vol.toString());
  }, []);

  // Mute control
  const setMuted = useCallback((isMuted) => {
    soundManager.setMuted(isMuted);
    setMutedState(isMuted);
    localStorage.setItem('gameMuted', isMuted.toString());
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const newMuted = soundManager.toggleMute();
    setMutedState(newMuted);
    localStorage.setItem('gameMuted', newMuted.toString());
    return newMuted;
  }, []);

  // Play sound methods
  const playSound = useCallback((soundKey, config = {}) => {
    soundManager.play(soundKey, config);
  }, []);

  const playCoinCollect = useCallback(() => {
    soundManager.playCoinCollect();
  }, []);

  const playPowerupPickup = useCallback(() => {
    soundManager.playPowerupPickup();
  }, []);

  const playPlayerHit = useCallback(() => {
    soundManager.playPlayerHit();
  }, []);

  const playFreeze = useCallback(() => {
    soundManager.playFreeze();
  }, []);

  const playTag = useCallback(() => {
    soundManager.playTag();
  }, []);

  const playQuizCorrect = useCallback(() => {
    soundManager.playQuizCorrect();
  }, []);

  const playQuizWrong = useCallback(() => {
    soundManager.playQuizWrong();
  }, []);

  const playGameStart = useCallback(() => {
    soundManager.playGameStart();
  }, []);

  const playBlitzStart = useCallback(() => {
    soundManager.playBlitzStart();
  }, []);

  const playHuntStart = useCallback(() => {
    soundManager.playHuntStart();
  }, []);

  const playTimerWarning = useCallback(() => {
    soundManager.playTimerWarning();
  }, []);

  const value = {
    initialized,
    volume,
    muted,
    setVolume,
    setMuted,
    toggleMute,
    playSound,
    // Convenience methods
    playCoinCollect,
    playPowerupPickup,
    playPlayerHit,
    playFreeze,
    playTag,
    playQuizCorrect,
    playQuizWrong,
    playGameStart,
    playBlitzStart,
    playHuntStart,
    playTimerWarning,
    // Sound keys
    SOUNDS
  };

  return (
    <SoundContext.Provider value={value}>
      {children}
    </SoundContext.Provider>
  );
};

export default SoundContext;
