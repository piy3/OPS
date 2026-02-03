import { Howl, Howler } from 'howler';

// Prevent Howler from auto-suspending the AudioContext after 30s when no sound was playing
// (e.g. after we stop hunt to play timer), which could make music stop unexpectedly.
const HowlGlobal = Howler as {
  autoSuspend?: boolean;
  ctx?: { state?: string; resume?: () => Promise<void> };
};
if (typeof Howler !== 'undefined') {
  HowlGlobal.autoSuspend = false;
}

// Resume AudioContext when user returns to the tab (browsers often suspend when tab is backgrounded).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try {
        if (HowlGlobal.ctx?.state === 'suspended' && typeof HowlGlobal.ctx.resume === 'function') {
          HowlGlobal.ctx.resume();
        }
      } catch {
        // ignore
      }
    }
  });
}

const PATHS = {
  menu: '/sounds/menu.mp3',
  blitzQuiz: '/sounds/blitz-quiz.mp3',
  hunt: '/sounds/hunt.mp3',
  timer: '/sounds/timer.mp3',
  coin: '/sounds/coin.mp3',
  tag: '/sounds/tag.mp3',
  frozen: '/sounds/frozen.mp3',
  gameOver: '/sounds/game-over.mp3',
} as const;

export type MusicId = 'menu' | 'blitzQuiz' | 'hunt' | 'timer';
export type SfxId = 'coin' | 'tag' | 'frozen' | 'gameOver';

const DEFAULT_MUSIC_VOLUME = 0.5;

// Per-track volume (0–1). Used when creating Howl and when calling setTrackVolume.
const musicVolumes: Record<MusicId, number> = {
  menu: DEFAULT_MUSIC_VOLUME,
  blitzQuiz: DEFAULT_MUSIC_VOLUME,
  hunt: DEFAULT_MUSIC_VOLUME,
  timer: DEFAULT_MUSIC_VOLUME,
};

// Long-playing music (loop) – only for menu, blitzQuiz, hunt, timer
const music: Partial<Record<MusicId, Howl>> = {};
// Short SFX (one-shot) – coin, tag, frozen, gameOver
const sfx: Partial<Record<SfxId, Howl>> = {};

// Track currently playing music to avoid redundant play() calls
let currentMusicId: MusicId | null = null;

// Debug logging
const DEBUG_SOUND = true;
function soundLog(...args: unknown[]) {
  if (DEBUG_SOUND) console.log('[SoundService]', ...args);
}

// Periodic status check to see when music stops
if (DEBUG_SOUND && typeof window !== 'undefined') {
  setInterval(() => {
    const playingTracks = (Object.keys(music) as MusicId[]).filter(id => music[id]?.playing());
    if (currentMusicId || playingTracks.length > 0) {
      console.log('[SoundService] STATUS: currentMusicId=' + currentMusicId + ', actuallyPlaying=' + JSON.stringify(playingTracks));
    }
  }, 2000);
}

function getMusic(id: MusicId): Howl {
  if (!music[id]) {
    music[id] = new Howl({
      src: [PATHS[id]],
      loop: true,
      volume: musicVolumes[id],
    });
  }
  return music[id];
}

function getSfx(id: SfxId): Howl {
  if (!sfx[id]) {
    sfx[id] = new Howl({ src: [PATHS[id]], loop: false, volume: 0.6 });
  }
  return sfx[id];
}

function resumeAudioContext(): void {
  try {
    if (HowlGlobal.ctx?.state === 'suspended' && typeof HowlGlobal.ctx.resume === 'function') {
      HowlGlobal.ctx.resume();
    }
  } catch {
    // ignore
  }
}

export const soundService = {
  playMusic(id: MusicId) {
    const isCurrentlyPlaying = music[id]?.playing();
    soundLog(`playMusic('${id}') called. currentMusicId=${currentMusicId}, isPlaying=${isCurrentlyPlaying}`);
    
    // Skip if already playing this track (avoids interrupting the loop)
    if (currentMusicId === id && isCurrentlyPlaying) {
      soundLog(`  -> Skipping, already playing '${id}'`);
      return;
    }
    if (typeof Howler !== 'undefined') HowlGlobal.autoSuspend = false;
    resumeAudioContext();
    soundLog(`  -> Stopping all music, then playing '${id}'`);
    Object.values(music).forEach((m) => m?.stop());
    currentMusicId = id;
    getMusic(id).play();
    soundLog(`  -> Started '${id}', playing=${music[id]?.playing()}`);
  },
  stopMusic() {
    soundLog(`stopMusic() called. currentMusicId=${currentMusicId}`);
    Object.values(music).forEach((m) => m?.stop());
    currentMusicId = null;
  },
  /** Check if a specific music track is currently playing */
  isPlaying(id: MusicId): boolean {
    return currentMusicId === id && !!music[id]?.playing();
  },
  playSfx(id: SfxId) {
    resumeAudioContext();
    getSfx(id).play();
  },
  /** Set volume for all music (0–1). */
  setMusicVolume(vol: number) {
    (Object.keys(musicVolumes) as MusicId[]).forEach((id) => {
      musicVolumes[id] = vol;
      music[id]?.volume(vol);
    });
  },
  /** Set volume for one music track (0–1). Use for hunt vs menu, etc. */
  setTrackVolume(id: MusicId, vol: number) {
    const v = Math.max(0, Math.min(1, vol));
    musicVolumes[id] = v;
    music[id]?.volume(v);
  },
  /** Get current volume for a music track (0–1). */
  getTrackVolume(id: MusicId): number {
    return musicVolumes[id];
  },
  setSfxVolume(vol: number) {
    (Object.keys(sfx) as SfxId[]).forEach((id) => sfx[id]?.volume(vol));
  },
};
