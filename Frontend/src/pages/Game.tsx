import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trophy, X, Users } from 'lucide-react';
import socketService, { SOCKET_EVENTS, toGrid, toPixel, Room, Player as SocketPlayer, GameState as SocketGameState, Coin as SocketCoin, MapConfig } from '@/services/SocketService';
import BlitzQuiz from '@/components/BlitzQuiz';
import UnfreezeQuiz from '@/components/UnfreezeQuiz';
import logger from '@/utils/logger';
import { soundService } from '@/services/SoundServices';

const TILE_SIZE = 64;
// Default map dimensions (used when no mapConfig is available)
const DEFAULT_MAP_WIDTH = 30;
const DEFAULT_MAP_HEIGHT = 30;
const PERSPECTIVE_STRENGTH = 0.4;
const BASE_PLAYER_SPEED = 350;
const UNICORN_SPEED_MULTIPLIER = 1.2;
const ROLE_LABEL_CHASER = 'Enforcer';
const ROLE_LABEL_RUNNER = 'Bandit';

function getSpeedForRole(isUnicorn: boolean): number {
  return isUnicorn ? BASE_PLAYER_SPEED * UNICORN_SPEED_MULTIPLIER : BASE_PLAYER_SPEED;
}

const BASE_ENEMY_SPEED = 500;
const COLLECTIBLES_START_TIME = 30; // seconds before collectibles appear

// Colors
const C_ROAD = '#2a2a2a';
const C_SIDEWALK = '#3a3a3a';
const C_WATER = '#004466';
const C_LAVA = '#cf1020';
const C_LAVA_HOT = '#ff4500';
const C_GRASS = '#1e281e';
const C_TREE = '#1e551e';

const TYPE_RESIDENTIAL = 0;
const TYPE_SHOP = 1;
const TYPE_CAFE = 2;

interface Player {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  velX: number;
  velY: number;
  dirX: number;
  dirY: number;
  trail: { x: number; y: number }[];
  portalCooldown: number;
}

interface Enemy {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  trail: { x: number; y: number }[];
  stuckTime: number;
  flankTimer: number;
  flankDir: { x: number; y: number };
}

interface Portal {
  x: number;
  y: number;
  color: string;
  angle: number;
  life?: number;
  isPlayerCreated?: boolean;
}

interface Building {
  gridX: number;
  gridY: number;
  x: number;
  y: number;
  w: number;
  h: number;
  height: number;
  color: string;
  wallColor: string;
  type: number;
}

interface Tree {
  x: number;
  y: number;
  r: number;
}

// New Coin interface
interface Coin {
  id?: string;
  x: number;
  y: number;
  collected: boolean;
  spawnTime: number;
}

interface SinkCollectible {
  id?: string;
  x: number;
  y: number;
  collected: boolean;
  spawnTime: number;
}

interface DeployedSink {
  x: number;
  y: number;
  deployTime: number;
}

interface LeaderboardEntry {
  name: string;
  timeSurvived: number;
  date: string;
}

// Multiplayer leaderboard entry (used for both game-end and live leaderboard)
interface LeaderboardEntryMP {
  id: string;
  name: string;
  coins: number;
  questionsAttempted: number;
  questionsCorrect: number;
}

/** Map raw server leaderboard array to typed entries */
function mapLeaderboard(raw: any[]): LeaderboardEntryMP[] {
  return raw.map((p: any) => ({
    id: p?.playerId ?? p?.id ?? '',
    name: typeof p?.name === 'string' ? p.name : 'Player',
    coins: typeof p?.coins === 'number' ? p.coins : 0,
    questionsAttempted: typeof p?.questions_attempted === 'number' ? p.questions_attempted : 0,
    questionsCorrect: typeof p?.questions_correctly_answered === 'number' ? p.questions_correctly_answered : 0,
  }));
}

// Remote player for multiplayer
interface RemotePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  dirX: number;
  dirY: number;
  isUnicorn: boolean;
  isEliminated: boolean;
  isFrozen: boolean;
  inIFrames: boolean;
  lastUpdate: number;
}

const IFRAME_DURATION_MS = 3000;

// Unfreeze quiz question from server
interface UnfreezeQuestion {
  id: number;
  question: string;
  options: string[];
  questionImage?: string | null;
  optionImages?: (string | null)[];
}

// Location state from Lobby
interface LocationState {
  room?: Room;
  gameState?: SocketGameState;
  isRejoin?: boolean;
}

type GameState = 'name-entry' | 'playing' | 'game-over' | 'waiting-for-start' | 'blitz-quiz' | 'frozen' | 'spectating';

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Seeded random number generator for consistent map generation across clients
class SeededRandom {
  private seed: number;
  
  constructor(seed: string | number) {
    // Convert string seed to number using simple hash
    if (typeof seed === 'string') {
      this.seed = 0;
      for (let i = 0; i < seed.length; i++) {
        this.seed = ((this.seed << 5) - this.seed + seed.charCodeAt(i)) | 0;
      }
      this.seed = Math.abs(this.seed);
    } else {
      this.seed = seed;
    }
  }
  
  // Returns a random number between 0 and 1
  random(): number {
    // Mulberry32 PRNG algorithm
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  
  // Returns a random integer between min (inclusive) and max (exclusive)
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min)) + min;
  }
}

// Quadrant helper: 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right
const getQuadrant = (x: number, y: number, mapWidth: number, mapHeight: number): number => {
  const midX = (mapWidth * TILE_SIZE) / 2;
  const midY = (mapHeight * TILE_SIZE) / 2;
  if (x < midX && y < midY) return 0;
  if (x >= midX && y < midY) return 1;
  if (x < midX && y >= midY) return 2;
  return 3;
};

const Game: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as LocationState | null;
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('');
  const [statusColor, setStatusColor] = useState('#fff');
  const [rewardPopup, setRewardPopup] = useState<{ text: string; color: string } | null>(null);
  const [sinkInventory, setSinkInventory] = useState(0);
  const [coinsCollected, setCoinsCollected] = useState(0);
  const [gameTime, setGameTime] = useState(0);
  const [localInIFrames, setLocalInIFrames] = useState(false);
  const [localIFramesEndTime, setLocalIFramesEndTime] = useState(0);
  const [, setLocalIFramesTick] = useState(0);
  const localIFramesTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteIFramesTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [screenFlash, setScreenFlash] = useState<{ color: string; opacity: number } | null>(null);
  
  // Game state management
  const [gameState, setGameState] = useState<GameState>('name-entry');
  const [playerName, setPlayerName] = useState('');
  const playerNameRef = useRef('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [finalStats, setFinalStats] = useState({ time: 0 });
  const [gameEndLeaderboard, setGameEndLeaderboard] = useState<LeaderboardEntryMP[]>([]);
  const [liveLeaderboard, setLiveLeaderboard] = useState<LeaderboardEntryMP[]>([]);

  // Multiplayer state
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const isMultiplayerRef = useRef(false); // Ref to avoid stale closure in game loop
  const roomCodeRef = useRef<string | null>(null); // Store room code for seeded map generation
  const [room, setRoom] = useState<Room | null>(null);
  
  // Map configuration from backend (scales with player count)
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
  const mapConfigRef = useRef<MapConfig | null>(null);
  // Derived map dimensions - use backend config or defaults
  const MAP_WIDTH = mapConfig?.width ?? DEFAULT_MAP_WIDTH;
  const MAP_HEIGHT = mapConfig?.height ?? DEFAULT_MAP_HEIGHT;
  
  const [isUnicorn, setIsUnicorn] = useState(false);
  const [unicornIds, setUnicornIds] = useState<string[]>([]);
  const [unicornId, setUnicornId] = useState<string | null>(null); // backward compat / first unicorn
  const [connectedPlayers, setConnectedPlayers] = useState<SocketPlayer[]>([]);
  const remotePlayersRef = useRef<Map<string, RemotePlayer>>(new Map());
  
  const isUnicornRef = useRef(false);
  const isFrozenRef = useRef(false);
  const isRejoinRef = useRef(false);
  useEffect(() => {
    isUnicornRef.current = isUnicorn;
  }, [isUnicorn]);

  // Keep refs in sync with state
  useEffect(() => {
    isMultiplayerRef.current = isMultiplayer;
  }, [isMultiplayer]);
  
  useEffect(() => {
    roomCodeRef.current = room?.code || null;
  }, [room]);
  
  useEffect(() => {
    mapConfigRef.current = mapConfig;
  }, [mapConfig]);

  // Tick every 100ms while in i-frames so countdown UI updates
  useEffect(() => {
    if (!localInIFrames) return;
    const interval = setInterval(() => setLocalIFramesTick((t) => t + 1), 100);
    return () => clearInterval(interval);
  }, [localInIFrames]);

  const [huntTimeLeft, setHuntTimeLeft] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(4);
  
  // Blitz quiz state
  const [blitzQuestion, setBlitzQuestion] = useState<{
    question: string;
    options: string[];
    questionImage?: string | null;
    optionImages?: (string | null)[];
  } | null>(null);
  const [blitzTimeLeft, setBlitzTimeLeft] = useState(0);
  const isFirstBlitzRef = useRef(true);
  const blitzHandledRef = useRef(false); // Prevents race between BLITZ_START and GAME_STATE_SYNC
  const [blitzShowObjective, setBlitzShowObjective] = useState(false);
  
  // Role announcement state (shows before hunt phase)
  const [roleAnnouncement, setRoleAnnouncement] = useState<{
    isUnicorn: boolean;
    visible: boolean;
  } | null>(null);

  // Last round warning banner (top of screen for 3s when final hunt starts)
  const [showLastRoundWarning, setShowLastRoundWarning] = useState(false);
  const lastRoundBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Unfreeze quiz state (when player is frozen after being tagged)
  const [unfreezeQuizData, setUnfreezeQuizData] = useState<{
    questions: UnfreezeQuestion[];
    passThreshold: number;
  } | null>(null);
  
  // Track if we've already reported lava death (to prevent multiple reports per frame)
  const lavaDeathReportedRef = useRef(false);

  // When true, unmount will not call leaveRoom (user chose "Return to Lobby" after game over)
  const returningToLobbyRef = useRef(false);
  
  // Teleport effects ref for animation
  const teleportEffectsRef = useRef<Array<{
    x: number;
    y: number;
    type: 'in' | 'out';
    startTime: number;
    duration: number;
  }>>([]);

  // Helper to add teleport effect
  const addTeleportEffect = useCallback((x: number, y: number, type: 'in' | 'out') => {
    teleportEffectsRef.current.push({
      x,
      y,
      type,
      startTime: Date.now(),
      duration: 500 // 500ms effect
    });
  }, []);
  
  const gameRef = useRef<{
    player: Player;
    enemies: Enemy[];
    coins: Coin[];
    sinkCollectibles: SinkCollectible[];
    deployedSinks: DeployedSink[];
    map: {
      width: number;
      height: number;
      tiles: number[][];
      buildings: Building[];
      trees: Tree[];
      portals: Portal[];
    };
    camera: { x: number; y: number };
    keys: Record<string, boolean>;
    gameTime: number;
    enemySpawnTimer: number;
    coinSpawnTimer: number;
    sinkSpawnTimer: number;
    nextCoinSpawnTime: number;
    nextSinkSpawnTime: number;
    collectiblesInitialized: boolean;
    coinsInitialized: boolean;
    speedBoostApplied: boolean;
    coinsCollected: number;
    playerSinkInventory: number;
    lastTime: number;
    animationId: number | null;
    isPlaying: boolean;
    floatingRewards: { text: string; x: number; y: number; createdAt: number }[];
  } | null>(null);

  // Initialize from location state (multiplayer only – must have room from lobby)
  useEffect(() => {
    if (!locationState?.room) {
      navigate('/lobby', { replace: true });
      return;
    }
    
    // Detect stale browser-cached state: if we have locationState.room but socket is not connected
    // and this isn't a rejoin (which comes from Lobby with fresh connection), it means the browser
    // restored cached history state on page refresh. Redirect to /lobby for proper reconnection.
    if (!socketService.isConnected()) {
      logger.game('Detected stale cached state (socket not connected) - redirecting to lobby for reconnection');
      navigate('/lobby', { replace: true });
      return;
    }
    
    setIsMultiplayer(true);
    setRoom(locationState.room);
    // Store room code for reconnection
    socketService.setCurrentRoomCode(locationState.room.code);
    setPlayerName(localStorage.getItem('playerName') || 'Player');
    playerNameRef.current = localStorage.getItem('playerName') || 'Player';
    if (locationState.room.mapConfig) {
      setMapConfig(locationState.room.mapConfig);
    }
    if (gameRef.current) {
      gameRef.current.enemies = [];
    }

    // Handle rejoin - game is already in progress, need to sync state
    if (locationState.isRejoin) {
      logger.game('Rejoining game - syncing state');
      isRejoinRef.current = true;
      setGameState('playing');
      if (gameRef.current) {
        gameRef.current.isPlaying = true;
      }
      // Set connected players from room data
      setConnectedPlayers(locationState.room.players);
      // Set unicorn status from gameState or room
      if (locationState.gameState) {
        const gs = locationState.gameState;
        const ids = gs.unicornIds ?? (gs.unicornId ? [gs.unicornId] : []);
        setUnicornIds(ids);
        setUnicornId(ids[0] ?? gs.unicornId ?? null);
        setIsUnicorn(ids.includes(socketService.getPlayerId()));
      } else if (locationState.room.unicornIds) {
        setUnicornIds(locationState.room.unicornIds);
        setUnicornId(locationState.room.unicornIds[0] ?? null);
        setIsUnicorn(locationState.room.unicornIds.includes(socketService.getPlayerId()));
      }
      // Request full game state to fully sync everything
      setTimeout(() => {
        socketService.getGameState();
      }, 100);
    } else if (locationState.gameState) {
      // Normal game start with gameState
      setGameState('playing');
      if (gameRef.current) {
        gameRef.current.isPlaying = true;
      }
      const gs = locationState.gameState;
      const ids = gs.unicornIds ?? (gs.unicornId ? [gs.unicornId] : []);
      setUnicornIds(ids);
      setUnicornId(ids[0] ?? gs.unicornId ?? null);
      setIsUnicorn(ids.includes(socketService.getPlayerId()));
    } else {
      setGameState('waiting-for-start');
    }
  }, [locationState, navigate]);

  // Leave room when component unmounts (user navigates away from game)
  useEffect(() => {
    return () => {
      // Stop any playing music when leaving the game
      soundService.stopMusic();
      // Do not leave room when returning to lobby after game over (user stays in room)
      if (isMultiplayer && socketService.isConnected() && !returningToLobbyRef.current) {
        logger.game('Leaving room on game component unmount');
        socketService.leaveRoom();
        // Clear stored room code when intentionally leaving
        socketService.setCurrentRoomCode(null);
      }
    };
  }, [isMultiplayer]);

  // Show status helper (defined early for use in socket handlers)
  const showStatus = useCallback((text: string, color: string = '#fff', duration: number = 2000) => {
    setStatus(text);
    setStatusColor(color);
    setTimeout(() => setStatus(''), duration);
  }, []);

  // Multiplayer socket event handlers
  useEffect(() => {
    if (!isMultiplayer) return;

    // Position updates from other players
    const unsubPosition = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, (data: any) => {
      const { playerId, position } = data;
      if (playerId === socketService.getPlayerId()) return; // Ignore our own updates
      
      const remotePlayers = remotePlayersRef.current;
      const existing = remotePlayers.get(playerId);
      
      if (existing) {
        existing.targetX = position.x;
        existing.targetY = position.y;
        existing.dirX = position.dirX || 0;
        existing.dirY = position.dirY || 1;
        existing.lastUpdate = Date.now();
      } else {
        // New player
        remotePlayers.set(playerId, {
          id: playerId,
          name: position.name || 'Player',
          x: position.x,
          y: position.y,
          targetX: position.x,
          targetY: position.y,
          dirX: position.dirX || 0,
          dirY: position.dirY || 1,
          isUnicorn: unicornIds.includes(playerId),
          isEliminated: false,
          isFrozen: false,
          inIFrames: false,
          lastUpdate: Date.now()
        });
      }
    });

    // Player joined
    const unsubPlayerJoined = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_JOINED, (data: any) => {
      setConnectedPlayers(data.room.players);
      showStatus(`${data.player.name} joined!`, '#00ff00', 2000);
    });

    // Player left
    const unsubPlayerLeft = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_LEFT, (data: any) => {
      remotePlayersRef.current.delete(data.playerId);
      if (data.room) {
        setConnectedPlayers(data.room.players);
      }
      showStatus('A player left', '#ff8800', 2000);
    });

    // Room update (includes mapConfig changes when player count changes in lobby)
    const unsubRoomUpdate = socketService.on(SOCKET_EVENTS.SERVER.ROOM_UPDATE, (data: any) => {
      if (data.room) {
        setRoom(data.room);
        setConnectedPlayers(data.room.players);
        // Update mapConfig if it changed (only in waiting state)
        if (data.room.mapConfig && data.mapConfigChanged) {
          setMapConfig(data.room.mapConfig);
          logger.game(`Map config updated: ${data.room.mapConfig.width}x${data.room.mapConfig.height}`);
        }
      }
    });

    // Game started (initial start or teacher restart; applies even when gameState === 'game-over')
    const unsubGameStarted = socketService.on(SOCKET_EVENTS.SERVER.GAME_STARTED, (data: any) => {
      setGameState('playing');
      setRoom(data.room);
      isFirstBlitzRef.current = true; // Next blitz is first of this game → 3s objective intro
      blitzHandledRef.current = false; // Reset for new game
      
      // Set final mapConfig for the game (locked at game start)
      if (data.mapConfig) {
        setMapConfig(data.mapConfig);
      } else if (data.room?.mapConfig) {
        setMapConfig(data.room.mapConfig);
      }
      
      const ids = data.gameState?.unicornIds ?? (data.gameState?.unicornId ? [data.gameState.unicornId] : []);
      const isPlayerUnicorn = ids.includes(socketService.getPlayerId());
      setUnicornIds(ids);
      setUnicornId(ids[0] ?? data.gameState?.unicornId ?? null);
      setIsUnicorn(isPlayerUnicorn);
      const myId = socketService.getPlayerId();
      const remotePlayers = remotePlayersRef.current;
      if (data.gameState?.players) {
        data.gameState.players.forEach((p: any) => {
          if (p.id === myId) return;
          const pos = p.position;
          // const pixel = pos?.x != null ? { x: pos.x, y: pos.y } : (pos ? toPixel(pos.row, pos.col) : { x: 0, y: 0 });
          const pixel = (pos?.x != null && pos?.y != null) ? { x: pos.x, y: pos.y } : (pos?.row != null && pos?.col != null ? toPixel(pos.row, pos.col) : { x: 0, y: 0 });
          remotePlayers.set(p.id, {
            id: p.id,
            name: p.name || 'Player',
            x: pixel.x,
            y: pixel.y,
            targetX: pixel.x,
            targetY: pixel.y,
            dirX: 0,
            dirY: 1,
            isUnicorn: ids.includes(p.id),
            isEliminated: false,
            isFrozen: p.state === 'frozen',
            inIFrames: !!p.inIFrames,
            lastUpdate: Date.now()
          });
        });
      }
      // Start the game loop and set speed for role
      if (gameRef.current) {
        gameRef.current.isPlaying = true;
        gameRef.current.player.speed = getSpeedForRole(isPlayerUnicorn);
      }
      
      // Show initial role announcement
      setRoleAnnouncement({ isUnicorn: isPlayerUnicorn, visible: true });
      
      // Auto-hide after 2.5 seconds
      setTimeout(() => {
        setRoleAnnouncement(prev => prev ? { ...prev, visible: false } : null);
      }, 2500);
      
      showStatus('Game Started!', '#00ff00', 2000);
      console.log('[Music] GAME_STARTED -> stopMusic()');
      soundService.stopMusic();
    });

    // Unicorn transferred (single or multiple)
    const unsubUnicorn = socketService.on(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, (data: any) => {
      const ids = data.newUnicornIds ?? (data.newUnicornId ? [data.newUnicornId] : []);
      setUnicornIds(ids);
      setUnicornId(ids[0] ?? data.newUnicornId ?? null);
      const amUnicorn = ids.includes(socketService.getPlayerId());
      setIsUnicorn(amUnicorn);
      remotePlayersRef.current.forEach((player, id) => {
        player.isUnicorn = ids.includes(id);
      });
      if (gameRef.current) {
        gameRef.current.player.speed = getSpeedForRole(amUnicorn);
      }
      const socketId = socketService.getPlayerId();
      if (ids.includes(socketId)) {
        showStatus(ids.length > 1 ? `YOU ARE A ${ROLE_LABEL_CHASER}!` : `YOU ARE THE ${ROLE_LABEL_CHASER}!`, '#ff00ff', 3000);
        setScreenFlash({ color: '#ff00ff', opacity: 0.4 });
        setTimeout(() => setScreenFlash(null), 300);
      } else {
        const names = (data.room?.players ?? [])
          .filter((p: any) => ids.includes(p.id))
          .map((p: any) => p.name)
          .filter(Boolean);
        const text = names.length > 1
          ? `New ${ROLE_LABEL_CHASER}: ${names.join(', ')}`
          : `${names[0] || 'Someone'} is now the ${ROLE_LABEL_CHASER}!`;
        showStatus(text, '#ff00ff', 2000);
      }
    });

    // Hunt phase started
    const unsubHuntStart = socketService.on(SOCKET_EVENTS.SERVER.HUNT_START, (data: any) => {
      console.log('[Music] HUNT_START -> playMusic("hunt"), duration:', data.duration);
      soundService.stopMusic();
      soundService.setTrackVolume('hunt', 0.2);
      soundService.playMusic('hunt');
      // Hide role announcement when hunt starts
      setRoleAnnouncement(null);
      setGameState('playing');
      isFrozenRef.current = false;
      setBlitzQuestion(null);
      setHuntTimeLeft(data.duration / 1000);
      setCurrentRound(data.roundInfo?.currentRound || 1);
      setTotalRounds(data.roundInfo?.totalRounds || 4);
      const amUnicorn = data.unicornIds?.length !== undefined && data.unicornIds.includes(socketService.getPlayerId());
      if (data.unicornIds?.length !== undefined) {
        setUnicornIds(data.unicornIds);
        setUnicornId(data.unicornIds[0] ?? data.unicornId ?? null);
        setIsUnicorn(amUnicorn);
        remotePlayersRef.current.forEach((player, id) => {
          player.isUnicorn = data.unicornIds.includes(id);
        });
      }
      if (gameRef.current) {
        gameRef.current.player.speed = getSpeedForRole(amUnicorn ?? false);
      }
      // Flush sink trap inventory at start of each hunt round
      setSinkInventory(0);
      if (gameRef.current) {
        if (isMultiplayerRef.current) {
          if (gameRef.current.map?.portals) {
            gameRef.current.map.portals = [];
          }
          gameRef.current.coins = [];
          gameRef.current.sinkCollectibles = [];
          gameRef.current.deployedSinks = [];
          // So only current hunt's server events (COIN_SPAWNED, SINK_TRAP_*, etc.) apply
        }
        gameRef.current.playerSinkInventory = 0;
        gameRef.current.isPlaying = true;
      }
      // Populate live leaderboard at hunt start if available
      if (Array.isArray(data?.leaderboard)) {
        setLiveLeaderboard(mapLeaderboard(data.leaderboard));
      }

      showStatus(`HUNT PHASE - Round ${data.roundInfo?.currentRound || 1}!`, '#ff4400', 2000);

      // Last round: show red banner for 3s
      const roundInfo = data.roundInfo;
      const isLastRound = roundInfo && (roundInfo.roundsRemaining === 1 || roundInfo.currentRound === roundInfo.totalRounds);
      if (isLastRound) {
        if (lastRoundBannerTimeoutRef.current) {
          clearTimeout(lastRoundBannerTimeoutRef.current);
          lastRoundBannerTimeoutRef.current = null;
        }
        setShowLastRoundWarning(true);
        soundService.playSfx('last_round')
        lastRoundBannerTimeoutRef.current = setTimeout(() => {
          lastRoundBannerTimeoutRef.current = null;
          setShowLastRoundWarning(false);
        }, 3000);
      }
    });

    // Hunt phase ended (or timer update - backend sends HUNT_END for both)
    const unsubHuntEnd = socketService.on(SOCKET_EVENTS.SERVER.HUNT_END, (data: any) => {
      // Backend incorrectly uses HUNT_END for timer updates every 5s
      // Real hunt end has no remainingTime or remainingTime <= 0
      if (data?.remainingTime > 0) {
        // This is just a timer update, not actual hunt end - ignore for music
        console.log('[Music] HUNT_END (timer update, remainingTime=' + data.remainingTime + ') -> ignoring');
        return;
      }
      console.log('[Music] HUNT_END (actual end) -> stopMusic()');
      soundService.stopMusic();
      showStatus('Hunt phase ended!', '#888', 1500);
    });

    // Blitz quiz started
    const unsubBlitzStart = socketService.on(SOCKET_EVENTS.SERVER.BLITZ_START, (data: any) => {
      // Mark blitz as handled FIRST (sync ref) to prevent GAME_STATE_SYNC race condition
      blitzHandledRef.current = true;
      
      console.log('[Music] BLITZ_START -> playMusic("blitzQuiz")');
      soundService.playMusic('blitzQuiz');
      setGameState('blitz-quiz');
      setBlitzQuestion({
        question: data.question.question,
        options: data.question.options,
        questionImage: data.question.questionImage ?? null,
        optionImages: data.question.optionImages ?? []
      });
      setBlitzTimeLeft(data.timeLimit / 1000);
      showStatus('BLITZ QUIZ!', '#ffff00', 1500);

      if (isFirstBlitzRef.current) {
        setBlitzShowObjective(true);
        isFirstBlitzRef.current = false;
        setTimeout(() => setBlitzShowObjective(false), 3000);
      } else {
        setBlitzShowObjective(false);
      }
    });

    // Blitz answer result (correct = +10 bonus coins; show popup)
    const unsubBlitzAnswerResult = socketService.on(SOCKET_EVENTS.SERVER.BLITZ_ANSWER_RESULT, (data: any) => {
      if (data.isCorrect) {
        const bonus = data.bonusCoins ?? 10;
        setRewardPopup({ text: `+${bonus} coins!`, color: '#ffd700' });
        setTimeout(() => setRewardPopup(null), 1500);
      }
    });

    // Blitz quiz result
    const unsubBlitzResult = socketService.on(SOCKET_EVENTS.SERVER.BLITZ_RESULT, (data: any) => {
      blitzHandledRef.current = false; // Reset for next blitz round
      setBlitzQuestion(null);
      const ids = data.newUnicornIds ?? (data.newUnicornId ? [data.newUnicornId] : []);
      const isPlayerUnicorn = ids.includes(socketService.getPlayerId());
      setUnicornIds(ids);
      setUnicornId(ids[0] ?? data.newUnicornId ?? null);
      setIsUnicorn(isPlayerUnicorn);
      remotePlayersRef.current.forEach((player, id) => {
        player.isUnicorn = ids.includes(id);
      });
      
      // Show role announcement overlay before hunt starts
      setRoleAnnouncement({ isUnicorn: isPlayerUnicorn, visible: true });
      
      // Auto-hide after 3 seconds as backup (in case HUNT_START is delayed)
      setTimeout(() => {
        setRoleAnnouncement(prev => prev ? { ...prev, visible: false } : null);
      }, 3000);
    });

    // Player eliminated (fallback for any remaining instant kill scenarios)
    const unsubEliminated = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_ELIMINATED, (data: any) => {
      const { playerId, attackerId } = data;
      
      if (playerId === socketService.getPlayerId()) {
        // We got eliminated
        setGameState('spectating');
        showStatus('YOU WERE ELIMINATED!', '#ff0000', 3000);
        setScreenFlash({ color: '#ff0000', opacity: 0.5 });
        setTimeout(() => setScreenFlash(null), 300);
      } else {
        // Someone else got eliminated
        const eliminated = remotePlayersRef.current.get(playerId);
        if (eliminated) {
          eliminated.isEliminated = true;
          showStatus(`${eliminated.name} was eliminated!`, '#ff4400', 2000);
        }
      }
    });

    // Player state change (frozen, active, etc.)
    const unsubStateChange = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_STATE_CHANGE, (data: any) => {
      const { playerId, state, playerName, inIFrames } = data;
      const myId = socketService.getPlayerId();

      if (inIFrames === false) {
        if (playerId === myId) {
          if (localIFramesTimeoutRef.current) {
            clearTimeout(localIFramesTimeoutRef.current);
            localIFramesTimeoutRef.current = null;
          }
          setLocalInIFrames(false);
        } else {
          const t = remoteIFramesTimeoutsRef.current.get(playerId);
          if (t) {
            clearTimeout(t);
            remoteIFramesTimeoutsRef.current.delete(playerId);
          }
          const remotePlayer = remotePlayersRef.current.get(playerId);
          if (remotePlayer) remotePlayer.inIFrames = false;
        }
      }

      if (playerId === myId) {
        // Our state changed
        if (state === 'frozen') {
          soundService.playSfx('frozen');
          // We got frozen - set state immediately so we show loading/frozen UI
          // The UNFREEZE_QUIZ_START event should follow shortly with quiz questions
          setGameState('frozen');
          isFrozenRef.current = true;
          showStatus('YOU\'VE BEEN JAILED!', '#00ffff', 2000);
          setScreenFlash({ color: '#00ffff', opacity: 0.5 });
          setTimeout(() => setScreenFlash(null), 300);
          
          // Fallback: If we don't receive quiz data within 3 seconds, request it
          // This handles cases where UNFREEZE_QUIZ_START was lost/delayed
          setTimeout(() => {
            // Only request if we're still frozen and don't have quiz data
            setUnfreezeQuizData(currentQuizData => {
              if (currentQuizData === null) {
                logger.quiz('No quiz data received after freeze - requesting from server');
                socketService.requestUnfreezeQuiz();
              }
              return currentQuizData;
            });
          }, 3000);
        } else if (state === 'active') {
          // We're active again (unfrozen)
          isFrozenRef.current = false;
          if (gameState === 'frozen') {
            setGameState('playing');
            setUnfreezeQuizData(null);
          }
        }
      } else {
        // Remote player state changed
        const remotePlayer = remotePlayersRef.current.get(playerId);
        if (remotePlayer) {
          remotePlayer.isFrozen = state === 'frozen';
          if (state === 'frozen') {
            showStatus(`${remotePlayer.name} was frozen!`, '#00ffff', 1500);
          }
        }
      }
    });

    // Player tagged (visual feedback when someone gets tagged)
    const unsubPlayerTagged = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_TAGGED, (data: any) => {
      const { unicornId, caughtId, caughtName, unicornName, coinsGained } = data;
      const myId = socketService.getPlayerId();

      if (unicornId === myId) {
        soundService.playSfx('tag');
        showStatus(`You tagged ${caughtName}! +${coinsGained ?? 15} coins!`, '#ff00ff', 2000);
        const game = gameRef.current;
        if (game) {
          game.floatingRewards.push({
            text: '+15💰',
            x: game.player.x,
            y: game.player.y,
            createdAt: Date.now(),
          });
        }
      } else if (caughtId !== myId) {
        // Someone else got tagged (not me)
        showStatus(`${caughtName} was caught by ${unicornName}!`, '#ff4400', 2000);
      }
    });

    // Unfreeze quiz started (we got tagged and frozen)
    const unsubUnfreezeStart = socketService.on(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_START, (data: any) => {
      setGameState('frozen');
      isFrozenRef.current = true;
      setUnfreezeQuizData({
        questions: data.questions,
        passThreshold: data.passThreshold
      });
    });

    // Unfreeze quiz complete
    const unsubUnfreezeComplete = socketService.on(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_COMPLETE, (data: any) => {
      if (data.passed) {
        setGameState('playing');
        isFrozenRef.current = false;
        setUnfreezeQuizData(null);
        lavaDeathReportedRef.current = false; // Reset so lava death can be reported again
        showStatus('UNFROZEN! Back in the game!', '#00ff00', 2000);
        setScreenFlash({ color: '#00ff00', opacity: 0.3 });
        setTimeout(() => setScreenFlash(null), 300);
        // Start local i-frames immediately (server will send PLAYER_RESPAWN with inIFrames; this ensures UI shows even if event order differs)
        if (localIFramesTimeoutRef.current) {
          clearTimeout(localIFramesTimeoutRef.current);
          localIFramesTimeoutRef.current = null;
        }
        setLocalInIFrames(true);
        setLocalIFramesEndTime(Date.now() + IFRAME_DURATION_MS);
        localIFramesTimeoutRef.current = setTimeout(() => {
          setLocalInIFrames(false);
          localIFramesTimeoutRef.current = null;
        }, IFRAME_DURATION_MS);
      } else if (data.retry) {
        // Failed - new questions will arrive via UNFREEZE_QUIZ_START
        showStatus('Wrong! Try again...', '#ff4400', 1500);
      }
    });

    // Unfreeze quiz cancelled (blitz starting or game ending)
    const unsubUnfreezeCancelled = socketService.on(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_CANCELLED, (data: any) => {
      setGameState('playing');
      isFrozenRef.current = false;
      setUnfreezeQuizData(null);
      lavaDeathReportedRef.current = false; // Reset so lava death can be reported again
      showStatus(data.message || 'Quiz cancelled - you\'ve been unfrozen!', '#ffff00', 2000);
    });

    // Player respawn (after unfreeze quiz passed)
    const unsubPlayerRespawn = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_RESPAWN, (data: any) => {
      const { playerId, position, inIFrames } = data;
      const myId = socketService.getPlayerId();

      // Helper to validate and correct spawn position using current map tiles
      const getValidatedPixel = (row: number, col: number): { x: number; y: number } => {
        const game = gameRef.current;
        const mapH = game?.map?.tiles?.length ?? 30;
        const mapW = game?.map?.tiles?.[0]?.length ?? 30;
        
        // Check if tile is a road (type 0)
        if (game?.map?.tiles?.[row]?.[col] === 0) {
          return toPixel(row, col);
        }
        
        // Snap to nearest road intersection (multiples of 4)
        const correctedRow = Math.max(4, Math.min(mapH - 5, Math.round(row / 4) * 4));
        const correctedCol = Math.max(4, Math.min(mapW - 5, Math.round(col / 4) * 4));
        logger.game(`Correcting invalid respawn position (${row},${col}) to (${correctedRow},${correctedCol})`);
        return toPixel(correctedRow, correctedCol);
      };

      if (playerId === myId) {
        // We respawned - update our position
        isFrozenRef.current = false;
        lavaDeathReportedRef.current = false; // Reset so lava death can be reported again
        if (gameRef.current && position) {
          // Use pixel coordinates if available, otherwise validate and convert row/col
          const pixel = (position.x != null && position.y != null) 
            ? { x: position.x, y: position.y }
            : getValidatedPixel(position.row, position.col);
          gameRef.current.player.x = pixel.x;
          gameRef.current.player.y = pixel.y;
          gameRef.current.player.trail = [];
        }
        // Server always grants i-frames on respawn; show Protected (use payload or fallback to true)
        if (inIFrames !== false) {
          if (localIFramesTimeoutRef.current) {
            clearTimeout(localIFramesTimeoutRef.current);
            localIFramesTimeoutRef.current = null;
          }
          setLocalInIFrames(true);
          setLocalIFramesEndTime(Date.now() + IFRAME_DURATION_MS);
          localIFramesTimeoutRef.current = setTimeout(() => {
            setLocalInIFrames(false);
            localIFramesTimeoutRef.current = null;
          }, IFRAME_DURATION_MS);
        }
      } else {
        // Remote player respawned
        const remotePlayer = remotePlayersRef.current.get(playerId);
        if (remotePlayer && position) {
          // Use pixel coordinates if available, otherwise validate and convert row/col
          const pixel = (position.x != null && position.y != null)
            ? { x: position.x, y: position.y }
            : getValidatedPixel(position.row, position.col);
          remotePlayer.x = pixel.x;
          remotePlayer.y = pixel.y;
          remotePlayer.targetX = pixel.x;
          remotePlayer.targetY = pixel.y;
          remotePlayer.isFrozen = false;
        }
        if (inIFrames === true && remotePlayer) {
          const prev = remoteIFramesTimeoutsRef.current.get(playerId);
          if (prev) clearTimeout(prev);
          remotePlayer.inIFrames = true;
          remoteIFramesTimeoutsRef.current.set(playerId, setTimeout(() => {
            const r = remotePlayersRef.current.get(playerId);
            if (r) r.inIFrames = false;
            remoteIFramesTimeoutsRef.current.delete(playerId);
          }, IFRAME_DURATION_MS));
        }
      }
    });

    // Coin spawned
    const unsubCoinSpawned = socketService.on(SOCKET_EVENTS.SERVER.COIN_SPAWNED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      
      const coins = data.coins || [data];
      coins.forEach((coinData: any) => {
        const pixel = toPixel(coinData.row, coinData.col);
        game.coins.push({
          id: coinData.id ?? coinData.coinId,
          x: pixel.x,
          y: pixel.y,
          collected: false,
          spawnTime: Date.now() * 0.001
        });
      });
    });

    // Coin collected (server is authoritative: match by coinId + position, then id-only, then row/col)
    const unsubCoinCollected = socketService.on(SOCKET_EVENTS.SERVER.COIN_COLLECTED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      
      let coinIndex = -1;
      const hasPos = data.row != null && data.col != null;
      if (data.coinId && hasPos) {
        coinIndex = game.coins.findIndex(c => {
          if (c.collected) return false;
          const grid = toGrid(c.x, c.y);
          return c.id === data.coinId && grid.row === data.row && grid.col === data.col;
        });
      }
      if (coinIndex === -1 && data.coinId) {
        coinIndex = game.coins.findIndex(c => !c.collected && c.id === data.coinId);
      }
      if (coinIndex === -1 && hasPos) {
        coinIndex = game.coins.findIndex(c => {
          const grid = toGrid(c.x, c.y);
          return !c.collected && grid.row === data.row && grid.col === data.col;
        });
      }
      if (coinIndex !== -1) {
        game.coins[coinIndex].collected = true;
      }
      
      if (data.playerId === socketService.getPlayerId()) {
        soundService.playSfx('coin');
        setCoinsCollected(data.newScore ?? game.coinsCollected + 1);
        showStatus(`+${data.value ?? 5} coins!`, '#ffd700', 1500);
        game.floatingRewards.push({
          text: '+5💰',
          x: game.player.x,
          y: game.player.y,
          createdAt: Date.now(),
        });
      }
      // Update live leaderboard from coin collect payload
      if (Array.isArray(data?.leaderboard)) {
        setLiveLeaderboard(mapLeaderboard(data.leaderboard));
      }
    });

    // Game ended
    const unsubGameEnd = socketService.on(SOCKET_EVENTS.SERVER.GAME_END, (data: any) => {
      console.log('[Music] GAME_END -> stopMusic()');
      soundService.stopMusic();
      soundService.playSfx('gameOver');
      setGameState('game-over');
      setFinalStats({ time: gameRef.current?.gameTime || 0 });
      if (Array.isArray(data?.leaderboard)) {
        setGameEndLeaderboard(mapLeaderboard(data.leaderboard));
      } else {
        setGameEndLeaderboard([]);
      }
      showStatus('GAME OVER!', '#ff0000', 3000);
    });

    // Score update (e.g. on tag) — update live leaderboard
    const unsubScoreUpdate = socketService.on(SOCKET_EVENTS.SERVER.SCORE_UPDATE, (data: any) => {
      if (Array.isArray(data?.leaderboard)) {
        setLiveLeaderboard(mapLeaderboard(data.leaderboard));
      }
    });

    // Room closed (kicked from room after game ended)
    const unsubRoomLeft = socketService.on(SOCKET_EVENTS.SERVER.ROOM_LEFT, (data: any) => {
      soundService.stopMusic();
      if (data?.reason === 'game_ended') {
        logger.game('Room closed after game ended, navigating to home');
        showStatus('Room closed. Returning to menu...', '#ffff00', 2000);
        // Give user time to see the message
        setTimeout(() => {
          navigate('/');
        }, 2000);
      }
    });

    // Sinkhole spawned
    const unsubSinkholeSpawned = socketService.on(SOCKET_EVENTS.SERVER.SINKHOLE_SPAWNED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      
      // Handle both single sinkhole and batch spawns
      const sinkholes = data.sinkholes || [data];
      sinkholes.forEach((sinkholeData: any) => {
        const pixel = toPixel(sinkholeData.row, sinkholeData.col);
        game.map.portals.push({
          x: pixel.x,
          y: pixel.y,
          color: sinkholeData.color || `hsl(${Math.random() * 360}, 100%, 50%)`,
          angle: 0
        });
      });
    });

    // Player teleported
    const unsubPlayerTeleported = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_TELEPORTED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      const { playerId, fromPosition, toPosition } = data;
      
      // Add teleportation animation effect at both positions
      // We'll use a simple particle effect
      addTeleportEffect(fromPosition.x, fromPosition.y, 'out');
      addTeleportEffect(toPosition.x, toPosition.y, 'in');
      
      if (playerId === socketService.getPlayerId()) {
        // Local player teleported - update position immediately
        game.player.x = toPosition.x;
        game.player.y = toPosition.y;
        game.player.trail = [];
        game.player.portalCooldown = 2.0;
        showStatus('TELEPORTED!', '#00ffff', 1500);
        setScreenFlash({ color: '#00ffff', opacity: 0.3 });
        setTimeout(() => setScreenFlash(null), 200);
        soundService.playSfx('teleport');
      } else {
        // Remote player teleported - update their position
        const remotePlayer = remotePlayersRef.current.get(playerId);
        if (remotePlayer) {
          remotePlayer.x = toPosition.x;
          remotePlayer.y = toPosition.y;
          remotePlayer.targetX = toPosition.x;
          remotePlayer.targetY = toPosition.y;
        }
      }
    });

    // Sink trap spawned (store id for collection)
    const unsubSinkTrapSpawned = socketService.on(SOCKET_EVENTS.SERVER.SINK_TRAP_SPAWNED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      const pixel = toPixel(data.row, data.col);
      game.sinkCollectibles.push({
        id: data.id ?? undefined,
        x: pixel.x,
        y: pixel.y,
        collected: false,
        spawnTime: Date.now() * 0.001
      });
    });

    // Sink trap collected (server sends trapId, playerId, playerName, newInventoryCount)
    const unsubSinkTrapCollected = socketService.on(SOCKET_EVENTS.SERVER.SINK_TRAP_COLLECTED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      
      const trapIndex = game.sinkCollectibles.findIndex(s => !s.collected && s.id === data.trapId);
      if (trapIndex !== -1) {
        game.sinkCollectibles[trapIndex].collected = true;
      }
      
      if (data.playerId === socketService.getPlayerId()) {
        game.playerSinkInventory = data.newInventoryCount ?? game.playerSinkInventory + 1;
        setSinkInventory(data.newInventoryCount ?? game.playerSinkInventory);
        showStatus('SINK TRAP COLLECTED!', '#ff6600', 1500);
        soundService.playSfx('sink_trap');
        game.floatingRewards.push({
          text: 'Spacebar to deploy',
          x: game.player.x,
          y: game.player.y,
          createdAt: Date.now(),
        });
      }
    });

    // Sink trap deployed
    const unsubSinkTrapDeployed = socketService.on(SOCKET_EVENTS.SERVER.SINK_TRAP_DEPLOYED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      
      // Add to deployed traps
      game.deployedSinks.push({
        x: data.x,
        y: data.y,
        deployTime: Date.now()
      });
      
      // Update our inventory if we deployed it
      if (data.playerId === socketService.getPlayerId()) {
        game.playerSinkInventory = data.newInventoryCount;
        setSinkInventory(data.newInventoryCount);
        showStatus('TRAP DEPLOYED!', '#ff6600', 1500);
      }
    });

    // Sink trap triggered (unicorn stepped on it)
    const unsubSinkTrapTriggered = socketService.on(SOCKET_EVENTS.SERVER.SINK_TRAP_TRIGGERED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      const { unicornId, fromPosition, toPosition } = data;
      
      // Remove the triggered trap
      const trapIndex = game.deployedSinks.findIndex(s => 
        Math.hypot(s.x - fromPosition.x, s.y - fromPosition.y) < 32
      );
      if (trapIndex !== -1) {
        game.deployedSinks.splice(trapIndex, 1);
      }
      
      // Add teleport effects
      addTeleportEffect(fromPosition.x, fromPosition.y, 'out');
      addTeleportEffect(toPosition.x, toPosition.y, 'in');
      
      if (unicornId === socketService.getPlayerId()) {
        // We (unicorn) got trapped
        game.player.x = toPosition.x;
        game.player.y = toPosition.y;
        game.player.trail = [];
        showStatus('TRAPPED! Teleported away!', '#ff4400', 2000);
        setScreenFlash({ color: '#ff4400', opacity: 0.4 });
        setTimeout(() => setScreenFlash(null), 300);
      } else {
        // Unicorn got trapped
        const remotePlayer = remotePlayersRef.current.get(unicornId);
        if (remotePlayer) {
          remotePlayer.x = toPosition.x;
          remotePlayer.y = toPosition.y;
          remotePlayer.targetX = toPosition.x;
          remotePlayer.targetY = toPosition.y;
        }
        showStatus(`${ROLE_LABEL_CHASER} TRAPPED!`, '#00ff00', 2000);
      }
    });

    // Game state sync (for reconnection recovery and initial blitz quiz sync)
    // Handles:
    // 1. Populate/update remote players with names (we navigate from Lobby so we miss GAME_STARTED)
    // 2. Blitz quiz sync when client misses BLITZ_START due to navigation timing
    // 3. Frozen player recovery with unfreeze quiz data
    const unsubGameStateSync = socketService.on(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, (data: any) => {
      if (!data.gameState) return;
      
      // Sync mapConfig on reconnection
      if (data.mapConfig) {
        setMapConfig(data.mapConfig);
      }

      // Update live leaderboard from game state sync
      if (Array.isArray(data.gameState?.leaderboard)) {
        setLiveLeaderboard(mapLeaderboard(data.gameState.leaderboard));
      }
      
      const myId = socketService.getPlayerId();
      const myPlayer = data.gameState.players?.find((p: any) => p.id === myId);
      const remotePlayers = remotePlayersRef.current;
      const unicornIdsSync = data.gameState.unicornIds ?? (data.gameState.unicornId ? [data.gameState.unicornId] : []);

      // Sync local unicorn state (reconnection)
      setUnicornIds(unicornIdsSync);
      setUnicornId(unicornIdsSync[0] ?? data.gameState.unicornId ?? null);
      setIsUnicorn(unicornIdsSync.includes(myId));

      // Populate or update remote players from game state (ensures names are set when we mounted after GAME_STARTED)
      if (data.gameState.players) {
        data.gameState.players.forEach((p: any) => {
          if (p.id === myId) return;
          const pos = p.position;
          const pixel = (pos?.x != null && pos?.y != null) ? { x: pos.x, y: pos.y } : (pos?.row != null && pos?.col != null ? toPixel(pos.row, pos.col) : { x: 0, y: 0 });
          const existing = remotePlayers.get(p.id);
          if (existing) {
            existing.name = p.name || existing.name || 'Player';
            existing.x = pixel.x;
            existing.y = pixel.y;
            existing.targetX = pixel.x;
            existing.targetY = pixel.y;
            existing.isFrozen = p.state === 'frozen';
            existing.isUnicorn = unicornIdsSync.includes(p.id);
            if (p.inIFrames !== undefined) existing.inIFrames = !!p.inIFrames;
          } else {
            remotePlayers.set(p.id, {
              id: p.id,
              name: p.name || 'Player',
              x: pixel.x,
              y: pixel.y,
              targetX: pixel.x,
              targetY: pixel.y,
              dirX: 0,
              dirY: 1,
              isUnicorn: unicornIdsSync.includes(p.id),
              isEliminated: false,
              isFrozen: p.state === 'frozen',
              inIFrames: !!p.inIFrames,
              lastUpdate: Date.now()
            });
          }
        });
      }
      
      // Populate game collectibles from game state (reconnection recovery)
      if (gameRef.current) {
        const game = gameRef.current;
        
        // Restore coins
        if (Array.isArray(data.gameState.coins)) {
          game.coins = data.gameState.coins.map((coin: any) => {
            const pixel = toPixel(coin.row, coin.col);
            return {
              id: coin.id,
              x: pixel.x,
              y: pixel.y,
              collected: false,
              spawnTime: Date.now() * 0.001
            };
          });
          logger.game(`Restored ${game.coins.length} coins from game state`);
        }
        
        // Restore sinkholes/portals
        if (Array.isArray(data.gameState.sinkholes) && game.map?.portals) {
          game.map.portals = data.gameState.sinkholes.map((sinkhole: any) => {
            const pixel = toPixel(sinkhole.row, sinkhole.col);
            return {
              x: pixel.x,
              y: pixel.y,
              color: sinkhole.color || `hsl(${Math.random() * 360}, 100%, 50%)`,
              angle: 0
            };
          });
          logger.game(`Restored ${game.map.portals.length} sinkholes from game state`);
        }
        
        // Restore sink trap collectibles
        if (Array.isArray(data.gameState.sinkTraps)) {
          game.sinkCollectibles = data.gameState.sinkTraps.map((trap: any) => {
            const pixel = toPixel(trap.row, trap.col);
            return {
              id: trap.id,
              x: pixel.x,
              y: pixel.y,
              collected: false,
              spawnTime: Date.now() * 0.001
            };
          });
          logger.game(`Restored ${game.sinkCollectibles.length} sink trap collectibles from game state`);
        }
        
        // Restore deployed sink traps
        if (Array.isArray(data.gameState.deployedSinkTraps)) {
          const TILE_SIZE = 64;
          game.deployedSinks = data.gameState.deployedSinkTraps.map((trap: any) => ({
            x: trap.col * TILE_SIZE + TILE_SIZE / 2,
            y: trap.row * TILE_SIZE + TILE_SIZE / 2,
            deployTime: trap.deployTime || Date.now()
          }));
          logger.game(`Restored ${game.deployedSinks.length} deployed sink traps from game state`);
        }
        
        // Restore player's sink trap inventory
        if (myPlayer?.sinkInventory !== undefined) {
          game.playerSinkInventory = myPlayer.sinkInventory;
          setSinkInventory(myPlayer.sinkInventory);
          logger.game(`Restored sink inventory: ${myPlayer.sinkInventory}`);
        }
      }
      
      // Start appropriate music based on current phase (reconnection recovery)
      // This handles the case where we refresh during hunt and miss HUNT_START
      if (data.phase === 'hunt') {
        logger.game('Game state sync: Hunt phase active, starting hunt music');
        setGameState('playing');
        if (!soundService.isPlaying('hunt') && !soundService.isPlaying('timer')) {
          soundService.setTrackVolume('hunt', 0.2);
          soundService.playMusic('hunt');
        }
      }
      
      // Handle blitz quiz sync - this fixes the race condition where
      // the client navigates to /game and misses BLITZ_START
      if (data.phase === 'blitz_quiz' && data.blitzQuiz) {
        logger.quiz('Game state sync: Received blitz quiz data');
        
        // Skip if BLITZ_START already handled this blitz (prevents race condition)
        if (blitzHandledRef.current) {
          logger.quiz('Blitz already handled by BLITZ_START, skipping sync');
          return;
        }
        
        // Only set up blitz quiz if we don't already have one active (reconnect / late join)
        setBlitzQuestion(currentQuestion => {
          if (currentQuestion === null) {
            // Mark as handled to prevent any late BLITZ_START from double-processing
            blitzHandledRef.current = true;
            // First blitz for this client: show 3s objective (same as BLITZ_START path)
            if (isFirstBlitzRef.current) {
              setBlitzShowObjective(true);
              isFirstBlitzRef.current = false;
              setTimeout(() => setBlitzShowObjective(false), 3000);
            } else {
              setBlitzShowObjective(false);
            }
            logger.quiz('Setting up blitz quiz from state sync:', data.blitzQuiz.question.question);
            
            // Calculate remaining time from server data
            const timeRemaining = data.blitzQuiz.timeRemaining || data.blitzQuiz.timeLimit;
            setBlitzTimeLeft(Math.ceil(timeRemaining / 1000));
            setGameState('blitz-quiz');
            showStatus('BLITZ QUIZ!', '#ffff00', 1500);
            
            // Start blitz quiz music (reconnection recovery)
            if (!soundService.isPlaying('blitzQuiz')) {
              soundService.playMusic('blitzQuiz');
            }
            
            return {
              question: data.blitzQuiz.question.question,
              options: data.blitzQuiz.question.options,
              questionImage: data.blitzQuiz.question.questionImage ?? null,
              optionImages: data.blitzQuiz.question.optionImages ?? []
            };
          }
          return currentQuestion;
        });
      }
      
      // Handle frozen player recovery
      if (myPlayer && myPlayer.state === 'frozen') {
        logger.quiz('Game state sync: Player is frozen, checking quiz state');
        
        // We're frozen according to server state
        setGameState('frozen');
        
        // Check if we already have quiz data
        setUnfreezeQuizData(currentQuizData => {
          if (currentQuizData === null) {
            // No quiz data - request it from server
            logger.quiz('Reconnection recovery: Requesting unfreeze quiz from server');
            // Small delay to let other sync events process first
            setTimeout(() => {
              socketService.requestUnfreezeQuiz();
            }, 500);
          }
          return currentQuizData;
        });
      }
    });

    // Player temporarily disconnected (show visual feedback)
    const unsubPlayerDisconnected = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_DISCONNECTED, (data: any) => {
      const { playerId, playerName } = data;
      logger.game(`Player ${playerName} temporarily disconnected`);
      showStatus(`${playerName} disconnected...`, '#ffaa00', 3000);
      
      // Mark remote player as disconnected (visual feedback)
      const remotePlayers = remotePlayersRef.current;
      const player = remotePlayers.get(playerId);
      if (player) {
        // Could add a visual indicator here if needed
      }
    });

    // Player reconnected (within grace period)
    const unsubPlayerReconnected = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_RECONNECTED, (data: any) => {
      const { playerId, playerName } = data;
      logger.game(`Player ${playerName} reconnected`);
      showStatus(`${playerName} reconnected!`, '#00ff00', 2000);
    });

    // Rejoin success (we reconnected successfully)
    const unsubRejoinSuccess = socketService.on(SOCKET_EVENTS.SERVER.REJOIN_SUCCESS, (data: any) => {
      logger.game('Successfully rejoined room');
      showStatus('Reconnected!', '#00ff00', 2000);
      
      // Update room and game state from server
      if (data.room) {
        setRoom(data.room);
        setConnectedPlayers(data.room.players);
        if (data.room.mapConfig) {
          setMapConfig(data.room.mapConfig);
        }
      }
      
      // Request full game state to sync everything
      socketService.getGameState();
    });

    // Rejoin error (couldn't reconnect - room no longer exists or player removed)
    const unsubRejoinError = socketService.on(SOCKET_EVENTS.SERVER.REJOIN_ERROR, (data: any) => {
      logger.game('Failed to rejoin room:', data.message);
      showStatus('Could not reconnect', '#ff0000', 3000);
      // Clear stored room code since we can't rejoin
      socketService.setCurrentRoomCode(null);
      // Navigate back to lobby after a brief delay
      setTimeout(() => {
        navigate('/lobby', { replace: true });
      }, 2000);
    });

    // Auto-rejoin on socket reconnection
    const unsubConnectionChange = socketService.onConnectionChange((connected: boolean) => {
      if (connected) {
        const storedRoomCode = socketService.getCurrentRoomCode();
        if (storedRoomCode) {
          logger.game('Socket reconnected, attempting to rejoin room:', storedRoomCode);
          socketService.rejoinRoom(storedRoomCode);
        }
      } else {
        logger.game('Socket disconnected');
        showStatus('Connection lost...', '#ff0000', 3000);
      }
    });

    // Request current game state after all listeners are registered
    // This handles the race condition where:
    // 1. Backend sends GAME_STARTED, then immediately BLITZ_START
    // 2. Frontend navigates from Lobby to Game on GAME_STARTED
    // 3. Game.tsx mounts and registers listeners, but BLITZ_START was already sent
    // By requesting game state here, we catch any active blitz quiz we missed
    logger.game('Requesting game state after socket listeners registered');
    socketService.getGameState();

    return () => {
      unsubPosition();
      unsubPlayerJoined();
      unsubPlayerLeft();
      unsubRoomUpdate();
      unsubGameStarted();
      unsubUnicorn();
      unsubHuntStart();
      unsubHuntEnd();
      unsubBlitzStart();
      unsubBlitzAnswerResult();
      unsubBlitzResult();
      unsubEliminated();
      unsubStateChange();
      unsubPlayerTagged();
      unsubUnfreezeStart();
      unsubUnfreezeComplete();
      unsubUnfreezeCancelled();
      unsubPlayerRespawn();
      unsubCoinSpawned();
      unsubCoinCollected();
      unsubGameEnd();
      unsubScoreUpdate();
      unsubRoomLeft();
      unsubSinkholeSpawned();
      unsubPlayerTeleported();
      unsubSinkTrapSpawned();
      unsubSinkTrapCollected();
      unsubSinkTrapDeployed();
      unsubSinkTrapTriggered();
      unsubGameStateSync();
      unsubPlayerDisconnected();
      unsubPlayerReconnected();
      unsubRejoinSuccess();
      unsubRejoinError();
      unsubConnectionChange();
    };
  }, [isMultiplayer, unicornIds, gameState, navigate, showStatus]);

  // Clear last-round banner timeout on unmount only (so the 3s hide timer is not cancelled when effect re-runs)
  useEffect(() => {
    return () => {
      if (lastRoundBannerTimeoutRef.current) {
        clearTimeout(lastRoundBannerTimeoutRef.current);
        lastRoundBannerTimeoutRef.current = null;
      }
    };
  }, []);

  // Timer effect for blitz and hunt timers (multiplayer)
  useEffect(() => {
    if (!isMultiplayer) return;
    
    const interval = setInterval(() => {
      setBlitzTimeLeft(prev => (prev > 0 ? Math.max(0, prev - 1) : prev));
      setHuntTimeLeft(prev => (prev > 0 ? Math.max(0, prev - 1) : prev));
    }, 1000);

    return () => clearInterval(interval);
  }, [isMultiplayer]);

  // Switch to timer warning music when hunt has 10s left
  useEffect(() => {
    if (huntTimeLeft === 10 && gameState === 'playing') {
      console.log('[Music] huntTimeLeft=10, gameState=playing -> playMusic("timer")');
      soundService.playMusic('timer');
    }
  }, [huntTimeLeft, gameState]);

  // Load leaderboard from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('qbit-city-leaderboard');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Convert old format if needed
        const converted = parsed.map((e: any) => ({
          name: e.name,
          timeSurvived: e.timeSurvived,
          date: e.date
        }));
        setLeaderboard(converted);
      } catch {
        setLeaderboard([]);
      }
    }
  }, []);

  const saveToLeaderboard = (name: string, time: number) => {
    const stored = localStorage.getItem('qbit-city-leaderboard');
    let lb: LeaderboardEntry[] = [];
    if (stored) {
      try {
        lb = JSON.parse(stored).map((e: any) => ({
          name: e.name,
          timeSurvived: e.timeSurvived,
          date: e.date
        }));
      } catch {
        lb = [];
      }
    }
    
    lb.push({
      name,
      timeSurvived: time,
      date: new Date().toISOString()
    });
    
    lb.sort((a, b) => b.timeSurvived - a.timeSurvived);
    const trimmed = lb.slice(0, 20);
    
    localStorage.setItem('qbit-city-leaderboard', JSON.stringify(trimmed));
    setLeaderboard(trimmed);
  };

  // Draw coin - Golden spinning coin
  const drawCoin = (ctx: CanvasRenderingContext2D, coin: Coin) => {
    const time = Date.now() * 0.005 + coin.spawnTime;
    const bob = Math.sin(time * 2) * 3;
    const spin = Math.cos(time * 3);
    
    ctx.save();
    ctx.translate(coin.x, coin.y + bob);
    
    // Golden glow
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 15;
    
    // Coin body (ellipse for 3D spin effect)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
    gradient.addColorStop(0, '#fff7a0');
    gradient.addColorStop(0.3, '#ffd700');
    gradient.addColorStop(0.7, '#daa520');
    gradient.addColorStop(1, '#b8860b');
    ctx.fillStyle = gradient;
    
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.abs(spin) * 12 + 2, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Coin shine
    ctx.shadowBlur = 0;
    if (spin > 0.3) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.ellipse(-3, -3, 3, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // $ symbol
    if (Math.abs(spin) > 0.5) {
      ctx.fillStyle = '#8b6914';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, 1);
    }
    
    ctx.restore();
  };

  // Draw sink collectible - Blackhole vortex icon
  const drawSinkCollectible = (ctx: CanvasRenderingContext2D, sink: SinkCollectible) => {
    const time = Date.now() * 0.004 + sink.spawnTime;
    const pulse = 0.9 + Math.sin(time * 2) * 0.1;
    const bob = Math.sin(time * 1.5) * 3;
    
    ctx.save();
    ctx.translate(sink.x, sink.y + bob);
    
    // Outer vortex glow
    ctx.shadowColor = '#9900ff';
    ctx.shadowBlur = 25 * pulse;
    
    // Swirling vortex rings
    for (let ring = 3; ring >= 0; ring--) {
      const ringRadius = 6 + ring * 5;
      const ringAngle = time * (2 + ring * 0.5);
      const alpha = 0.3 + (3 - ring) * 0.2;
      
      ctx.strokeStyle = `rgba(150, 0, 255, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius * pulse, ringAngle, ringAngle + Math.PI * 1.5);
      ctx.stroke();
    }
    
    // Black hole center
    ctx.shadowBlur = 0;
    const centerGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
    centerGradient.addColorStop(0, '#000000');
    centerGradient.addColorStop(0.7, '#220033');
    centerGradient.addColorStop(1, '#440066');
    ctx.fillStyle = centerGradient;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner swirl
    ctx.strokeStyle = '#cc00ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 3 + time * 4;
      const r = (i / 30) * 8;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Particles being sucked in
    ctx.fillStyle = '#ff00ff';
    for (let i = 0; i < 4; i++) {
      const angle = time * 2 + (i * Math.PI / 2);
      const dist = 20 + Math.sin(time * 5 + i) * 5;
      const px = Math.cos(angle) * dist;
      const py = Math.sin(angle) * dist;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  };

  // Draw deployed sink trap
  const drawDeployedSink = (ctx: CanvasRenderingContext2D, sink: DeployedSink, gameTime: number) => {
    const age = gameTime - sink.deployTime;
    const pulse = 1 + Math.sin(age * 8) * 0.15;
    
    ctx.save();
    ctx.translate(sink.x, sink.y);
    
    // Warning glow
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 30 * pulse;
    
    // Outer danger ring
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 25 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    
    // Inner trap
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#330000';
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    
    // Vortex effect
    ctx.strokeStyle = '#ff4400';
    ctx.lineWidth = 2;
    for (let ring = 0; ring < 3; ring++) {
      ctx.beginPath();
      const ringOffset = age * 5 + ring * 2;
      for (let i = 0; i < 30; i++) {
        const angle = (i / 30) * Math.PI * 2 + ringOffset;
        const r = 5 + ring * 5 - (i / 30) * 3;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    
    ctx.restore();
  };

  // Draw isometric Qbit
  const drawQbitIsometric = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    isPlayer: boolean,
    isWalking: boolean,
    isUnicornChar: boolean = false
  ) => {
    ctx.save();
    ctx.translate(x, y);

    const angle = Math.atan2(dirY, dirX);
    ctx.rotate(angle + Math.PI / 2);

    const walkBob = isWalking ? Math.sin(Date.now() * 0.01) * 2 : 0;
    const coatPulse = isWalking ? Math.sin(Date.now() * 0.02) * 2 : 0;
    
    // Determine color scheme based on role
    // Unicorn: Pink/Purple theme
    // Player (survivor): Blue/Cyan theme
    // Enemy: Red theme (legacy, multiplayer uses unicorn)
    const colors = isUnicornChar ? {
      shadow: 'rgba(0, 0, 0, 0.5)',
      coatDark: '#1a1a1a',
      coat: '#2d2d2d',
      shirt: '#fbbf24',
      hatBrim: '#fbbf24',
      hatTop: '#eab308',
      badge: '#fde047',
      glow: '#fbbf24'
    } : isPlayer ? {
      shadow: 'rgba(0, 255, 255, 0.3)',
      coatDark: '#0369a1',
      coat: '#0284c7',
      shirt: '#f97316',
      hatBrim: '#fbbf24',
      hatTop: '#0ea5e9',
      badge: '#fbbf24',
      glow: '#00ffff'
    } : {
      shadow: 'rgba(0, 255, 255, 0.3)',
      coatDark: '#0369a1',
      coat: '#0284c7',
      shirt: '#f97316',
      hatBrim: '#fbbf24',
      hatTop: '#0ea5e9',
      badge: '#fbbf24',
      glow: '#00ffff'
    };

    // Unicorn glow effect – alternating red/blue (police-style)
    if (isUnicornChar) {
      ctx.save();
      ctx.rotate(-(angle + Math.PI / 2)); // Counter-rotate for screen-aligned glow
      const t = Date.now() * 0.02;
      const redPhase = Math.sin(t) > 0;
      const glowColor = redPhase ? '#ff0000' : '#0066ff';
      const glowPulse = 0.8 + Math.sin(Date.now() * 0.008) * 0.2;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 20 * glowPulse;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.01) * 0.2;
      ctx.beginPath();
      ctx.arc(0, 0, 30 * glowPulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Shadow
    ctx.fillStyle = colors.shadow;
    ctx.beginPath();
    ctx.ellipse(0, 10, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Coat dark
    ctx.fillStyle = colors.coatDark;
    ctx.beginPath();
    ctx.ellipse(0, 3 + walkBob, 14 + coatPulse, 12 + coatPulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // Coat
    ctx.fillStyle = colors.coat;
    ctx.beginPath();
    ctx.ellipse(0, 2 + walkBob, 12 + coatPulse * 0.5, 10 + coatPulse * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Orange shirt
    ctx.fillStyle = colors.shirt;
    ctx.beginPath();
    ctx.ellipse(0, -1 + walkBob, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hat brim
    ctx.fillStyle = colors.hatBrim;
    ctx.beginPath();
    ctx.ellipse(0, -3 + walkBob, 13, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hat top
    ctx.fillStyle = colors.hatTop;
    ctx.beginPath();
    ctx.ellipse(0, -5 + walkBob, 10, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Badge
    ctx.fillStyle = colors.badge;
    ctx.beginPath();
    ctx.arc(0, -5 + walkBob, 4, 0, Math.PI * 2);
    ctx.fill();

    // Badge face
    ctx.fillStyle = '#5D4037';
    ctx.beginPath();
    ctx.arc(-1.2, -6 + walkBob, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(1.2, -6 + walkBob, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Smile
    ctx.beginPath();
    ctx.strokeStyle = '#5D4037';
    ctx.lineWidth = 0.8;
    ctx.arc(0, -4.5 + walkBob, 1.5, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();

    ctx.restore();
  };


  function drawUnicornSirenTopView(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    redPhase: boolean,
    glowPulse: number
  ) {
    ctx.save();
    ctx.translate(x, y);
    const angle = Math.atan2(dirY, dirX);
    ctx.rotate(angle + Math.PI / 2);  // match game’s “forward”
  
    // Optional: soft glow behind
    ctx.shadowColor = redPhase ? '#ff0000' : '#0066ff';
    ctx.shadowBlur = 20 * glowPulse;
  
    // Body (top-down “car roof” / unit)
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  
    // Two siren lights (left and right)
    const r = 6 * glowPulse;
    ctx.beginPath();
    ctx.arc(-8, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = redPhase ? '#ff0000' : '#0066ff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(8, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = redPhase ? '#0066ff' : '#ff0000';
    ctx.fill();
  
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Set roomCodeRef immediately from locationState for seeded map generation
    // This needs to happen before generateCity() is called
    if (locationState?.room?.code) {
      roomCodeRef.current = locationState.room.code;
      isMultiplayerRef.current = true;
    }
    
    // Set mapConfig from locationState if available
    // This ensures generateCity uses the correct dimensions from the server
    if (locationState?.room?.mapConfig) {
      mapConfigRef.current = locationState.room.mapConfig;
    }
    
    // Get current map dimensions (from ref or defaults)
    // These are used throughout the game loop and must be captured once at init
    const MAP_W = mapConfigRef.current?.width ?? DEFAULT_MAP_WIDTH;
    const MAP_H = mapConfigRef.current?.height ?? DEFAULT_MAP_HEIGHT;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Initialize game state
    const game = {
      player: {
        x: 0,
        y: 0,
        width: 24,
        height: 24,
        speed: getSpeedForRole(isUnicornRef.current),
        velX: 0,
        velY: 0,
        dirX: 0,
        dirY: 1,
        trail: [] as { x: number; y: number }[],
        portalCooldown: 0,
      },
      enemies: [] as Enemy[],
      coins: [] as Coin[],
      sinkCollectibles: [] as SinkCollectible[],
      deployedSinks: [] as DeployedSink[],
      map: {
        width: MAP_W * TILE_SIZE,
        height: MAP_H * TILE_SIZE,
        tiles: [] as number[][],
        buildings: [] as Building[],
        trees: [] as Tree[],
        portals: [] as Portal[],
      },
      camera: { x: 0, y: 0 },
      keys: {} as Record<string, boolean>,
      gameTime: 0,
      enemySpawnTimer: 0,
      coinSpawnTimer: 0,
      sinkSpawnTimer: 0,
      nextCoinSpawnTime: 10 + Math.random() * 5,
      nextSinkSpawnTime: 25 + Math.random() * 10,
      collectiblesInitialized: false,
      coinsInitialized: false,
      speedBoostApplied: false,
      coinsCollected: 0,
      playerSinkInventory: 0,
      lastTime: 0,
      animationId: null as number | null,
      isPlaying: isRejoinRef.current || false,
      floatingRewards: [],
    };
    gameRef.current = game;

    // Generate city with seeded random for multiplayer consistency
    const generateCity = () => {
      game.map.tiles = [];
      game.map.buildings = [];
      game.map.trees = [];
      game.map.portals = [];

      // Use seeded random if in multiplayer mode (room code as seed)
      // To ensure all players in the same room get the same map
      const rng = new SeededRandom(roomCodeRef.current);

      for (let y = 0; y < MAP_H; y++) {
        const row: number[] = [];
        for (let x = 0; x < MAP_W; x++) {
          row.push(1);
        }
        game.map.tiles.push(row);
      }

      const blockSize = 4;
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const isRoadRow = y % blockSize === 0;
          const isRoadCol = x % blockSize === 0;

          if (isRoadRow || isRoadCol) {
            game.map.tiles[y][x] = 0;
          } else {
            const rand = rng.random();
            if (rand < 0.05) {
              for (let ly = y - 1; ly <= y + 1; ly++) {
                for (let lx = x - 1; lx <= x + 1; lx++) {
                  if (ly >= 0 && ly < MAP_H && lx >= 0 && lx < MAP_W) {
                    if (game.map.tiles[ly][lx] !== 0) {
                      game.map.tiles[ly][lx] = 3;
                    }
                  }
                }
              }
            } else if (rand < 0.15) {
              game.map.tiles[y][x] = 2;
            }
          }
        }
      }

      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (x === 0 || x === MAP_W - 1 || y === 0 || y === MAP_H - 1) {
            game.map.tiles[y][x] = 4;
            continue;
          }

          const tile = game.map.tiles[y][x];
          const px = x * TILE_SIZE;
          const py = y * TILE_SIZE;

          if (tile === 1) {
            const rand = rng.random();
            let type = TYPE_RESIDENTIAL;
            let height = 20 + rng.random() * 60;
            let color = '#252525';
            let wallColor = '#151515';

            if (rand > 0.9) {
              type = TYPE_SHOP;
              height = 30 + rng.random() * 20;
              color = '#331133';
              wallColor = '#220022';
            } else if (rand > 0.8) {
              type = TYPE_CAFE;
              height = 25 + rng.random() * 15;
              color = '#2e3b2e';
              wallColor = '#1a221a';
            }

            game.map.buildings.push({
              gridX: x,
              gridY: y,
              x: px,
              y: py,
              w: TILE_SIZE,
              h: TILE_SIZE,
              height,
              color,
              wallColor,
              type,
            });
          } else if (tile === 2) {
            if (rng.random() > 0.3) {
              game.map.trees.push({
                x: px + TILE_SIZE / 2 + (rng.random() * 20 - 10),
                y: py + TILE_SIZE / 2 + (rng.random() * 20 - 10),
                r: 10 + rng.random() * 10,
              });
            }
          }
        }
      }

      let portalsCreated = 0;
      while (portalsCreated < 4) {
        const px = Math.floor(rng.random() * (MAP_W - 2)) + 1;
        const py = Math.floor(rng.random() * (MAP_H - 2)) + 1;
        if (game.map.tiles[py][px] === 0) {
          game.map.portals.push({
            x: px * TILE_SIZE + TILE_SIZE / 2,
            y: py * TILE_SIZE + TILE_SIZE / 2,
            color: `hsl(${portalsCreated * 90}, 100%, 50%)`,
            angle: 0,
          });
          portalsCreated++;
        }
      }
    };


    const findSafeSpawn = (entity: { x: number; y: number }) => {
      let spawnFound = false;
      while (!spawnFound) {
        const x = Math.floor(Math.random() * (MAP_W - 2)) + 1;
        const y = Math.floor(Math.random() * (MAP_H - 2)) + 1;
        if (game.map.tiles[y][x] === 0) {
          entity.x = x * TILE_SIZE + TILE_SIZE / 2;
          entity.y = y * TILE_SIZE + TILE_SIZE / 2;
          spawnFound = true;
        }
      }
    };

    /**
     * Validate and correct a spawn position from the server.
     * If the position is not on a road tile, snap to the nearest valid road intersection.
     * @param row - Grid row from server
     * @param col - Grid column from server
     * @returns Corrected pixel coordinates { x, y }
     */
    const validateAndCorrectSpawnPosition = (row: number, col: number): { x: number; y: number } => {
      // Check if the tile is a road (type 0)
      if (row >= 0 && row < MAP_H && col >= 0 && col < MAP_W && game.map.tiles[row]?.[col] === 0) {
        // Valid road position - use as-is
        return toPixel(row, col);
      }
      
      // Invalid position - snap to nearest road intersection (multiples of 4)
      const correctedRow = Math.max(4, Math.min(MAP_H - 5, Math.round(row / 4) * 4));
      const correctedCol = Math.max(4, Math.min(MAP_W - 5, Math.round(col / 4) * 4));
      
      logger.game(`Correcting invalid spawn position (${row},${col}) to road intersection (${correctedRow},${correctedCol})`);
      
      return toPixel(correctedRow, correctedCol);
    };

    const init = () => {
      generateCity();
      const inMultiplayer = !!(locationState?.room?.code ?? roomCodeRef.current);
      const players = locationState?.gameState?.players;
      if (inMultiplayer && Array.isArray(players)) {
        const myId = socketService.getPlayerId();
        const me = players.find((p: { id?: string }) => p.id === myId);
        const pos = me?.position as { x?: number; y?: number; row?: number; col?: number } | undefined;
        if (pos && ((pos.x != null && pos.y != null) || (pos.row != null && pos.col != null))) {
          // Use pixel coordinates if available, otherwise validate and convert row/col
          const pixel = (pos.x != null && pos.y != null) 
            ? { x: pos.x, y: pos.y } 
            : validateAndCorrectSpawnPosition(pos.row!, pos.col!);
          game.player.x = pixel.x;
          game.player.y = pixel.y;
        } else {
          findSafeSpawn(game.player);
        }
      } else {
        findSafeSpawn(game.player);
      }
      game.player.trail = [];
      game.player.portalCooldown = 0;
      game.player.dirX = 0;
      game.player.dirY = 1;
      game.player.speed = getSpeedForRole(isUnicornRef.current);

      game.enemies = [];
      game.enemySpawnTimer = 0;
      game.coinSpawnTimer = 0;
      game.sinkSpawnTimer = 0;
      game.nextCoinSpawnTime = 10 + Math.random() * 5;
      game.nextSinkSpawnTime = 25 + Math.random() * 10;
      game.collectiblesInitialized = false;
      game.coinsInitialized = false;
      game.speedBoostApplied = false;
      game.coinsCollected = 0;
      game.playerSinkInventory = 0;
      game.coins = [];
      game.sinkCollectibles = [];
      game.deployedSinks = [];

      game.camera.x = game.player.x - canvas.width / 2;
      game.camera.y = game.player.y - canvas.height / 2;
    };

    const checkCollision = (
      x: number,
      y: number,
      w: number,
      h: number,
      isPlayer: boolean
    ): boolean => {
      const halfW = w / 2, halfH = h / 2;
      const l = x - halfW, r = x + halfW, t = y - halfH, b = y + halfH;
      const gridX = Math.floor(x / TILE_SIZE);
      const gridY = Math.floor(y / TILE_SIZE);

      for (let gy = gridY - 1; gy <= gridY + 1; gy++) {
        for (let gx = gridX - 1; gx <= gridX + 1; gx++) {
          if (gy >= 0 && gy < MAP_H && gx >= 0 && gx < MAP_W) {
            const tile = game.map.tiles[gy][gx];
            let solid = tile === 1 || tile === 3 || tile === 4;

            if (solid) {
              const bx = gx * TILE_SIZE;
              const by = gy * TILE_SIZE;
              if (l < bx + TILE_SIZE && r > bx && t < by + TILE_SIZE && b > by) {
                return true;
              }
            }
          }
        }
      }
      return false;
    };

    // const checkLavaDeath = (): boolean => {
    //   const gridX = Math.floor(game.player.x / TILE_SIZE);
    //   const gridY = Math.floor(game.player.y / TILE_SIZE);
    //   if (gridY >= 0 && gridY < MAP_H && gridX >= 0 && gridX < MAP_W) {
    //     if (game.map.tiles[gridY][gridX] === 4) return true;
    //   }
    //   return false;
    // };

    const attemptMove = (
      entity: { x: number; y: number; width: number; height: number },
      dx: number,
      dy: number,
      isPlayer: boolean
    ): number => {
      let actualDist = 0;
      if (!checkCollision(entity.x + dx, entity.y, entity.width, entity.height, isPlayer)) {
        entity.x += dx;
        actualDist += Math.abs(dx);
      }
      if (!checkCollision(entity.x, entity.y + dy, entity.width, entity.height, isPlayer)) {
        entity.y += dy;
        actualDist += Math.abs(dy);
      }
      return actualDist;
    };

    const deploySink = () => {
      if (game.playerSinkInventory <= 0) {
        showStatus('NO SINK TRAPS!', '#888', 500);
        return;
      }
      
      if (isMultiplayerRef.current) {
        // In multiplayer, send deploy event to server
        // Server will emit SINK_TRAP_DEPLOYED which updates local state
        socketService.deploySinkTrap(game.player.x, game.player.y);
      } else {
        // Single player - handle locally
        game.playerSinkInventory--;
        setSinkInventory(game.playerSinkInventory);
        
        game.deployedSinks.push({
          x: game.player.x,
          y: game.player.y,
          deployTime: game.gameTime,
        });
        
        showStatus('SINK TRAP DEPLOYED!', '#ff6600');
      }
    };

    const update = (dt: number) => {
      if (!game.isPlaying) return;
      
      game.gameTime += dt;
      
      // Sync game time to React state
      if (Math.floor(game.gameTime * 2) !== Math.floor((game.gameTime - dt) * 2)) {
        setGameTime(game.gameTime);
      }
      
      // Speed boost at 30 seconds (game difficulty)
      if (!game.speedBoostApplied && game.gameTime >= 30) {
        game.speedBoostApplied = true;
        game.player.speed = getSpeedForRole(isUnicornRef.current) * 1.2;
        game.enemies.forEach(enemy => {
          enemy.speed = enemy.speed * 1.2;
        });
        showStatus('⚡ DIFFICULTY UP! Everything is 20% faster!', '#ffcc00', 3000);
      }

      if(!isFrozenRef.current) {let dx = 0, dy = 0;
      if (game.keys['ArrowUp'] || game.keys['KeyW']) dy = -1;
      if (game.keys['ArrowDown'] || game.keys['KeyS']) dy = 1;
      if (game.keys['ArrowLeft'] || game.keys['KeyA']) dx = -1;
      if (game.keys['ArrowRight'] || game.keys['KeyD']) dx = 1;

      if (dx !== 0 || dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;
        game.player.dirX = dx;
        game.player.dirY = dy;
      }

      game.player.velX = dx * game.player.speed;
      game.player.velY = dy * game.player.speed;

      attemptMove(
        game.player,
        game.player.velX * dt,
        game.player.velY * dt,
        true
      );

      // if (checkLavaDeath()) {
      //   if (!lavaDeathReportedRef.current) {
      //     lavaDeathReportedRef.current = true;
      //     socketService.reportLavaDeath();
      //   }
      //   return;
      // }

      game.player.trail.push({ x: game.player.x, y: game.player.y });
      if (game.player.trail.length > 20) game.player.trail.shift();

      // Send position to server in multiplayer mode
      if (isMultiplayerRef.current && (dx !== 0 || dy !== 0 || game.gameTime < 1)) {
        socketService.updatePosition(
          game.player.x,
          game.player.y,
          game.player.dirX,
          game.player.dirY,
          { x: game.player.velX, y: game.player.velY }
        );
      }}

      // Interpolate remote players in multiplayer mode
      if (isMultiplayerRef.current) {
        const INTERPOLATION_SPEED = 10; // Higher = faster catch-up
        
        remotePlayersRef.current.forEach((player) => {
          // Note: We don't remove "stale" players here anymore.
          // Players are only removed via PLAYER_LEFT event from the server.
          // This prevents players from disappearing when they stop moving.
          
          // Interpolate position
          const dx = player.targetX - player.x;
          const dy = player.targetY - player.y;
          const dist = Math.hypot(dx, dy);
          
          if (dist > 1) {
            // Smooth interpolation
            player.x += dx * Math.min(1, INTERPOLATION_SPEED * dt);
            player.y += dy * Math.min(1, INTERPOLATION_SPEED * dt);
          } else {
            player.x = player.targetX;
            player.y = player.targetY;
          }
        });
      }

      // Coin collection
      game.coins.forEach((coin, index) => {
        if (coin.collected) return;
        const d = Math.hypot(game.player.x - coin.x, game.player.y - coin.y);
        if (d < 25) {
          if (isMultiplayerRef.current && !isUnicornRef.current) {
            // In multiplayer, only survivors can collect coins (server ignores unicorn)
            // Mark as collected locally for immediate feedback (server will confirm)
            coin.collected = true;
            const grid = toGrid(coin.x, coin.y);
            socketService.collectCoin(`coin_${grid.row}_${grid.col}`);
          }
        }
      });
      game.coins = game.coins.filter(c => !c.collected);

      // Survivors only: – collect sink trap by trapId (optimistic collect to avoid double-send)
      if (isMultiplayerRef.current && !isUnicornRef.current && game.playerSinkInventory < 3) {
        for (const sink of game.sinkCollectibles) {
          if (sink.collected || !sink.id) continue;
          const d = Math.hypot(game.player.x - sink.x, game.player.y - sink.y);
          if (d < 30) {
            socketService.collectSinkTrap(sink.id!);
            sink.collected = true;
            break;
          }
        }
      }

      // Portal logic
      if (game.player.portalCooldown > 0) game.player.portalCooldown -= dt;

      for (let i = game.map.portals.length - 1; i >= 0; i--) {
        const p = game.map.portals[i];
        p.angle += 2 * dt;
        if (p.life !== undefined) {
          p.life -= dt;
          if (p.life <= 0) {
            game.map.portals.splice(i, 1);
            continue;
          }
        }
      }

      if (game.player.portalCooldown <= 0) {
        for (let i = 0; i < game.map.portals.length; i++) {
          const p = game.map.portals[i];
          const d = Math.hypot(game.player.x - p.x, game.player.y - p.y);
          if (d < 20) {
            const otherPortals = game.map.portals.filter((_, idx) => idx !== i);
            if (otherPortals.length > 0) {
              const dest = otherPortals[Math.floor(Math.random() * otherPortals.length)];
              game.player.x = dest.x;
              game.player.y = dest.y;
              game.player.portalCooldown = 2.0;
              game.player.trail = [];
              showStatus('PORTAL TRAVEL!', '#0ff');
            }
            break;
          }
        }
      }

      // Camera
      const targetCamX = game.player.x - canvas.width / 2;
      const targetCamY = game.player.y - canvas.height / 2;
      game.camera.x += (targetCamX - game.camera.x) * 5 * dt;
      game.camera.y += (targetCamY - game.camera.y) * 5 * dt;
    };

    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(-game.camera.x, -game.camera.y);

      const startCol = Math.floor(game.camera.x / TILE_SIZE) - 1;
      const endCol = startCol + Math.ceil(canvas.width / TILE_SIZE) + 2;
      const startRow = Math.floor(game.camera.y / TILE_SIZE) - 1;
      const endRow = startRow + Math.ceil(canvas.height / TILE_SIZE) + 2;

      // Ground
      for (let y = startRow; y < endRow; y++) {
        for (let x = startCol; x < endCol; x++) {
          if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) {
            const type = game.map.tiles[y][x];
            const dx = x * TILE_SIZE, dy = y * TILE_SIZE;

            if (type === 0) {
              ctx.fillStyle = C_ROAD;
              ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
              ctx.strokeStyle = '#444';
              ctx.lineWidth = 2;
              ctx.setLineDash([10, 10]);
              ctx.beginPath();
              ctx.moveTo(dx + TILE_SIZE / 2, dy);
              ctx.lineTo(dx + TILE_SIZE / 2, dy + TILE_SIZE);
              ctx.moveTo(dx, dy + TILE_SIZE / 2);
              ctx.lineTo(dx + TILE_SIZE, dy + TILE_SIZE / 2);
              ctx.stroke();
              ctx.setLineDash([]);
            } else if (type === 2) {
              ctx.fillStyle = C_GRASS;
              ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
            } else if (type === 3) {
              ctx.fillStyle = C_WATER;
              ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
              ctx.fillStyle = 'rgba(255,255,255,0.1)';
              if ((Date.now() + x * 100) % 1000 < 100) {
                ctx.fillRect(dx + 10, dy + 10, TILE_SIZE - 20, 4);
              }
            } else if (type === 4) {
              ctx.fillStyle = C_LAVA;
              ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
              ctx.fillStyle = C_LAVA_HOT;
              let offset = 0;
              if (y === 0) offset = dx;
              else if (x === MAP_W - 1) offset = dy;
              else if (y === MAP_H - 1) offset = -dx;
              else if (x === 0) offset = -dy;
              const pulse = (Math.sin(game.gameTime * 2 + offset * 0.05) + 1) / 2;
              ctx.globalAlpha = 0.5 * pulse;
              ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
              ctx.globalAlpha = 1.0;
            } else {
              ctx.fillStyle = C_SIDEWALK;
              ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
            }
          }
        }
      }

      // Portals
      game.map.portals.forEach((p) => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4;
        if (p.life !== undefined && p.life < 2.0) {
          const scale = p.life / 2.0;
          ctx.scale(scale, scale);
        }
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const r = 20 - i * 5;
          ctx.arc(0, 0, r, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.restore();
      });

      // Teleport effects (particle animations)
      const now = Date.now();
      teleportEffectsRef.current = teleportEffectsRef.current.filter(effect => {
        const elapsed = now - effect.startTime;
        if (elapsed > effect.duration) return false;
        
        const progress = elapsed / effect.duration;
        const alpha = effect.type === 'out' ? 1 - progress : progress;
        const radius = effect.type === 'out' ? 20 + progress * 40 : 60 - progress * 40;
        
        ctx.save();
        ctx.translate(effect.x, effect.y);
        
        // Draw expanding/contracting rings
        for (let ring = 0; ring < 3; ring++) {
          const ringProgress = (progress + ring * 0.1) % 1;
          const ringRadius = radius * (0.5 + ring * 0.25) * (effect.type === 'out' ? ringProgress : 1 - ringProgress);
          
          ctx.beginPath();
          ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 255, 255, ${alpha * (1 - ring * 0.3)})`;
          ctx.lineWidth = 3 - ring;
          ctx.stroke();
        }
        
        // Draw particles
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + progress * Math.PI;
          const particleRadius = effect.type === 'out' ? progress * 50 : (1 - progress) * 50;
          const px = Math.cos(angle) * particleRadius;
          const py = Math.sin(angle) * particleRadius;
          
          ctx.fillStyle = `rgba(0, 255, 255, ${alpha})`;
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        
        ctx.restore();
        return true;
      });

      // Deployed sinks
      game.deployedSinks.forEach((s) => {
        drawDeployedSink(ctx, s, game.gameTime);
      });

      // Tree trunks
      ctx.fillStyle = '#3e2723';
      game.map.trees.forEach((t) => {
        ctx.beginPath();
        ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw coins
      game.coins.forEach(coin => {
        if (!coin.collected) {
          if(!isUnicornRef.current) drawCoin(ctx, coin);
        }
      });

      // Draw sink collectibles
      game.sinkCollectibles.forEach(sink => {
        if (!sink.collected) {
          if(!isUnicornRef.current) drawSinkCollectible(ctx, sink);
        }
      });

      // Entities - Draw trails
      const isPlayerWalking = game.player.velX !== 0 || game.player.velY !== 0;

      // Shared unicorn timing so siren, glow, and trail pulse together
      const unicornT = Date.now() * 0.02;
      const unicornRedPhase = Math.sin(unicornT) > 0;
      const unicornGlowPulse = 0.8 + Math.sin(unicornT * 2) * 0.2;

      // Player trail; unicorn uses same palette and timing as siren
      ctx.lineWidth = game.player.width * 0.8;
      ctx.lineCap = 'round';
      const trailRedPhase = unicornRedPhase;
      ctx.strokeStyle = isUnicornRef.current
        ? (trailRedPhase ? 'rgba(255, 0, 0, 0.4)' : 'rgba(0, 102, 255, 0.4)')
        : 'rgba(0, 255, 255, 0.2)';
      ctx.beginPath();
      if (game.player.trail.length > 0) {
        ctx.moveTo(game.player.trail[0].x, game.player.trail[0].y);
        for (const p of game.player.trail) ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Draw remote players in multiplayer mode (before local player so local is on top)
      if (isMultiplayerRef.current) {
        remotePlayersRef.current.forEach((remotePlayer) => {
          if (remotePlayer.isEliminated) return; // Don't draw eliminated players
          
          // Draw trail for remote player
          ctx.lineWidth = 16;
          ctx.lineCap = 'round';
          ctx.strokeStyle = remotePlayer.isUnicorn 
            ? 'rgba(255, 0, 255, 0.3)'  // Purple trail for unicorn
            : remotePlayer.isFrozen
              ? 'rgba(0, 255, 255, 0.3)' // Cyan trail for frozen
              : 'rgba(100, 100, 255, 0.2)'; // Blue trail for survivors
          
          // Draw frozen visual effect (ice particles/glow)
          if (remotePlayer.isFrozen) {
            ctx.save();
            // Ice glow effect
            ctx.shadowColor = '#00ffff';
            ctx.shadowBlur = 20;
            ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.beginPath();
            ctx.arc(remotePlayer.x, remotePlayer.y, 30, 0, Math.PI * 2);
            ctx.fill();
            
            // Ice particles
            const particleTime = Date.now() * 0.002;
            for (let i = 0; i < 6; i++) {
              const angle = (i / 6) * Math.PI * 2 + particleTime;
              const radius = 25 + Math.sin(particleTime * 2 + i) * 5;
              const px = remotePlayer.x + Math.cos(angle) * radius;
              const py = remotePlayer.y + Math.sin(angle) * radius - 10;
              ctx.fillStyle = 'rgba(200, 255, 255, 0.8)';
              ctx.beginPath();
              ctx.arc(px, py, 3, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }

          // Draw i-frames (protected) indicator – soft gold shield ring
          if (remotePlayer.inIFrames) {
            ctx.save();
            const shieldTime = Date.now() * 0.003;
            const pulse = 0.6 + 0.2 * Math.sin(shieldTime);
            ctx.strokeStyle = `rgba(255, 200, 80, ${pulse})`;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(remotePlayer.x, remotePlayer.y, 28, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 12;
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(remotePlayer.x, remotePlayer.y, 32, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.restore();
          }
          
          // Draw remote player with isometric Qbit
          // Use different colors for unicorn or frozen
          // Draw remote player: siren for unicorn, isometric Qbit otherwise
          ctx.save();
          if (remotePlayer.isFrozen) {
            ctx.globalAlpha = 0.7;
          }
          if (remotePlayer.isUnicorn) {
            drawUnicornSirenTopView(
              ctx,
              remotePlayer.x,
              remotePlayer.y,
              remotePlayer.dirX,
              remotePlayer.dirY,
              unicornRedPhase,
              unicornGlowPulse
            );
          } else {
            drawQbitIsometric(
              ctx,
              remotePlayer.x,
              remotePlayer.y,
              remotePlayer.dirX,
              remotePlayer.dirY,
              false,
              !remotePlayer.isFrozen,
              false
            );
          }
          ctx.restore();
          
          // Draw name label above player
          ctx.save();
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.fillStyle = remotePlayer.isFrozen 
            ? '#00ffff'  // Cyan for frozen
            : remotePlayer.isUnicorn ? '#ff00ff' : '#ffffff';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 3;
          ctx.strokeText(remotePlayer.name, remotePlayer.x, remotePlayer.y - 40);
          ctx.fillText(remotePlayer.name, remotePlayer.x, remotePlayer.y - 40);
          
          // Unicorn indicator
          if (remotePlayer.isUnicorn) {
            ctx.font = 'bold 16px Arial';
            ctx.fillText('🚔', remotePlayer.x, remotePlayer.y - 55);
          }
          
          // Frozen indicator
          if (remotePlayer.isFrozen) {
            ctx.font = 'bold 14px Arial';
            ctx.fillStyle = '#00ffff';
            ctx.fillText('JAILED', remotePlayer.x, remotePlayer.y - 55);
          }
          // Protected (i-frames) indicator (below name/unicorn)
          if (remotePlayer.inIFrames) {
            ctx.font = 'bold 12px Arial';
            ctx.fillStyle = '#ffd700';
            const protectedY = remotePlayer.isUnicorn ? remotePlayer.y - 68 : remotePlayer.y - 55;
            ctx.strokeText('🛡️ Protected', remotePlayer.x, protectedY);
            ctx.fillText('🛡️ Protected', remotePlayer.x, protectedY);
          }
          ctx.restore();
        });
      }

      // Draw player with isometric Qbit
      // Draw local player: top-down siren when unicorn, else isometric Qbit
      if (isUnicornRef.current) {
        drawUnicornSirenTopView(
          ctx,
          game.player.x,
          game.player.y,
          game.player.dirX,
          game.player.dirY,
          unicornRedPhase,
          unicornGlowPulse
        );
      } else {
        drawQbitIsometric(
          ctx,
          game.player.x,
          game.player.y,
          game.player.dirX,
          game.player.dirY,
          true,
          isPlayerWalking,
          false
        );
      }
      
      // Draw "YOU" label and unicorn indicator for local player in multiplayer
      if (isMultiplayerRef.current) {
        ctx.save();
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = isUnicornRef.current ? '#ff00ff' : '#00ffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText('YOU', game.player.x, game.player.y - 40);
        ctx.fillText('YOU', game.player.x, game.player.y - 40);
        if (isUnicornRef.current) {
          ctx.font = 'bold 16px Arial';
          ctx.fillText('🚔', game.player.x, game.player.y - 55);
        }
        ctx.restore();
      }

      // Floating rewards above local player (world space)
      // Floating rewards above local player (world space)
      const floatDuration = 1.5;
      const tNow = Date.now();
      ctx.save();
      // Responsive font size (scale with canvas width, clamp for readability)
      const rewardFontSize = Math.round(Math.max(14, Math.min(30, 20 * (canvas.width / 800))));
      game.floatingRewards.forEach((r) => {
        const elapsed = (tNow - r.createdAt) / 1000;
        if (elapsed > floatDuration) return;
        const alpha = 1 - (elapsed / floatDuration) ** 2;
        const yOffsetPx = elapsed * 50;
        const drawY = game.player.y - 30 - yOffsetPx;
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${rewardFontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillStyle = r.text === '+15💰' ? '#ff00ff' : r.text === 'Spacebar to deploy' ? '#ff6600' : '#ffd700';
        ctx.fillText(r.text, game.player.x, drawY);
      });
      ctx.restore();
      game.floatingRewards = game.floatingRewards.filter(
        (r) => (tNow - r.createdAt) / 1000 <= floatDuration
      );

      // Trees (top)
      ctx.fillStyle = C_TREE;
      game.map.trees.forEach((t) => {
        const cx = game.camera.x + canvas.width / 2;
        const cy = game.camera.y + canvas.height / 2;
        const leanX = (t.x - cx) * 0.2;
        const leanY = (t.y - cy) * 0.2;
        ctx.beginPath();
        ctx.arc(t.x + leanX, t.y + leanY, t.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.arc(t.x + leanX - 2, t.y + leanY - 2, t.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C_TREE;
      });

      // Buildings
      const screenCX = game.camera.x + canvas.width / 2;
      const screenCY = game.camera.y + canvas.height / 2;

      game.map.buildings
        .filter(
          (b) =>
            b.gridX >= startCol &&
            b.gridX <= endCol &&
            b.gridY >= startRow &&
            b.gridY <= endRow
        )
        .forEach((b) => {
          const bCX = b.x + b.w / 2;
          const bCY = b.y + b.h / 2;
          const leanX = (bCX - screenCX) * PERSPECTIVE_STRENGTH * (b.height / 100);
          const leanY = (bCY - screenCY) * PERSPECTIVE_STRENGTH * (b.height / 100);
          const rx = b.x + leanX, ry = b.y + leanY;

          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;

          const drawQuad = (
            x1: number, y1: number,
            x2: number, y2: number,
            x3: number, y3: number,
            x4: number, y4: number,
            shade: string
          ) => {
            ctx.fillStyle = shade;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x3, y3);
            ctx.lineTo(x4, y4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          };

          if (leanY < 0)
            drawQuad(b.x, b.y, b.x + b.w, b.y, rx + b.w, ry, rx, ry, '#111');
          if (leanY > 0)
            drawQuad(b.x, b.y + b.h, b.x + b.w, b.y + b.h, rx + b.w, ry + b.h, rx, ry + b.h, '#000');
          if (leanX < 0)
            drawQuad(b.x, b.y, b.x, b.y + b.h, rx, ry + b.h, rx, ry, '#1a1a1a');
          if (leanX > 0)
            drawQuad(b.x + b.w, b.y, b.x + b.w, b.y + b.h, rx + b.w, ry + b.h, rx + b.w, ry, '#0a0a0a');

          ctx.fillStyle = b.color;
          ctx.fillRect(rx, ry, b.w, b.h);
          ctx.strokeRect(rx, ry, b.w, b.h);

          if (b.type === TYPE_SHOP) {
            ctx.fillStyle = '#ff00ff';
            ctx.shadowColor = '#ff00ff';
            ctx.shadowBlur = 10;
            ctx.fillRect(rx + 5, ry + 5, b.w - 10, 5);
            ctx.shadowBlur = 0;
          } else if (b.type === TYPE_CAFE) {
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < b.w; i += 10) ctx.fillRect(rx + i, ry + b.h - 10, 5, 10);
          }
        });

      ctx.restore();

    };

    const gameLoop = (timestamp: number) => {
      const dt = (timestamp - game.lastTime) / 1000;
      game.lastTime = timestamp;
      if (dt < 0.1) {
        update(dt);
      }
      draw();
      game.animationId = requestAnimationFrame(gameLoop);
    };

    // Input handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      game.keys[e.code] = true;
      if (e.code === 'Space' && game.isPlaying) {
        deploySink();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      game.keys[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    init();
    game.animationId = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (game.animationId) cancelAnimationFrame(game.animationId);
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-background overflow-hidden">
      <canvas ref={canvasRef} className="block" />
      
      {/* Screen flash overlay */}
      {screenFlash && (
        <div 
          className="absolute inset-0 pointer-events-none z-40 transition-opacity duration-300"
          style={{ 
            backgroundColor: screenFlash.color, 
            opacity: screenFlash.opacity 
          }}
        />
      )}

      {/* Floating reward pop-up (coin / tag) - top of screen so it doesn't block view */}
      {rewardPopup && (
        <div className="absolute inset-x-0 top-8 flex justify-center pointer-events-none z-30">
          <div
            className="px-6 py-4 rounded-xl font-bold text-xl shadow-lg animate-in zoom-in-95 duration-200"
            style={{
              color: rewardPopup.color,
              backgroundColor: 'rgba(0,0,0,0.75)',
              border: `2px solid ${rewardPopup.color}`,
              textShadow: `0 0 12px ${rewardPopup.color}`,
            }}
          >
            {rewardPopup.text}
          </div>
        </div>
      )}

      {/* Blitz Quiz Overlay (Multiplayer) */}
      {gameState === 'blitz-quiz' && blitzQuestion && (
        blitzShowObjective ? (
          <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
            <div className="bg-card border-2 border-cream/50 rounded-xl p-8 max-w-lg w-full mx-4 shadow-2xl shadow-black/30 text-center">
              <span className="text-5xl mb-4 block" aria-hidden>🚔</span>
              <h2 className="text-2xl md:text-3xl font-bold text-cream mb-2">
                Answer correct for 10 bonus coins
              </h2>
              <p className="text-muted-foreground text-sm mb-4">
                Get it right to earn bonus coins!
              </p>
              <p className="text-cream/80 text-sm animate-pulse">Get ready!</p>
            </div>
          </div>
        ) : (
          <BlitzQuiz
            question={blitzQuestion.question}
            options={blitzQuestion.options}
            timeLeft={blitzTimeLeft}
            onAnswer={(index) => socketService.submitBlitzAnswer(index)}
            questionImage={blitzQuestion.questionImage}
            optionImages={blitzQuestion.optionImages}
          />
        )
      )}

      {/* Last Round warning banner (top, 3 seconds when final hunt starts) */}
      {showLastRoundWarning && (
        <div className="absolute top-0 left-0 right-0 z-40 flex justify-center pt-6 pointer-events-none">
          <div className="bg-red-600 border-2 border-red-400 text-white font-bold text-2xl md:text-3xl uppercase tracking-widest px-4 py-2 rounded-lg shadow-lg animate-pulse">
            Last Round
          </div>
        </div>
      )}

      {/* Role Announcement Overlay (shows before hunt phase) */}
      {roleAnnouncement?.visible && (
        <div className="absolute inset-0 bg-black/95 flex items-center justify-center z-50">
          <div className={`text-center p-8 rounded-2xl ${
            roleAnnouncement.isUnicorn 
              ? 'bg-neutral-900/95 border-2 border-cream/50' 
              : 'bg-neutral-800/95 border-2 border-cream/40'
          }`}>
            {/* Large animated icon */}
            <div className="text-8xl mb-6 animate-bounce text-cream">
              {roleAnnouncement.isUnicorn ? '🚔' : '🏃'}
            </div>
            
            {/* Role title */}
            <h1 className="text-5xl font-bold mb-4 text-cream">
              {roleAnnouncement.isUnicorn ? `You are the ${ROLE_LABEL_CHASER}!` : `You are a ${ROLE_LABEL_RUNNER}!`}
            </h1>
            
            {/* Role instruction */}
            <p className="text-2xl text-cream/90">
              {roleAnnouncement.isUnicorn 
                ? 'Catch Bandits for coins! 💰' 
                : 'Evade Enforcers and collect coins! 💰'}
            </p>
            
            {/* Pulsing "Get Ready" text */}
            <p className="text-lg text-cream/60 mt-6 animate-pulse">
              Hunt begins soon...
            </p>
          </div>
        </div>
      )}

      {/* Unfreeze Quiz Overlay (Multiplayer - when frozen after being tagged) */}
      {gameState === 'frozen' && unfreezeQuizData && (
        <UnfreezeQuiz
          questions={unfreezeQuizData.questions}
          passThreshold={unfreezeQuizData.passThreshold}
        />
      )}

      {/* Frozen - Loading Quiz Overlay (waiting for quiz data from server) */}
      {gameState === 'frozen' && !unfreezeQuizData && (
        <div className="absolute inset-0 bg-game-bg flex items-center justify-center z-50">
          <div className="bg-game-card border-2 border-game-accent rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl">
            <h2 className="text-2xl font-bold text-cream text-center mb-2 animate-pulse uppercase">
              YOU GOT TAGGED!
            </h2>
            <p className="text-cream/80 text-center text-sm mb-6">Answer correctly to unfreeze</p>
            <p className="text-cream text-center text-lg mb-4">Loading quiz questions...</p>
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-game-accent border-t-game-icon"></div>
            </div>
          </div>
        </div>
      )}

      {/* Spectating Overlay (Multiplayer - after elimination) */}
      {gameState === 'spectating' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <div className="bg-black/80 border border-red-500 rounded-lg px-6 py-3">
            <p className="text-red-400 font-bold text-lg">ELIMINATED - Spectating</p>
          </div>
        </div>
      )}

      {/* Waiting for start screen (Multiplayer) */}
      {gameState === 'waiting-for-start' && room && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-card p-8 rounded-xl border border-border max-w-md w-full mx-4 text-center">
            <h2 className="text-3xl font-bold text-cream mb-4">Waiting for Game</h2>
            <p className="text-muted-foreground mb-6">
              Room: <span className="text-cream font-mono">{room.code}</span>
            </p>
            <p className="text-muted-foreground">
              {room.players.length} player{room.players.length !== 1 ? 's' : ''} connected
            </p>
            <div className="mt-6 flex justify-center gap-2">
              {room.players.map((p, i) => (
                <div
                  key={p.id}
                  className="w-10 h-10 rounded-full bg-wine-600 flex items-center justify-center text-cream font-bold"
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
            <p className="mt-6 text-muted-foreground text-sm animate-pulse">
              Waiting for host to start...
            </p>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'game-over' && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-card p-8 rounded-xl border border-border max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <h2 className="text-3xl font-bold text-cream mb-4 text-center">GAME OVER</h2>

            <>
              {gameEndLeaderboard.length > 0 ? (
                <div className="mb-6 text-left flex-shrink min-h-0">
                  <h3 className="text-lg font-semibold text-foreground mb-2">Final standings</h3>
                  <div className="bg-background rounded-lg border border-border overflow-y-auto max-h-[50vh]">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-background border-b border-border">
                        <tr className="text-muted-foreground text-sm">
                          <th className="py-2 px-3 text-left">#</th>
                          <th className="py-2 px-3 text-left">Name</th>
                          <th className="py-2 px-3 text-right">Coins</th>
                          <th className="py-2 px-3 text-right">Questions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gameEndLeaderboard.map((entry, i) => {
                          const isYou = entry.id === socketService.getPlayerId();
                          return (
                            <tr
                              key={entry.id || i}
                              ref={isYou ? (el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) : undefined}
                              className={`border-b border-border/50 last:border-0 ${isYou ? 'bg-cream/20 text-cream' : 'text-foreground'}`}
                            >
                              <td className="py-2 px-3 font-mono">{i + 1}</td>
                              <td className="py-2 px-3">
                                {entry.name}
                                {isYou && <span className="ml-1 text-muted-foreground">(You)</span>}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">{entry.coins}</td>
                              <td className="py-2 px-3 text-right font-mono text-cream-muted">
                                {entry.questionsCorrect}/{entry.questionsAttempted}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4 mb-2">No standings data.</p>
              )}
              <button
                type="button"
                onClick={() => {
                  returningToLobbyRef.current = true;
                  navigate('/lobby', { state: { returnFromGameOver: true } });
                }}
                className="flex-shrink-0 w-full py-3 bg-cream text-wine-800 font-bold rounded-lg hover:bg-cream-muted
                           transition-all text-center"
              >
                Return to Lobby
              </button>
            </>
          </div>
        </div>
      )}

      {/* Leaderboard Popup */}
      {showLeaderboard && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-xl border border-border max-w-lg w-full mx-4 max-h-[80vh]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-cream flex items-center gap-2">
                <Trophy size={28} /> Leaderboard
              </h2>
              <button 
                onClick={() => setShowLeaderboard(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            
            {leaderboard.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No scores yet. Be the first!</p>
            ) : (
              <div className="overflow-y-auto max-h-[50vh]">
                <table className="w-full">
                  <thead>
                    <tr className="text-muted-foreground text-sm border-b border-border">
                      <th className="py-2 text-left">#</th>
                      <th className="py-2 text-left">Name</th>
                      <th className="py-2 text-right">Time Survived</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-2 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 text-foreground">{entry.name}</td>
                        <td className="py-2 text-right text-cream">{formatTime(entry.timeSurvived)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* UI Overlay - Only show when playing */}
      {gameState === 'playing' && (
        <div className="absolute top-5 left-5 text-foreground pointer-events-none w-80">
          <div className="flex items-center justify-between">
            <h1 className="m-0 text-2xl text-cream uppercase tracking-widest font-bold drop-shadow-lg">
              WayMaze
            </h1>
            {/* <button
              onClick={() => setShowLeaderboard(true)}
              className="pointer-events-auto p-2 text-amber-400 hover:text-amber-300 transition-colors"
            >
              <Trophy size={24} />
            </button> */}
          </div>
          
          {/* Timer and multiplayer info in one row when applicable */}
          <div className="flex flex-col gap-2 mt-2">
            <div className="flex items-center gap-3 text-lg">
              {/* <span className="text-cyan-400 font-mono text-xl">
                ⏱ {formatTime(gameTime)}
              </span> */}
              {isMultiplayer && huntTimeLeft > 0 && (
                <span className="text-cream font-mono text-xl">
                  Hunt ⏱: <span className=" ">{Math.ceil(huntTimeLeft)}s</span>
                </span>
              )}
            </div>
            {isMultiplayer && (
              <div className="flex flex-wrap items-center gap-2">
                <div className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                  isUnicorn
                    ? 'bg-neutral-800/90 border border-cream/50 text-cream'
                    : 'bg-neutral-700/90 border border-cream/40 text-cream'
                }`}>
                  {isUnicorn ? ` ${ROLE_LABEL_CHASER}` : `${ROLE_LABEL_RUNNER}`}
                </div>
                <div className="bg-card/80 rounded-lg px-3 py-1.5 text-sm text-muted-foreground">
                  Round <span className="text-cream font-bold">{currentRound}</span> / {totalRounds}
                </div>
              </div>
            )}
          </div>

          {/* Coin Counter */}
          {/* <div className="mt-3 flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Coins:</span>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs
                    ${i < coinsCollected 
                      ? 'bg-amber-500/50 border-amber-400 text-amber-400' 
                      : 'bg-muted/20 border-muted-foreground/30'
                    }`}
                >
                  {i < coinsCollected ? '$' : ''}
                </div>
              ))}
            </div>
            <span className="text-amber-400 text-xs">({coinsCollected}/5)</span>
          </div> */}

          {/* Protected (i-frames) indicator */}
          {localInIFrames && (
            <div className="mt-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-400/50">
              <span className="text-amber-400 font-bold text-sm">🛡️ Protected</span>
              <span className="text-amber-300/90 text-xs tabular-nums">
                {Math.max(0, (localIFramesEndTime - Date.now()) / 1000).toFixed(1)}s
              </span>
            </div>
          )}

          {/* Sink Inventory */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Sink Traps:</span>
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className={`w-6 h-6 rounded border-2 flex items-center justify-center text-xs
                    ${i < sinkInventory 
                      ? 'bg-orange-500/30 border-orange-400 text-orange-400' 
                      : 'bg-muted/20 border-muted-foreground/30 text-muted-foreground/30'
                    }`}
                >
                  🕳️
                </div>
              ))}
            </div>
            {sinkInventory > 0 && (
              <span className="text-orange-400 text-xs">(Press Spacebar)</span>
            )}
          </div>
          
          <div className="mt-3 space-y-1">
            <p className="text-sm text-muted-foreground">
              <span className="text-orange-400">Spacebar</span>: Deploy Sink Trap
            </p>
          </div>

          {/* Collectibles info - only before 30 seconds */}
          {gameTime < COLLECTIBLES_START_TIME && (
            <div className="mt-3 text-xs text-muted-foreground">
              Power-ups appear in {Math.ceil(COLLECTIBLES_START_TIME - gameTime)}s...
            </div>
          )}

          {/* Status */}
          {status && (
            <p
              className="font-bold mt-2 text-sm animate-pulse"
              style={{ color: statusColor }}
            >
              {status}
            </p>
          )}
        </div>
      )}

      {/* Live Leaderboard Panel — top right, multiplayer + playing only */}
      {gameState === 'playing' && isMultiplayer && liveLeaderboard.length > 0 && (
        <div className="absolute top-5 right-5 pointer-events-none z-30 w-56">
          <div className="bg-black/60 backdrop-blur-sm rounded-lg border border-border/60 overflow-hidden">
            <div className="px-3 py-1.5 border-b border-border/40 flex items-center gap-1.5">
              <Trophy size={14} className="text-amber-400" />
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Leaderboard</span>
            </div>
            <div className="max-h-52 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-black/80">
                  <tr className="text-muted-foreground">
                    <th className="py-1 px-2 text-left">#</th>
                    <th className="py-1 px-2 text-left">Name</th>
                    <th className="py-1 px-2 text-right">💰</th>
                    <th className="py-1 px-2 text-right">📝</th>
                  </tr>
                </thead>
                <tbody>
                  {liveLeaderboard.map((entry, i) => {
                    const isYou = entry.id === socketService.getPlayerId();
                    return (
                      <tr
                        key={entry.id || i}
                        ref={isYou ? (el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) : undefined}
                        className={`border-b border-border/20 last:border-0 ${isYou ? 'bg-cream/15 text-cream' : 'text-muted-foreground'}`}
                      >
                        <td className="py-1 px-2 font-mono">{i + 1}</td>
                        <td className="py-1 px-2 truncate max-w-[5rem]">
                          {entry.name}
                          {isYou && <span className="text-muted-foreground text-[10px]"> (You)</span>}
                        </td>
                        <td className="py-1 px-2 text-right font-mono">{entry.coins}</td>
                        <td className="py-1 px-2 text-right font-mono text-cream-muted">
                          {entry.questionsCorrect}/{entry.questionsAttempted}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Back Button */}
      <Link
        to={room?.code ? `/lobby?code=${encodeURIComponent(room.code)}` : '/lobby'}
        className="absolute bottom-5 left-5 flex items-center gap-2 px-4 py-2 bg-secondary/90 hover:bg-secondary text-secondary-foreground rounded-lg transition-all pointer-events-auto"
      >
        <ArrowLeft size={18} />
        <span>Back to Lobby</span>
      </Link>

    </div>
  );
};

export default Game;
