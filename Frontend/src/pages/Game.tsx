import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Trophy, X, Shield, Users } from 'lucide-react';
import socketService, { SOCKET_EVENTS, toGrid, toPixel, Room, Player as SocketPlayer, GameState as SocketGameState, Coin as SocketCoin } from '@/services/SocketService';
import BlitzQuiz from '@/components/BlitzQuiz';
import UnfreezeQuiz from '@/components/UnfreezeQuiz';
import logger from '@/utils/logger';

const TILE_SIZE = 64;
const MAP_WIDTH = 50;
const MAP_HEIGHT = 50;
const PERSPECTIVE_STRENGTH = 0.4;
const BASE_PLAYER_SPEED = 300;
const BASE_ENEMY_SPEED = 250;
const IMMUNITY_DURATION = 10; // seconds
const COLLECTIBLES_START_TIME = 30; // seconds before collectibles appear
const COINS_FOR_IMMUNITY = 5; // coins needed for 1 stored immunity
const MAX_IMMUNITY_INVENTORY = 3; // max stored immunities

// Colors
const C_ROAD = '#2a2a2a';
const C_SIDEWALK = '#3a3a3a';
const C_WATER = '#004466';
const C_LAVA = '#cf1020';
const C_LAVA_HOT = '#ff4500';
const C_BOAT = '#8B4513';
const C_BOAT_DECK = '#A0522D';
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

interface Boat {
  dist: number;
  x: number;
  y: number;
  w: number;
  h: number;
  velX: number;
  velY: number;
  life: number;
  maxLife: number;
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
  x: number;
  y: number;
  collected: boolean;
  spawnTime: number;
}

// Immunity pickup (direct 10s immunity when collected)
interface ImmunityPickup {
  x: number;
  y: number;
  collected: boolean;
  quadrant: number;
  spawnTime: number;
}

interface SinkCollectible {
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
  lastUpdate: number;
}

// Unfreeze quiz question from server
interface UnfreezeQuestion {
  id: number;
  question: string;
  options: string[];
}

// Location state from Lobby
interface LocationState {
  room?: Room;
  gameState?: SocketGameState;
  singlePlayer?: boolean;
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
const getQuadrant = (x: number, y: number): number => {
  const midX = (MAP_WIDTH * TILE_SIZE) / 2;
  const midY = (MAP_HEIGHT * TILE_SIZE) / 2;
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
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('');
  const [statusColor, setStatusColor] = useState('#fff');
  const [sinkInventory, setSinkInventory] = useState(0);
  const [coinsCollected, setCoinsCollected] = useState(0);
  const [immunityInventory, setImmunityInventory] = useState(0);
  const [immunityActive, setImmunityActive] = useState(false);
  const [immunityTimeLeft, setImmunityTimeLeft] = useState(0);
  const [energy, setEnergy] = useState(0);
  const [gameTime, setGameTime] = useState(0);
  const [screenFlash, setScreenFlash] = useState<{ color: string; opacity: number } | null>(null);
  
  // Game state management
  const [gameState, setGameState] = useState<GameState>('name-entry');
  const [playerName, setPlayerName] = useState('');
  const playerNameRef = useRef('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [finalStats, setFinalStats] = useState({ time: 0 });
  
  // Multiplayer state
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const isMultiplayerRef = useRef(false); // Ref to avoid stale closure in game loop
  const roomCodeRef = useRef<string | null>(null); // Store room code for seeded map generation
  const [room, setRoom] = useState<Room | null>(null);
  const [isUnicorn, setIsUnicorn] = useState(false);
  const [unicornIds, setUnicornIds] = useState<string[]>([]);
  const [unicornId, setUnicornId] = useState<string | null>(null); // backward compat / first unicorn
  const [connectedPlayers, setConnectedPlayers] = useState<SocketPlayer[]>([]);
  const remotePlayersRef = useRef<Map<string, RemotePlayer>>(new Map());
  
  // Keep refs in sync with state
  useEffect(() => {
    isMultiplayerRef.current = isMultiplayer;
  }, [isMultiplayer]);
  
  useEffect(() => {
    roomCodeRef.current = room?.code || null;
  }, [room]);
  const [huntTimeLeft, setHuntTimeLeft] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(4);
  
  // Blitz quiz state
  const [blitzQuestion, setBlitzQuestion] = useState<{ question: string; options: string[] } | null>(null);
  const [blitzTimeLeft, setBlitzTimeLeft] = useState(0);
  
  // Unfreeze quiz state (when player is frozen after being tagged)
  const [unfreezeQuizData, setUnfreezeQuizData] = useState<{
    questions: UnfreezeQuestion[];
    passThreshold: number;
  } | null>(null);
  
  // Track if we've already reported lava death (to prevent multiple reports per frame)
  const lavaDeathReportedRef = useRef(false);
  
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
    boats: Boat[];
    coins: Coin[];
    immunityPickups: ImmunityPickup[];
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
    immunityPickupSpawnTimer: number;
    sinkSpawnTimer: number;
    nextCoinSpawnTime: number;
    nextImmunityPickupSpawnTime: number;
    nextSinkSpawnTime: number;
    collectiblesInitialized: boolean;
    coinsInitialized: boolean;
    speedBoostApplied: boolean;
    immunityActive: boolean;
    immunityEndTime: number;
    coinsCollected: number;
    immunityInventory: number;
    playerSinkInventory: number;
    energy: number;
    lastTime: number;
    animationId: number | null;
    isPlaying: boolean;
  } | null>(null);

  // Initialize multiplayer mode from location state
  useEffect(() => {
    if (locationState?.room && !locationState?.singlePlayer) {
      // Multiplayer mode - came from lobby
      setIsMultiplayer(true);
      setRoom(locationState.room);
      setPlayerName(localStorage.getItem('playerName') || 'Player');
      playerNameRef.current = localStorage.getItem('playerName') || 'Player';
      
      // Clear enemies that might have been spawned during init
      // In multiplayer, the unicorn player is the threat, not AI enemies
      if (gameRef.current) {
        gameRef.current.enemies = [];
      }
      
      // Check if game already started or waiting
      if (locationState.gameState) {
        setGameState('playing');
        if (gameRef.current) {
          gameRef.current.isPlaying = true;
        }
        const gs = locationState.gameState;
        const ids = gs.unicornIds ?? (gs.unicornId ? [gs.unicornId] : []);
        setUnicornIds(ids);
        setUnicornId(ids[0] ?? gs.unicornId ?? null);
        setIsUnicorn(ids.includes(socketService.getSocketId()));
      } else {
        setGameState('waiting-for-start');
      }
    } else if (locationState?.singlePlayer) {
      // Explicit single player mode
      setIsMultiplayer(false);
    }
  }, [locationState]);

  // Leave room when component unmounts (user navigates away from game)
  useEffect(() => {
    return () => {
      // Only leave room if we're in multiplayer mode
      if (isMultiplayer && socketService.isConnected()) {
        logger.game('Leaving room on game component unmount');
        socketService.leaveRoom();
      }
    };
  }, [isMultiplayer]);

  // Multiplayer socket event handlers
  useEffect(() => {
    if (!isMultiplayer) return;

    // Position updates from other players
    const unsubPosition = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_POSITION_UPDATE, (data: any) => {
      const { playerId, position } = data;
      if (playerId === socketService.getSocketId()) return; // Ignore our own updates
      
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

    // Game started
    const unsubGameStarted = socketService.on(SOCKET_EVENTS.SERVER.GAME_STARTED, (data: any) => {
      setGameState('playing');
      setRoom(data.room);
      const ids = data.gameState?.unicornIds ?? (data.gameState?.unicornId ? [data.gameState.unicornId] : []);
      setUnicornIds(ids);
      setUnicornId(ids[0] ?? data.gameState?.unicornId ?? null);
      setIsUnicorn(ids.includes(socketService.getSocketId()));
      const myId = socketService.getSocketId();
      const remotePlayers = remotePlayersRef.current;
      if (data.gameState?.players) {
        data.gameState.players.forEach((p: any) => {
          if (p.id === myId) return;
          const pos = p.position;
          const pixel = pos?.x != null ? { x: pos.x, y: pos.y } : (pos ? toPixel(pos.row, pos.col) : { x: 0, y: 0 });
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
            lastUpdate: Date.now()
          });
        });
      }
      // Start the game loop
      if (gameRef.current) {
        gameRef.current.isPlaying = true;
      }
      showStatus('Game Started!', '#00ff00', 2000);
    });

    // Unicorn transferred (single or multiple)
    const unsubUnicorn = socketService.on(SOCKET_EVENTS.SERVER.UNICORN_TRANSFERRED, (data: any) => {
      const ids = data.newUnicornIds ?? (data.newUnicornId ? [data.newUnicornId] : []);
      setUnicornIds(ids);
      setUnicornId(ids[0] ?? data.newUnicornId ?? null);
      setIsUnicorn(ids.includes(socketService.getSocketId()));
      remotePlayersRef.current.forEach((player, id) => {
        player.isUnicorn = ids.includes(id);
      });
      const socketId = socketService.getSocketId();
      if (ids.includes(socketId)) {
        showStatus(ids.length > 1 ? 'You are a Unicorn!' : 'YOU ARE THE UNICORN!', '#ff00ff', 3000);
        setScreenFlash({ color: '#ff00ff', opacity: 0.4 });
        setTimeout(() => setScreenFlash(null), 300);
      } else {
        const names = (data.room?.players ?? [])
          .filter((p: any) => ids.includes(p.id))
          .map((p: any) => p.name)
          .filter(Boolean);
        const text = names.length > 1
          ? `New Unicorns: ${names.join(', ')}`
          : `${names[0] || 'Someone'} is now the Unicorn!`;
        showStatus(text, '#ff00ff', 2000);
      }
    });

    // Hunt phase started
    const unsubHuntStart = socketService.on(SOCKET_EVENTS.SERVER.HUNT_START, (data: any) => {
      setGameState('playing');
      setBlitzQuestion(null);
      setHuntTimeLeft(data.duration / 1000);
      setCurrentRound(data.roundInfo?.currentRound || 1);
      setTotalRounds(data.roundInfo?.totalRounds || 4);
      if (data.unicornIds?.length !== undefined) {
        setUnicornIds(data.unicornIds);
        setUnicornId(data.unicornIds[0] ?? data.unicornId ?? null);
        setIsUnicorn(data.unicornIds.includes(socketService.getSocketId()));
        remotePlayersRef.current.forEach((player, id) => {
          player.isUnicorn = data.unicornIds.includes(id);
        });
      }
      if (gameRef.current) {
        if (isMultiplayerRef.current && gameRef.current.map?.portals) {
          gameRef.current.map.portals = [];
        }
        gameRef.current.isPlaying = true;
      }
      showStatus(`HUNT PHASE - Round ${data.roundInfo?.currentRound || 1}!`, '#ff4400', 2000);
    });

    // Hunt phase ended
    const unsubHuntEnd = socketService.on(SOCKET_EVENTS.SERVER.HUNT_END, () => {
      showStatus('Hunt phase ended!', '#888', 1500);
    });

    // Blitz quiz started
    const unsubBlitzStart = socketService.on(SOCKET_EVENTS.SERVER.BLITZ_START, (data: any) => {
      setGameState('blitz-quiz');
      setBlitzQuestion({
        question: data.question.question,
        options: data.question.options
      });
      setBlitzTimeLeft(data.timeLimit / 1000);
      showStatus('BLITZ QUIZ!', '#ffff00', 1500);
    });

    // Blitz quiz result
    const unsubBlitzResult = socketService.on(SOCKET_EVENTS.SERVER.BLITZ_RESULT, (data: any) => {
      setBlitzQuestion(null);
      const ids = data.newUnicornIds ?? (data.newUnicornId ? [data.newUnicornId] : []);
      setUnicornIds(ids);
      setUnicornId(ids[0] ?? data.newUnicornId ?? null);
      setIsUnicorn(ids.includes(socketService.getSocketId()));
      remotePlayersRef.current.forEach((player, id) => {
        player.isUnicorn = ids.includes(id);
      });
    });

    // Player eliminated (fallback for any remaining instant kill scenarios)
    const unsubEliminated = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_ELIMINATED, (data: any) => {
      const { playerId, attackerId } = data;
      
      if (playerId === socketService.getSocketId()) {
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
      const { playerId, state, playerName } = data;
      
      if (playerId === socketService.getSocketId()) {
        // Our state changed
        if (state === 'frozen') {
          // We got frozen - set state immediately so we show loading/frozen UI
          // The UNFREEZE_QUIZ_START event should follow shortly with quiz questions
          setGameState('frozen');
          showStatus('YOU\'VE BEEN FROZEN!', '#00ffff', 2000);
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
      const { caughtId, caughtName, unicornName } = data;
      
      if (caughtId !== socketService.getSocketId()) {
        // Someone else got tagged
        showStatus(`${caughtName} was caught by ${unicornName}!`, '#ff4400', 2000);
      }
    });

    // Unfreeze quiz started (we got tagged and frozen)
    const unsubUnfreezeStart = socketService.on(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_START, (data: any) => {
      setGameState('frozen');
      setUnfreezeQuizData({
        questions: data.questions,
        passThreshold: data.passThreshold
      });
    });

    // Unfreeze quiz complete
    const unsubUnfreezeComplete = socketService.on(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_COMPLETE, (data: any) => {
      if (data.passed) {
        setGameState('playing');
        setUnfreezeQuizData(null);
        lavaDeathReportedRef.current = false; // Reset so lava death can be reported again
        showStatus('UNFROZEN! Back in the game!', '#00ff00', 2000);
        setScreenFlash({ color: '#00ff00', opacity: 0.3 });
        setTimeout(() => setScreenFlash(null), 300);
      } else if (data.retry) {
        // Failed - new questions will arrive via UNFREEZE_QUIZ_START
        showStatus('Wrong! Try again...', '#ff4400', 1500);
      }
    });

    // Unfreeze quiz cancelled (blitz starting or game ending)
    const unsubUnfreezeCancelled = socketService.on(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_CANCELLED, (data: any) => {
      setGameState('playing');
      setUnfreezeQuizData(null);
      lavaDeathReportedRef.current = false; // Reset so lava death can be reported again
      showStatus(data.message || 'Quiz cancelled - you\'ve been unfrozen!', '#ffff00', 2000);
    });

    // Player respawn (after unfreeze quiz passed)
    const unsubPlayerRespawn = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_RESPAWN, (data: any) => {
      const { playerId, position } = data;
      
      if (playerId === socketService.getSocketId()) {
        // We respawned - update our position
        lavaDeathReportedRef.current = false; // Reset so lava death can be reported again
        if (gameRef.current && position) {
          gameRef.current.player.x = position.x || toPixel(position.row, position.col).x;
          gameRef.current.player.y = position.y || toPixel(position.row, position.col).y;
          gameRef.current.player.trail = [];
        }
      } else {
        // Remote player respawned
        const remotePlayer = remotePlayersRef.current.get(playerId);
        if (remotePlayer && position) {
          const pixel = position.x ? position : toPixel(position.row, position.col);
          remotePlayer.x = pixel.x;
          remotePlayer.y = pixel.y;
          remotePlayer.targetX = pixel.x;
          remotePlayer.targetY = pixel.y;
          remotePlayer.isFrozen = false;
        }
      }
    });

    // Coin spawned
    const unsubCoinSpawned = socketService.on(SOCKET_EVENTS.SERVER.COIN_SPAWNED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      
      // Handle both single coin and batch spawns
      const coins = data.coins || [data];
      coins.forEach((coinData: any) => {
        const pixel = toPixel(coinData.row, coinData.col);
        game.coins.push({
          x: pixel.x,
          y: pixel.y,
          collected: false,
          spawnTime: Date.now() * 0.001
        });
      });
    });

    // Coin collected
    const unsubCoinCollected = socketService.on(SOCKET_EVENTS.SERVER.COIN_COLLECTED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      
      // Remove the collected coin (server is authoritative)
      // We mark by position since IDs might differ
      const coinIndex = game.coins.findIndex(c => {
        const grid = toGrid(c.x, c.y);
        return !c.collected && grid.row === data.row && grid.col === data.col;
      });
      
      if (coinIndex !== -1) {
        game.coins[coinIndex].collected = true;
      }
      
      if (data.playerId === socketService.getSocketId()) {
        setCoinsCollected(data.newScore || game.coinsCollected + 1);
      }
    });

    // Game ended
    const unsubGameEnd = socketService.on(SOCKET_EVENTS.SERVER.GAME_END, (data: any) => {
      setGameState('game-over');
      setFinalStats({ time: gameRef.current?.gameTime || 0 });
      showStatus('GAME OVER!', '#ff0000', 3000);
    });

    // Room closed (kicked from room after game ended)
    const unsubRoomLeft = socketService.on(SOCKET_EVENTS.SERVER.ROOM_LEFT, (data: any) => {
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
      
      if (playerId === socketService.getSocketId()) {
        // Local player teleported - update position immediately
        game.player.x = toPosition.x;
        game.player.y = toPosition.y;
        game.player.trail = [];
        game.player.portalCooldown = 2.0;
        showStatus('TELEPORTED!', '#00ffff', 1500);
        setScreenFlash({ color: '#00ffff', opacity: 0.3 });
        setTimeout(() => setScreenFlash(null), 200);
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

    // Sink trap spawned
    const unsubSinkTrapSpawned = socketService.on(SOCKET_EVENTS.SERVER.SINK_TRAP_SPAWNED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      const pixel = toPixel(data.row, data.col);
      game.sinkCollectibles.push({
        x: pixel.x,
        y: pixel.y,
        collected: false,
        spawnTime: Date.now() * 0.001
      });
    });

    // Sink trap collected
    const unsubSinkTrapCollected = socketService.on(SOCKET_EVENTS.SERVER.SINK_TRAP_COLLECTED, (data: any) => {
      if (!gameRef.current) return;
      const game = gameRef.current;
      
      // Remove the collected trap from the map
      const pixel = toPixel(data.row, data.col);
      const trapIndex = game.sinkCollectibles.findIndex(s => 
        !s.collected && Math.hypot(s.x - pixel.x, s.y - pixel.y) < 32
      );
      if (trapIndex !== -1) {
        game.sinkCollectibles[trapIndex].collected = true;
      }
      
      // Update our inventory if we collected it
      if (data.playerId === socketService.getSocketId()) {
        game.playerSinkInventory = data.newInventoryCount;
        setSinkInventory(data.newInventoryCount);
        showStatus('SINK TRAP COLLECTED!', '#ff6600', 1500);
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
      if (data.playerId === socketService.getSocketId()) {
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
      
      if (unicornId === socketService.getSocketId()) {
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
        showStatus('UNICORN TRAPPED!', '#00ff00', 2000);
      }
    });

    // Game state sync (for reconnection recovery and initial blitz quiz sync)
    // Handles:
    // 1. Populate/update remote players with names (we navigate from Lobby so we miss GAME_STARTED)
    // 2. Blitz quiz sync when client misses BLITZ_START due to navigation timing
    // 3. Frozen player recovery with unfreeze quiz data
    const unsubGameStateSync = socketService.on(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, (data: any) => {
      if (!data.gameState) return;
      
      const myId = socketService.getSocketId();
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
          const pixel = pos?.x != null ? { x: pos.x, y: pos.y } : (pos ? toPixel(pos.row, pos.col) : { x: 0, y: 0 });
          const existing = remotePlayers.get(p.id);
          if (existing) {
            existing.name = p.name || existing.name || 'Player';
            existing.x = pixel.x;
            existing.y = pixel.y;
            existing.targetX = pixel.x;
            existing.targetY = pixel.y;
            existing.isFrozen = p.state === 'frozen';
            existing.isUnicorn = unicornIdsSync.includes(p.id);
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
              lastUpdate: Date.now()
            });
          }
        });
      }
      
      // Handle blitz quiz sync - this fixes the race condition where
      // the client navigates to /game and misses BLITZ_START
      if (data.phase === 'blitz_quiz' && data.blitzQuiz) {
        logger.quiz('Game state sync: Received blitz quiz data');
        
        // Only set up blitz quiz if we don't already have one active
        setBlitzQuestion(currentQuestion => {
          if (currentQuestion === null) {
            logger.quiz('Setting up blitz quiz from state sync:', data.blitzQuiz.question.question);
            
            // Calculate remaining time from server data
            const timeRemaining = data.blitzQuiz.timeRemaining || data.blitzQuiz.timeLimit;
            setBlitzTimeLeft(Math.ceil(timeRemaining / 1000));
            setGameState('blitz-quiz');
            showStatus('BLITZ QUIZ!', '#ffff00', 1500);
            
            return {
              question: data.blitzQuiz.question.question,
              options: data.blitzQuiz.question.options
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
      unsubGameStarted();
      unsubUnicorn();
      unsubHuntStart();
      unsubHuntEnd();
      unsubBlitzStart();
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
      unsubRoomLeft();
      unsubSinkholeSpawned();
      unsubPlayerTeleported();
      unsubSinkTrapSpawned();
      unsubSinkTrapCollected();
      unsubSinkTrapDeployed();
      unsubSinkTrapTriggered();
      unsubGameStateSync();
    };
  }, [isMultiplayer, unicornIds, gameState, navigate]);

  // Show status helper (defined early for use in socket handlers)
  const showStatus = useCallback((text: string, color: string = '#fff', duration: number = 2000) => {
    setStatus(text);
    setStatusColor(color);
    setTimeout(() => setStatus(''), duration);
  }, []);

  // Timer effect for blitz and hunt timers (multiplayer)
  useEffect(() => {
    if (!isMultiplayer) return;
    
    const interval = setInterval(() => {
      if (blitzTimeLeft > 0) {
        setBlitzTimeLeft(prev => Math.max(0, prev - 1));
      }
      if (huntTimeLeft > 0) {
        setHuntTimeLeft(prev => Math.max(0, prev - 1));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isMultiplayer, blitzTimeLeft > 0, huntTimeLeft > 0]);

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

  // Draw immunity pickup - Lightning bolt with shield icon
  const drawImmunityPickup = (ctx: CanvasRenderingContext2D, pickup: ImmunityPickup) => {
    const time = Date.now() * 0.005 + pickup.spawnTime;
    const pulse = 0.8 + Math.sin(time * 3) * 0.2;
    const bob = Math.sin(time * 2) * 4;
    
    ctx.save();
    ctx.translate(pickup.x, pickup.y + bob);
    
    // Electric glow effect
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 30 * pulse;
    
    // Outer glowing circle
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 20 * pulse);
    gradient.addColorStop(0, 'rgba(0, 255, 255, 0.9)');
    gradient.addColorStop(0.5, 'rgba(0, 200, 255, 0.6)');
    gradient.addColorStop(1, 'rgba(0, 100, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 20 * pulse, 0, Math.PI * 2);
    ctx.fill();
    
    // Core circle
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#001133';
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    
    // Shield icon
    ctx.fillStyle = '#00ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(8, -5);
    ctx.lineTo(8, 2);
    ctx.quadraticCurveTo(8, 9, 0, 12);
    ctx.quadraticCurveTo(-8, 9, -8, 2);
    ctx.lineTo(-8, -5);
    ctx.closePath();
    ctx.fill();
    
    // Inner shield highlight
    ctx.fillStyle = '#001133';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(4, -3);
    ctx.lineTo(4, 1);
    ctx.quadraticCurveTo(4, 5, 0, 7);
    ctx.quadraticCurveTo(-4, 5, -4, 1);
    ctx.lineTo(-4, -3);
    ctx.closePath();
    ctx.fill();
    
    // Electric arcs around
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const angle = time * 3 + (i * Math.PI * 2 / 3);
      const dist = 18;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * dist, Math.sin(angle) * dist, 3, 0, Math.PI * 2);
      ctx.stroke();
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

  // Draw isometric Qbit with immunity effect
  const drawQbitIsometric = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    isPlayer: boolean,
    isWalking: boolean,
    hasImmunity: boolean = false,
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
    // Enemy (single player mode): Red theme
    const colors = isUnicornChar ? {
      shadow: 'rgba(255, 0, 255, 0.4)',
      coatDark: '#9333ea',
      coat: '#a855f7',
      shirt: '#f0abfc',
      hatBrim: '#f9a8d4',
      hatTop: '#ec4899',
      badge: '#f9a8d4',
      glow: '#ff00ff'
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
      shadow: 'rgba(255, 0, 0, 0.3)',
      coatDark: '#991b1b',
      coat: '#dc2626',
      shirt: '#fca5a5',
      hatBrim: '#fca5a5',
      hatTop: '#ef4444',
      badge: '#fca5a5',
      glow: '#ff0000'
    };

    // Unicorn glow effect
    if (isUnicornChar) {
      ctx.save();
      ctx.rotate(-(angle + Math.PI / 2)); // Counter-rotate for screen-aligned glow
      const glowPulse = 0.8 + Math.sin(Date.now() * 0.008) * 0.2;
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 20 * glowPulse;
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.4 + Math.sin(Date.now() * 0.01) * 0.2;
      ctx.beginPath();
      ctx.arc(0, 0, 30 * glowPulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Immunity shield effect
    if (hasImmunity && isPlayer) {
      ctx.save();
      ctx.rotate(-(angle + Math.PI / 2)); // Counter-rotate for screen-aligned shield
      const shieldPulse = 0.8 + Math.sin(Date.now() * 0.01) * 0.2;
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.6 + Math.sin(Date.now() * 0.008) * 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, 35 * shieldPulse, 0, Math.PI * 2);
      ctx.stroke();
      
      // Inner shield glow
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
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

  const startGame = () => {
    if (!playerName.trim()) return;
    playerNameRef.current = playerName.trim();
    setGameState('playing');
    setSinkInventory(0);
    setCoinsCollected(0);
    setImmunityInventory(0);
    setImmunityActive(false);
    setImmunityTimeLeft(0);
    setGameTime(0);
    
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    if (gameRef.current) {
      const game = gameRef.current;
      game.keys = {}; // Reset all keys to prevent stuck movement
      game.isPlaying = true;
      game.gameTime = 0;
      game.speedBoostApplied = false;
      game.immunityActive = false;
      game.immunityEndTime = 0;
      game.coinsCollected = 0;
      game.immunityInventory = 0;
      game.playerSinkInventory = 0;
      game.coinSpawnTimer = 0;
      game.immunityPickupSpawnTimer = 0;
      game.sinkSpawnTimer = 0;
      game.nextCoinSpawnTime = 10 + Math.random() * 5;
      game.nextImmunityPickupSpawnTime = 20 + Math.random() * 10;
      game.nextSinkSpawnTime = 25 + Math.random() * 10;
      game.collectiblesInitialized = false;
      game.coinsInitialized = false;
      game.player.speed = BASE_PLAYER_SPEED;
      game.player.velX = 0;
      game.player.velY = 0;
    }
  };

  const handleDeath = () => {
    if (!gameRef.current) return;
    
    const time = gameRef.current.gameTime;
    
    setFinalStats({ time });
    const nameToSave = playerNameRef.current || playerName;
    if (nameToSave.trim()) {
      saveToLeaderboard(nameToSave, time);
    }
    setGameState('game-over');
    gameRef.current.isPlaying = false;
  };

  const handlePlayAgain = () => {
    setGameState('playing');
    setSinkInventory(0);
    setCoinsCollected(0);
    setImmunityInventory(0);
    setImmunityActive(false);
    setImmunityTimeLeft(0);
    setEnergy(0);
    
    if (gameRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      gameRef.current.keys = {}; // Reset stuck keys
      gameRef.current.isPlaying = true;
      gameRef.current.gameTime = 0;
      gameRef.current.speedBoostApplied = false;
      gameRef.current.immunityActive = false;
      gameRef.current.immunityEndTime = 0;
      gameRef.current.coinsCollected = 0;
      gameRef.current.immunityInventory = 0;
      gameRef.current.playerSinkInventory = 0;
      gameRef.current.energy = 0;
      gameRef.current.coins = [];
      gameRef.current.immunityPickups = [];
      gameRef.current.sinkCollectibles = [];
      gameRef.current.deployedSinks = [];
      gameRef.current.coinSpawnTimer = 0;
      gameRef.current.immunityPickupSpawnTimer = 0;
      gameRef.current.sinkSpawnTimer = 0;
      gameRef.current.player.speed = BASE_PLAYER_SPEED;
      
      handleRestart();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const minimapCanvas = minimapRef.current;
    if (!canvas || !minimapCanvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    const minimapCtx = minimapCanvas.getContext('2d');
    if (!ctx || !minimapCtx) return;

    // Set roomCodeRef immediately from locationState for seeded map generation
    // This needs to happen before generateCity() is called
    if (locationState?.room?.code) {
      roomCodeRef.current = locationState.room.code;
      isMultiplayerRef.current = true;
    }

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
        speed: BASE_PLAYER_SPEED,
        velX: 0,
        velY: 0,
        dirX: 0,
        dirY: 1,
        trail: [] as { x: number; y: number }[],
        portalCooldown: 0,
      },
      enemies: [] as Enemy[],
      boats: [] as Boat[],
      coins: [] as Coin[],
      immunityPickups: [] as ImmunityPickup[],
      sinkCollectibles: [] as SinkCollectible[],
      deployedSinks: [] as DeployedSink[],
      map: {
        width: MAP_WIDTH * TILE_SIZE,
        height: MAP_HEIGHT * TILE_SIZE,
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
      immunityPickupSpawnTimer: 0,
      sinkSpawnTimer: 0,
      nextCoinSpawnTime: 10 + Math.random() * 5,
      nextImmunityPickupSpawnTime: 20 + Math.random() * 10,
      nextSinkSpawnTime: 25 + Math.random() * 10,
      collectiblesInitialized: false,
      coinsInitialized: false,
      speedBoostApplied: false,
      immunityActive: false,
      immunityEndTime: 0,
      coinsCollected: 0,
      immunityInventory: 0,
      playerSinkInventory: 0,
      energy: 0,
      lastTime: 0,
      animationId: null as number | null,
      isPlaying: false,
    };
    gameRef.current = game;

    // Generate city with seeded random for multiplayer consistency
    const generateCity = () => {
      game.map.tiles = [];
      game.map.buildings = [];
      game.map.trees = [];
      game.map.portals = [];

      // Use seeded random if in multiplayer mode (room code as seed)
      // This ensures all players in the same room get the same map
      const rng = roomCodeRef.current 
        ? new SeededRandom(roomCodeRef.current)
        : { random: () => Math.random() }; // Fallback to Math.random for single player

      for (let y = 0; y < MAP_HEIGHT; y++) {
        const row: number[] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
          row.push(1);
        }
        game.map.tiles.push(row);
      }

      const blockSize = 4;
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const isRoadRow = y % blockSize === 0;
          const isRoadCol = x % blockSize === 0;

          if (isRoadRow || isRoadCol) {
            game.map.tiles[y][x] = 0;
          } else {
            const rand = rng.random();
            if (rand < 0.05) {
              for (let ly = y - 1; ly <= y + 1; ly++) {
                for (let lx = x - 1; lx <= x + 1; lx++) {
                  if (ly >= 0 && ly < MAP_HEIGHT && lx >= 0 && lx < MAP_WIDTH) {
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

      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
            game.map.tiles[y][x] = 4;
            continue;
          }

          const tile = game.map.tiles[y][x];
          const px = x * TILE_SIZE;
          const py = y * TILE_SIZE;

          if (tile === 1) {
            const rand = rng.random();
            let type = TYPE_RESIDENTIAL;
            let height = 40 + rng.random() * 60;
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
        const px = Math.floor(rng.random() * (MAP_WIDTH - 2)) + 1;
        const py = Math.floor(rng.random() * (MAP_HEIGHT - 2)) + 1;
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

    const initBoats = () => {
      game.boats = [];
      const perimeter = (MAP_WIDTH * 2 + MAP_HEIGHT * 2) * TILE_SIZE;
      const boatCount = 10;
      const spacing = perimeter / boatCount;

      for (let i = 0; i < boatCount; i++) {
        game.boats.push({
          dist: i * spacing,
          x: 0,
          y: 0,
          w: 48,
          h: 48,
          velX: 0,
          velY: 0,
          life: 10.0,
          maxLife: 10.0,
        });
      }
    };

    const findSafeSpawn = (entity: { x: number; y: number }) => {
      let spawnFound = false;
      while (!spawnFound) {
        const x = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
        const y = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
        if (game.map.tiles[y][x] === 0) {
          entity.x = x * TILE_SIZE + TILE_SIZE / 2;
          entity.y = y * TILE_SIZE + TILE_SIZE / 2;
          spawnFound = true;
        }
      }
    };

    const spawnEnemy = () => {
      let ex = 0, ey = 0;
      let valid = false;
      let attempts = 0;

      while (!valid && attempts < 100) {
        attempts++;
        const rx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
        const ry = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;

        if (game.map.tiles[ry][rx] === 0) {
          const candidateX = rx * TILE_SIZE + TILE_SIZE / 2;
          const candidateY = ry * TILE_SIZE + TILE_SIZE / 2;
          const d = Math.hypot(candidateX - game.player.x, candidateY - game.player.y);
          if (d > 800) {
            ex = candidateX;
            ey = candidateY;
            valid = true;
          }
        }
      }

      if (valid) {
        const baseSpeed = BASE_ENEMY_SPEED + Math.random() * 30;
        const speed = game.speedBoostApplied ? baseSpeed * 1.2 : baseSpeed;
        
        game.enemies.push({
          x: ex,
          y: ey,
          width: 24,
          height: 24,
          speed,
          trail: [],
          stuckTime: 0,
          flankTimer: 0,
          flankDir: { x: 0, y: 0 },
        });
      }
    };

    // Spawn enemy far from player (for sink trap respawn)
    const spawnEnemyFarFrom = (avoidX: number, avoidY: number, minDist: number) => {
      let ex = 0, ey = 0;
      let valid = false;
      let attempts = 0;

      while (!valid && attempts < 200) {
        attempts++;
        const rx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
        const ry = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;

        if (game.map.tiles[ry][rx] === 0) {
          const candidateX = rx * TILE_SIZE + TILE_SIZE / 2;
          const candidateY = ry * TILE_SIZE + TILE_SIZE / 2;
          const d = Math.hypot(candidateX - avoidX, candidateY - avoidY);
          if (d > minDist) {
            ex = candidateX;
            ey = candidateY;
            valid = true;
          }
        }
      }

      return valid ? { x: ex, y: ey } : null;
    };

    // Spawn coin on road
    const spawnCoin = () => {
      if (game.coins.filter(c => !c.collected).length >= 40) return;
      
      let attempts = 0;
      while (attempts < 100) {
        attempts++;
        const rx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
        const ry = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
        
        if (game.map.tiles[ry]?.[rx] === 0) {
          const cx = rx * TILE_SIZE + TILE_SIZE / 2;
          const cy = ry * TILE_SIZE + TILE_SIZE / 2;
          const d = Math.hypot(cx - game.player.x, cy - game.player.y);
          if (d > 200) {
            game.coins.push({
              x: cx,
              y: cy,
              collected: false,
              spawnTime: Date.now() * 0.001,
            });
            return;
          }
        }
      }
    };

    // Spawn immunity pickup in a specific quadrant
    const spawnImmunityPickupInQuadrant = (quadrant: number) => {
      const midX = MAP_WIDTH / 2;
      const midY = MAP_HEIGHT / 2;
      
      let minX = 1, maxX = midX - 1, minY = 1, maxY = midY - 1;
      if (quadrant === 1) { minX = midX; maxX = MAP_WIDTH - 2; }
      if (quadrant === 2) { minY = midY; maxY = MAP_HEIGHT - 2; }
      if (quadrant === 3) { minX = midX; maxX = MAP_WIDTH - 2; minY = midY; maxY = MAP_HEIGHT - 2; }
      
      let attempts = 0;
      while (attempts < 100) {
        attempts++;
        const rx = Math.floor(minX + Math.random() * (maxX - minX));
        const ry = Math.floor(minY + Math.random() * (maxY - minY));
        
        if (game.map.tiles[ry]?.[rx] === 0) {
          const cx = rx * TILE_SIZE + TILE_SIZE / 2;
          const cy = ry * TILE_SIZE + TILE_SIZE / 2;
          
          game.immunityPickups.push({
            x: cx,
            y: cy,
            collected: false,
            quadrant,
            spawnTime: Date.now() * 0.001,
          });
          return;
        }
      }
    };

    // Spawn sink collectible
    const spawnSinkCollectible = () => {
      if (game.sinkCollectibles.filter(s => !s.collected).length >= 2) return;
      
      let attempts = 0;
      while (attempts < 100) {
        attempts++;
        const rx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
        const ry = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
        
        if (game.map.tiles[ry]?.[rx] === 0) {
          const cx = rx * TILE_SIZE + TILE_SIZE / 2;
          const cy = ry * TILE_SIZE + TILE_SIZE / 2;
          const d = Math.hypot(cx - game.player.x, cy - game.player.y);
          if (d > 300) {
            game.sinkCollectibles.push({
              x: cx,
              y: cy,
              collected: false,
              spawnTime: Date.now() * 0.001,
            });
            return;
          }
        }
      }
    };

    const init = () => {
      generateCity();
      initBoats();
      findSafeSpawn(game.player);
      game.player.trail = [];
      game.player.portalCooldown = 0;
      game.player.dirX = 0;
      game.player.dirY = 1;
      game.player.speed = BASE_PLAYER_SPEED;

      game.enemies = [];
      game.enemySpawnTimer = 0;
      game.coinSpawnTimer = 0;
      game.immunityPickupSpawnTimer = 0;
      game.sinkSpawnTimer = 0;
      game.nextCoinSpawnTime = 10 + Math.random() * 5;
      game.nextImmunityPickupSpawnTime = 20 + Math.random() * 10;
      game.nextSinkSpawnTime = 25 + Math.random() * 10;
      game.collectiblesInitialized = false;
      game.coinsInitialized = false;
      game.speedBoostApplied = false;
      game.immunityActive = false;
      game.immunityEndTime = 0;
      game.coinsCollected = 0;
      game.immunityInventory = 0;
      game.playerSinkInventory = 0;
      game.coins = [];
      game.immunityPickups = [];
      game.sinkCollectibles = [];
      game.deployedSinks = [];
      
      // Only spawn enemies in single-player mode
      // In multiplayer, the unicorn player is the threat
      if (!isMultiplayerRef.current) {
        for (let i = 0; i < 3; i++) {
          spawnEnemy();
        }
      }

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
          if (gy >= 0 && gy < MAP_HEIGHT && gx >= 0 && gx < MAP_WIDTH) {
            const tile = game.map.tiles[gy][gx];
            let solid = tile === 1 || tile === 3;
            if (tile === 4 && !isPlayer) solid = true;

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

    const getBoatUnderPlayer = (): Boat | null => {
      for (const b of game.boats) {
        if (b.life <= 0) continue;
        if (
          Math.abs(game.player.x - b.x) < b.w / 2 + game.player.width / 2 &&
          Math.abs(game.player.y - b.y) < b.h / 2 + game.player.height / 2
        ) {
          return b;
        }
      }
      return null;
    };

    const checkLavaDeath = (): boolean => {
      if (getBoatUnderPlayer()) return false;
      const gridX = Math.floor(game.player.x / TILE_SIZE);
      const gridY = Math.floor(game.player.y / TILE_SIZE);
      if (gridY >= 0 && gridY < MAP_HEIGHT && gridX >= 0 && gridX < MAP_WIDTH) {
        if (game.map.tiles[gridY][gridX] === 4) return true;
      }
      return false;
    };

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

    const updateBoats = (dt: number) => {
      const speed = 150;
      const totalDist = (MAP_WIDTH - 1 + MAP_HEIGHT - 1) * 2 * TILE_SIZE;

      game.boats.forEach((b) => {
        b.dist = (b.dist + speed * dt) % totalDist;

        const topLen = (MAP_WIDTH - 1) * TILE_SIZE;
        const rightLen = (MAP_HEIGHT - 1) * TILE_SIZE;
        const bottomLen = (MAP_WIDTH - 1) * TILE_SIZE;

        let currentDist = b.dist;
        let nx = 0, ny = 0;

        if (currentDist < topLen) {
          nx = currentDist;
          ny = 0;
          b.velX = speed;
          b.velY = 0;
        } else if (currentDist < topLen + rightLen) {
          currentDist -= topLen;
          nx = (MAP_WIDTH - 1) * TILE_SIZE;
          ny = currentDist;
          b.velX = 0;
          b.velY = speed;
        } else if (currentDist < topLen + rightLen + bottomLen) {
          currentDist -= topLen + rightLen;
          nx = (MAP_WIDTH - 1) * TILE_SIZE - currentDist;
          ny = (MAP_HEIGHT - 1) * TILE_SIZE;
          b.velX = -speed;
          b.velY = 0;
        } else {
          currentDist -= topLen + rightLen + bottomLen;
          nx = 0;
          ny = (MAP_HEIGHT - 1) * TILE_SIZE - currentDist;
          b.velX = 0;
          b.velY = -speed;
        }

        b.x = nx + TILE_SIZE / 2;
        b.y = ny + TILE_SIZE / 2;
      });
    };

    const trySpawnPortal = () => {
      if (game.energy < 1) {
        showStatus('ENERGY NOT FULL! Keep moving!', '#888', 500);
        return;
      }
      
      // Remove only player-created portals (keep permanent ones)
      game.map.portals = game.map.portals.filter(p => !p.isPlayerCreated);
      
      // Spawn portal 1 second ahead of player based on current speed
      const spawnDist = game.player.speed * 1;
      const px = game.player.x + game.player.dirX * spawnDist;
      const py = game.player.y + game.player.dirY * spawnDist;

      game.map.portals.push({
        x: px,
        y: py,
        color: '#ff00ff',
        angle: 0,
        life: 10.0,
        isPlayerCreated: true,
      });

      game.energy = 0; // Consume energy
      setEnergy(0);
      showStatus('>> PORTAL CREATED <<', '#d0f');
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

    const activateImmunity = () => {
      if (game.immunityInventory <= 0) {
        showStatus('NO IMMUNITY STORED! Collect 5 coins', '#888', 500);
        return;
      }
      if (game.immunityActive) {
        showStatus('IMMUNITY ALREADY ACTIVE!', '#888', 500);
        return;
      }
      
      game.immunityInventory--;
      setImmunityInventory(game.immunityInventory);
      game.immunityActive = true;
      game.immunityEndTime = game.gameTime + IMMUNITY_DURATION;
      setImmunityActive(true);
      showStatus('🛡️ IMMUNITY ACTIVATED! 10 seconds', '#00ffff', 2000);
      
      // Screen flash effect
      setScreenFlash({ color: '#00ffff', opacity: 0.3 });
      setTimeout(() => setScreenFlash(null), 200);
    };

    const update = (dt: number) => {
      if (!game.isPlaying) return;
      
      game.gameTime += dt;
      
      // Sync game time to React state
      if (Math.floor(game.gameTime * 2) !== Math.floor((game.gameTime - dt) * 2)) {
        setGameTime(game.gameTime);
      }
      
      updateBoats(dt);

      // Speed boost at 30 seconds (game difficulty)
      if (!game.speedBoostApplied && game.gameTime >= 30) {
        game.speedBoostApplied = true;
        game.player.speed = BASE_PLAYER_SPEED * 1.2;
        game.enemies.forEach(enemy => {
          enemy.speed = enemy.speed * 1.2;
        });
        showStatus('⚡ DIFFICULTY UP! Everything is 20% faster!', '#ffcc00', 3000);
      }

      // Handle immunity expiration
      if (game.immunityActive && game.gameTime >= game.immunityEndTime) {
        game.immunityActive = false;
        setImmunityActive(false);
        showStatus('Immunity ended!', '#888', 1000);
      }
      
      // Update immunity time left for UI
      if (game.immunityActive) {
        setImmunityTimeLeft(Math.max(0, game.immunityEndTime - game.gameTime));
      }

      // Spawn coins from the start of the game (single player only)
      // In multiplayer, coins are spawned by the server via COIN_SPAWNED events
      if (!isMultiplayerRef.current) {
        if (!game.coinsInitialized) {
          game.coinsInitialized = true;
          // Spawn initial batch of coins
          for (let i = 0; i < 20; i++) {
            spawnCoin();
          }
        }
        
        // Regular spawn timer for coins (always active)
        game.coinSpawnTimer += dt;
        if (game.coinSpawnTimer >= game.nextCoinSpawnTime) {
          game.coinSpawnTimer = 0;
          game.nextCoinSpawnTime = 3 + Math.random() * 4;
          // Spawn 3-5 coins at a time
          const numCoins = 3 + Math.floor(Math.random() * 3);
          for (let i = 0; i < numCoins; i++) {
            spawnCoin();
          }
        }
      }
      
      // Spawn other collectibles after 30 seconds (single player only)
      // In multiplayer, powerups and traps are controlled by the server
      if (!isMultiplayerRef.current && game.gameTime >= COLLECTIBLES_START_TIME) {
        // First time crossing threshold - spawn initial batch with screen flash
        if (!game.collectiblesInitialized) {
          game.collectiblesInitialized = true;
          // Spawn initial immunity pickups in all quadrants
          for (let q = 0; q < 4; q++) {
            spawnImmunityPickupInQuadrant(q);
          }
          // Spawn initial sink
          spawnSinkCollectible();
          showStatus('⚡ POWER-UPS NOW AVAILABLE!', '#00ff00', 2000);
          
          // Screen flash effect
          setScreenFlash({ color: '#00ff00', opacity: 0.4 });
          setTimeout(() => setScreenFlash(null), 300);
        }
        
        // Regular spawn timer for immunity pickups
        game.immunityPickupSpawnTimer += dt;
        if (game.immunityPickupSpawnTimer >= game.nextImmunityPickupSpawnTime) {
          game.immunityPickupSpawnTimer = 0;
          game.nextImmunityPickupSpawnTime = 25 + Math.random() * 15;
          
          // Count pickups per quadrant
          const quadrantCounts = [0, 0, 0, 0];
          game.immunityPickups.forEach(p => {
            if (!p.collected) quadrantCounts[p.quadrant]++;
          });
          
          // Spawn in quadrants with < 2 pickups
          for (let q = 0; q < 4; q++) {
            if (quadrantCounts[q] < 2) {
              spawnImmunityPickupInQuadrant(q);
            }
          }
        }
        
        // Regular spawn timer for sink collectibles
        game.sinkSpawnTimer += dt;
        if (game.sinkSpawnTimer >= game.nextSinkSpawnTime) {
          game.sinkSpawnTimer = 0;
          game.nextSinkSpawnTime = 25 + Math.random() * 10;
          spawnSinkCollectible();
        }
      }

      let dx = 0, dy = 0;
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

      // Energy recharge based on movement
      if (dx !== 0 || dy !== 0) {
        game.energy = Math.min(1, game.energy + dt * 0.3);
        setEnergy(game.energy);
      }

      const riddenBoat = getBoatUnderPlayer();
      if (riddenBoat) {
        riddenBoat.life -= dt;
        game.player.x += riddenBoat.velX * dt;
        game.player.y += riddenBoat.velY * dt;
      }

      game.boats.forEach((b) => {
        if (b !== riddenBoat) b.life = b.maxLife;
      });

      attemptMove(
        game.player,
        game.player.velX * dt,
        game.player.velY * dt,
        true
      );

      if (checkLavaDeath()) {
        if (isMultiplayerRef.current) {
          // In multiplayer, lava death triggers freeze + unfreeze quiz
          // Only report once to prevent multiple quiz starts
          if (!lavaDeathReportedRef.current) {
            lavaDeathReportedRef.current = true;
            socketService.reportLavaDeath();
          }
        } else {
          // In single player, lava death is game over
          handleDeath();
        }
        return;
      }

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
      }

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
          if (isMultiplayerRef.current) {
            // In multiplayer, emit to server and let it handle the collection
            // Mark as collected locally for immediate feedback (server will confirm)
            coin.collected = true;
            const grid = toGrid(coin.x, coin.y);
            socketService.collectCoin(`coin_${grid.row}_${grid.col}`);
            // Note: The actual score update comes from COIN_COLLECTED event
          } else {
            // Single player mode - handle locally
            coin.collected = true;
            game.coinsCollected++;
            setCoinsCollected(game.coinsCollected);
            
            // Check if we've collected 5 coins
            if (game.coinsCollected >= COINS_FOR_IMMUNITY) {
              if (game.immunityInventory < MAX_IMMUNITY_INVENTORY) {
                game.immunityInventory++;
                setImmunityInventory(game.immunityInventory);
                game.coinsCollected = 0;
                setCoinsCollected(0);
                showStatus('🛡️ IMMUNITY STORED! Press V to use', '#ffd700', 2000);
                // Flash effect
                setScreenFlash({ color: '#ffd700', opacity: 0.3 });
                setTimeout(() => setScreenFlash(null), 200);
              } else {
                game.coinsCollected = COINS_FOR_IMMUNITY - 1; // Keep at max-1, can't store more
                setCoinsCollected(game.coinsCollected);
                showStatus('IMMUNITY FULL! (Max 3)', '#888', 1000);
              }
            }
          }
        }
      });
      game.coins = game.coins.filter(c => !c.collected);

      // Immunity pickup collection (direct immunity)
      // In multiplayer, this is handled by powerup events from server
      if (!isMultiplayerRef.current) {
        game.immunityPickups.forEach(pickup => {
          if (pickup.collected) return;
          const d = Math.hypot(game.player.x - pickup.x, game.player.y - pickup.y);
          if (d < 30) {
            pickup.collected = true;
            game.immunityActive = true;
            game.immunityEndTime = game.gameTime + IMMUNITY_DURATION;
            setImmunityActive(true);
            showStatus('🛡️ INSTANT IMMUNITY! 10 seconds', '#00ffff', 2000);
            // Flash effect
            setScreenFlash({ color: '#00ffff', opacity: 0.3 });
            setTimeout(() => setScreenFlash(null), 200);
          }
        });
        game.immunityPickups = game.immunityPickups.filter(p => !p.collected);

        // Sink collectible collection (single player only)
        // In multiplayer, this will be handled by sink trap events from server
        game.sinkCollectibles.forEach(sink => {
          if (sink.collected) return;
          const d = Math.hypot(game.player.x - sink.x, game.player.y - sink.y);
          if (d < 30) {
            if (game.playerSinkInventory < 3) {
              sink.collected = true;
              game.playerSinkInventory++;
              setSinkInventory(game.playerSinkInventory);
              showStatus('SINK TRAP COLLECTED! Press C to deploy', '#ff6600', 2000);
            } else {
              showStatus('INVENTORY FULL! (Max 3 traps)', '#888', 1000);
            }
          }
        });
        game.sinkCollectibles = game.sinkCollectibles.filter(s => !s.collected);
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

      // Enemy logic (single player only)
      // In multiplayer, the unicorn player is the threat instead
      if (!isMultiplayerRef.current) {
        game.enemies.forEach((enemy) => {
          // Check collision with deployed sinks
          for (let i = game.deployedSinks.length - 1; i >= 0; i--) {
            const sink = game.deployedSinks[i];
            const d = Math.hypot(enemy.x - sink.x, enemy.y - sink.y);
            if (d < 25) {
              game.deployedSinks.splice(i, 1);
              const newPos = spawnEnemyFarFrom(game.player.x, game.player.y, 1000);
              if (newPos) {
                enemy.x = newPos.x;
                enemy.y = newPos.y;
                enemy.trail = [];
                showStatus('ENEMY TRAPPED & RESPAWNED!', '#ff4400', 1500);
              }
              break;
            }
          }

          let moveX = 0, moveY = 0;

          if (enemy.flankTimer > 0) {
            enemy.flankTimer -= dt;
            moveX = enemy.flankDir.x * enemy.speed * dt;
            moveY = enemy.flankDir.y * enemy.speed * dt;
            if (enemy.flankTimer <= 0) enemy.stuckTime = 0;
          } else {
            let edx = game.player.x - enemy.x;
            let edy = game.player.y - enemy.y;
            const dist = Math.hypot(edx, edy);

            if (dist > 0) {
              moveX = (edx / dist) * enemy.speed * dt;
              moveY = (edy / dist) * enemy.speed * dt;
            }

            // Enemy collision - check immunity
            if (dist < (game.player.width / 2 + enemy.width / 2)) {
              if (!game.immunityActive) {
                handleDeath();
                return;
              } else {
                // Push enemy away when immune
                const pushDist = 50;
                const newPos = spawnEnemyFarFrom(game.player.x, game.player.y, 500);
                if (newPos) {
                  enemy.x = newPos.x;
                  enemy.y = newPos.y;
                  enemy.trail = [];
                }
              }
            }
          }

          let actualX = 0, actualY = 0;
          if (!checkCollision(enemy.x + moveX, enemy.y, enemy.width, enemy.height, false)) {
            enemy.x += moveX;
            actualX = moveX;
          }
          if (!checkCollision(enemy.x, enemy.y + moveY, enemy.width, enemy.height, false)) {
            enemy.y += moveY;
            actualY = moveY;
          }

          if (enemy.flankTimer <= 0) {
            const intended = enemy.speed * dt;
            const actual = Math.hypot(actualX, actualY);
            if (actual < intended * 0.5) {
              enemy.stuckTime += dt;
              if (enemy.stuckTime > 0.5) {
                enemy.flankTimer = 1.0;
                let edx = game.player.x - enemy.x;
                let edy = game.player.y - enemy.y;
                const dist = Math.hypot(edx, edy);
                if (dist > 0) {
                  edx /= dist;
                  edy /= dist;
                }
                if (Math.random() < 0.5) enemy.flankDir = { x: -edy, y: edx };
                else enemy.flankDir = { x: edy, y: -edx };
              }
            } else {
              enemy.stuckTime = Math.max(0, enemy.stuckTime - dt);
            }
          }

          enemy.trail.push({ x: enemy.x, y: enemy.y });
          if (enemy.trail.length > 20) enemy.trail.shift();
        });
      }

      // Camera
      const targetCamX = game.player.x - canvas.width / 2;
      const targetCamY = game.player.y - canvas.height / 2;
      game.camera.x += (targetCamX - game.camera.x) * 5 * dt;
      game.camera.y += (targetCamY - game.camera.y) * 5 * dt;

      // Enemy spawner (single player only)
      // In multiplayer, the unicorn player is the threat
      if (!isMultiplayerRef.current) {
        game.enemySpawnTimer += dt;
        if (game.enemySpawnTimer >= 30) {
          game.enemySpawnTimer = 0;
          spawnEnemy();
          spawnEnemy();
          showStatus('WARNING: ENEMY REINFORCEMENTS!', '#f00', 3000);
        }
      }
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
          if (y >= 0 && y < MAP_HEIGHT && x >= 0 && x < MAP_WIDTH) {
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
              else if (x === MAP_WIDTH - 1) offset = dy;
              else if (y === MAP_HEIGHT - 1) offset = -dx;
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

      // Boats
      game.boats.forEach((b) => {
        if (b.life <= 0) return;
        ctx.globalAlpha = b.life / b.maxLife;
        ctx.fillStyle = C_BOAT;
        ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
        ctx.fillStyle = C_BOAT_DECK;
        ctx.fillRect(b.x - b.w / 2 + 4, b.y - b.h / 2 + 4, b.w - 8, b.h - 8);
        ctx.globalAlpha = 1.0;
      });

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
          drawCoin(ctx, coin);
        }
      });

      // Draw immunity pickups
      game.immunityPickups.forEach(pickup => {
        if (!pickup.collected) {
          drawImmunityPickup(ctx, pickup);
        }
      });

      // Draw sink collectibles
      game.sinkCollectibles.forEach(sink => {
        if (!sink.collected) {
          drawSinkCollectible(ctx, sink);
        }
      });

      // Entities - Draw trails
      const isPlayerWalking = game.player.velX !== 0 || game.player.velY !== 0;

      // Player trail - changes color when immune
      ctx.lineWidth = game.player.width * 0.8;
      ctx.lineCap = 'round';
      ctx.strokeStyle = game.immunityActive ? 'rgba(0, 255, 255, 0.5)' : 'rgba(0, 255, 255, 0.2)';
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
          
          // Draw remote player with isometric Qbit
          // Use different colors for unicorn or frozen
          ctx.save();
          if (remotePlayer.isFrozen) {
            // Add blue tint for frozen players
            ctx.globalAlpha = 0.7;
          }
          drawQbitIsometric(
            ctx,
            remotePlayer.x,
            remotePlayer.y,
            remotePlayer.dirX,
            remotePlayer.dirY,
            false, // not local player
            !remotePlayer.isFrozen,  // not walking if frozen
            false, // no immunity visual
            remotePlayer.isUnicorn // pass unicorn status for special coloring
          );
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
            ctx.fillText('🦄', remotePlayer.x, remotePlayer.y - 55);
          }
          
          // Frozen indicator
          if (remotePlayer.isFrozen) {
            ctx.font = 'bold 14px Arial';
            ctx.fillStyle = '#00ffff';
            ctx.fillText('❄️ FROZEN', remotePlayer.x, remotePlayer.y - 55);
          }
          ctx.restore();
        });
      }

      // Draw player with isometric Qbit (with immunity effect)
      drawQbitIsometric(
        ctx,
        game.player.x,
        game.player.y,
        game.player.dirX,
        game.player.dirY,
        true,
        isPlayerWalking,
        game.immunityActive,
        isUnicorn // pass our unicorn status
      );
      
      // Draw "YOU" label and unicorn indicator for local player in multiplayer
      if (isMultiplayerRef.current) {
        ctx.save();
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = isUnicorn ? '#ff00ff' : '#00ffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText('YOU', game.player.x, game.player.y - 40);
        ctx.fillText('YOU', game.player.x, game.player.y - 40);
        if (isUnicorn) {
          ctx.font = 'bold 16px Arial';
          ctx.fillText('🦄', game.player.x, game.player.y - 55);
        }
        ctx.restore();
      }

      // Enemies (single player only)
      // In multiplayer, the unicorn player replaces enemies
      if (!isMultiplayerRef.current) {
        game.enemies.forEach((e) => {
          ctx.lineWidth = e.width * 0.8;
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.2)';
          ctx.beginPath();
          if (e.trail.length > 0) {
            ctx.moveTo(e.trail[0].x, e.trail[0].y);
            for (const p of e.trail) ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();

          const edx = game.player.x - e.x;
          const edy = game.player.y - e.y;
          const dist = Math.hypot(edx, edy);
          const dirX = dist > 0 ? edx / dist : 0;
          const dirY = dist > 0 ? edy / dist : 1;

          drawQbitIsometric(ctx, e.x, e.y, dirX, dirY, false, true, false, false);
        });
      }

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

      // Minimap
      minimapCtx.fillStyle = '#000';
      minimapCtx.fillRect(0, 0, 150, 150);
      const sc = 150 / game.map.width;

      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const t = game.map.tiles[y][x];
          if (t === 0) minimapCtx.fillStyle = '#444';
          else if (t === 2) minimapCtx.fillStyle = '#242';
          else if (t === 3) minimapCtx.fillStyle = '#00f';
          else if (t === 4) minimapCtx.fillStyle = '#f00';
          else continue;
          minimapCtx.fillRect(
            x * TILE_SIZE * sc,
            y * TILE_SIZE * sc,
            TILE_SIZE * sc,
            TILE_SIZE * sc
          );
        }
      }

      // Coins on minimap
      minimapCtx.fillStyle = '#ffd700';
      game.coins.forEach((c) => {
        if (!c.collected) {
          minimapCtx.beginPath();
          minimapCtx.arc((c.x * sc) / TILE_SIZE, (c.y * sc) / TILE_SIZE, 2, 0, Math.PI * 2);
          minimapCtx.fill();
        }
      });

      // Immunity pickups on minimap
      minimapCtx.fillStyle = '#00ffff';
      game.immunityPickups.forEach((p) => {
        if (!p.collected) {
          minimapCtx.beginPath();
          minimapCtx.arc((p.x * sc) / TILE_SIZE, (p.y * sc) / TILE_SIZE, 3, 0, Math.PI * 2);
          minimapCtx.fill();
        }
      });

      // Sink collectibles on minimap
      minimapCtx.fillStyle = '#ff6600';
      game.sinkCollectibles.forEach((s) => {
        if (!s.collected) {
          minimapCtx.beginPath();
          minimapCtx.arc((s.x * sc) / TILE_SIZE, (s.y * sc) / TILE_SIZE, 3, 0, Math.PI * 2);
          minimapCtx.fill();
        }
      });

      // Deployed sinks on minimap
      minimapCtx.fillStyle = '#ff0000';
      game.deployedSinks.forEach((s) => {
        minimapCtx.beginPath();
        minimapCtx.arc((s.x * sc) / TILE_SIZE, (s.y * sc) / TILE_SIZE, 4, 0, Math.PI * 2);
        minimapCtx.fill();
      });

      game.boats.forEach((b) => {
        if (b.life <= 0) return;
        minimapCtx.fillStyle = '#8B4513';
        minimapCtx.fillRect((b.x * sc) / TILE_SIZE - 2, (b.y * sc) / TILE_SIZE - 2, 4, 4);
      });

      game.map.portals.forEach((p) => {
        minimapCtx.fillStyle = '#fff';
        minimapCtx.beginPath();
        minimapCtx.arc((p.x * sc) / TILE_SIZE, (p.y * sc) / TILE_SIZE, 3, 0, Math.PI * 2);
        minimapCtx.fill();
      });

      // Remote players on minimap (multiplayer mode)
      if (isMultiplayerRef.current) {
        remotePlayersRef.current.forEach((remotePlayer) => {
          if (remotePlayer.isEliminated) return;
          // Color based on state: unicorn=purple, frozen=cyan, normal=blue
          minimapCtx.fillStyle = remotePlayer.isUnicorn 
            ? '#ff00ff' 
            : remotePlayer.isFrozen 
              ? '#00ffff' 
              : '#4488ff';
          minimapCtx.beginPath();
          minimapCtx.arc(
            (remotePlayer.x * sc) / TILE_SIZE,
            (remotePlayer.y * sc) / TILE_SIZE,
            remotePlayer.isUnicorn ? 4 : 3,
            0,
            Math.PI * 2
          );
          minimapCtx.fill();
        });
      }

      // Local player on minimap
      minimapCtx.fillStyle = isUnicorn ? '#ff00ff' : '#0ff';
      minimapCtx.fillRect(
        (game.player.x * sc) / TILE_SIZE - 2,
        (game.player.y * sc) / TILE_SIZE - 2,
        4,
        4
      );
      
      // Enemies on minimap (single player mode only)
      if (!isMultiplayerRef.current) {
        minimapCtx.fillStyle = '#f00';
        game.enemies.forEach((e) =>
          minimapCtx.fillRect((e.x * sc) / TILE_SIZE - 2, (e.y * sc) / TILE_SIZE - 2, 4, 4)
        );
      }
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
        trySpawnPortal();
      }
      if (e.code === 'KeyC' && game.isPlaying) {
        deploySink();
      }
      if (e.code === 'KeyV' && game.isPlaying) {
        activateImmunity();
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

  const handleRestart = () => {
    if (gameRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const game = gameRef.current;
      game.keys = {};
      game.map.tiles = [];
      game.map.buildings = [];
      game.map.trees = [];
      game.map.portals = [];
      game.coins = [];
      game.immunityPickups = [];
      game.sinkCollectibles = [];
      game.deployedSinks = [];
      game.coinSpawnTimer = 0;
      game.immunityPickupSpawnTimer = 0;
      game.sinkSpawnTimer = 0;
      game.speedBoostApplied = false;
      game.immunityActive = false;
      game.immunityEndTime = 0;
      game.coinsCollected = 0;
      game.immunityInventory = 0;
      game.playerSinkInventory = 0;
      game.gameTime = 0;
      game.player.speed = BASE_PLAYER_SPEED;
      setSinkInventory(0);
      setCoinsCollected(0);
      setImmunityInventory(0);
      setImmunityActive(false);
      setImmunityTimeLeft(0);

      for (let y = 0; y < MAP_HEIGHT; y++) {
        const row: number[] = [];
        for (let x = 0; x < MAP_WIDTH; x++) row.push(1);
        game.map.tiles.push(row);
      }

      const blockSize = 4;
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const isRoadRow = y % blockSize === 0;
          const isRoadCol = x % blockSize === 0;
          if (isRoadRow || isRoadCol) game.map.tiles[y][x] = 0;
          else {
            const rand = Math.random();
            if (rand < 0.05) {
              for (let ly = y - 1; ly <= y + 1; ly++) {
                for (let lx = x - 1; lx <= x + 1; lx++) {
                  if (ly >= 0 && ly < MAP_HEIGHT && lx >= 0 && lx < MAP_WIDTH) {
                    if (game.map.tiles[ly][lx] !== 0) game.map.tiles[ly][lx] = 3;
                  }
                }
              }
            } else if (rand < 0.15) game.map.tiles[y][x] = 2;
          }
        }
      }

      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
            game.map.tiles[y][x] = 4;
            continue;
          }
          const tile = game.map.tiles[y][x];
          const px = x * TILE_SIZE, py = y * TILE_SIZE;
          if (tile === 1) {
            const rand = Math.random();
            let type = TYPE_RESIDENTIAL, height = 40 + Math.random() * 60, color = '#252525', wallColor = '#151515';
            if (rand > 0.9) { type = TYPE_SHOP; height = 30 + Math.random() * 20; color = '#331133'; wallColor = '#220022'; }
            else if (rand > 0.8) { type = TYPE_CAFE; height = 25 + Math.random() * 15; color = '#2e3b2e'; wallColor = '#1a221a'; }
            game.map.buildings.push({ gridX: x, gridY: y, x: px, y: py, w: TILE_SIZE, h: TILE_SIZE, height, color, wallColor, type });
          } else if (tile === 2 && Math.random() > 0.3) {
            game.map.trees.push({ x: px + TILE_SIZE / 2 + (Math.random() * 20 - 10), y: py + TILE_SIZE / 2 + (Math.random() * 20 - 10), r: 10 + Math.random() * 10 });
          }
        }
      }

      let portalsCreated = 0;
      while (portalsCreated < 4) {
        const px = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
        const py = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
        if (game.map.tiles[py][px] === 0) {
          game.map.portals.push({ x: px * TILE_SIZE + TILE_SIZE / 2, y: py * TILE_SIZE + TILE_SIZE / 2, color: `hsl(${portalsCreated * 90}, 100%, 50%)`, angle: 0 });
          portalsCreated++;
        }
      }

      game.boats = [];
      const perimeter = (MAP_WIDTH * 2 + MAP_HEIGHT * 2) * TILE_SIZE;
      const boatCount = 10;
      const spacing = perimeter / boatCount;
      for (let i = 0; i < boatCount; i++) game.boats.push({ dist: i * spacing, x: 0, y: 0, w: 48, h: 48, velX: 0, velY: 0, life: 10.0, maxLife: 10.0 });

      let spawnFound = false;
      while (!spawnFound) {
        const x = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
        const y = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
        if (game.map.tiles[y][x] === 0) {
          game.player.x = x * TILE_SIZE + TILE_SIZE / 2;
          game.player.y = y * TILE_SIZE + TILE_SIZE / 2;
          spawnFound = true;
        }
      }

      game.player.trail = [];
      game.player.portalCooldown = 0;
      game.player.dirX = 0;
      game.player.dirY = 1;

      game.enemies = [];
      game.enemySpawnTimer = 0;
      for (let i = 0; i < 3; i++) {
        let ex = 0, ey = 0, valid = false, attempts = 0;
        while (!valid && attempts < 100) {
          attempts++;
          const rx = Math.floor(Math.random() * (MAP_WIDTH - 2)) + 1;
          const ry = Math.floor(Math.random() * (MAP_HEIGHT - 2)) + 1;
          if (game.map.tiles[ry][rx] === 0) {
            const candidateX = rx * TILE_SIZE + TILE_SIZE / 2;
            const candidateY = ry * TILE_SIZE + TILE_SIZE / 2;
            const d = Math.hypot(candidateX - game.player.x, candidateY - game.player.y);
            if (d > 800) { ex = candidateX; ey = candidateY; valid = true; }
          }
        }
        if (valid) game.enemies.push({ x: ex, y: ey, width: 24, height: 24, speed: BASE_ENEMY_SPEED + Math.random() * 30, trail: [], stuckTime: 0, flankTimer: 0, flankDir: { x: 0, y: 0 } });
      }

      game.camera.x = game.player.x - canvas.width / 2;
      game.camera.y = game.player.y - canvas.height / 2;
      
      game.isPlaying = true;
    }
  };

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

      {/* Blitz Quiz Overlay (Multiplayer) */}
      {gameState === 'blitz-quiz' && blitzQuestion && (
        <BlitzQuiz
          question={blitzQuestion.question}
          options={blitzQuestion.options}
          timeLeft={blitzTimeLeft}
          onAnswer={(index) => socketService.submitBlitzAnswer(index)}
        />
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
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-slate-800 border-2 border-cyan-500 rounded-xl p-8 max-w-lg w-full mx-4 shadow-2xl shadow-cyan-500/20">
            <h2 className="text-2xl font-bold text-cyan-400 text-center mb-6 animate-pulse">
              YOU'VE BEEN FROZEN!
            </h2>
            <p className="text-white text-center text-lg mb-4">Loading quiz questions...</p>
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-400"></div>
            </div>
            <p className="text-cyan-300 text-center text-sm mt-4">
              Answer correctly to unfreeze!
            </p>
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

      {/* Multiplayer HUD (when playing) */}
      {isMultiplayer && gameState === 'playing' && (
        <div className="absolute top-5 right-40 z-30 text-white pointer-events-none">
          {/* Role indicator */}
          <div className={`mb-2 px-4 py-2 rounded-lg ${
            isUnicorn 
              ? 'bg-purple-600/80 border border-purple-400' 
              : 'bg-blue-600/80 border border-blue-400'
          }`}>
            <p className="font-bold text-sm">
              {isUnicorn ? '🦄 UNICORN - Catch them!' : '🏃 SURVIVOR - Run!'}
            </p>
          </div>
          
          {/* Round indicator */}
          <div className="bg-slate-800/80 rounded-lg px-4 py-2 mb-2">
            <p className="text-sm text-slate-300">
              Round <span className="text-yellow-400 font-bold">{currentRound}</span> / {totalRounds}
            </p>
          </div>

          {/* Hunt timer */}
          {huntTimeLeft > 0 && (
            <div className="bg-slate-800/80 rounded-lg px-4 py-2">
              <p className="text-sm text-slate-300">
                Hunt: <span className="text-cyan-400 font-mono">{Math.ceil(huntTimeLeft)}s</span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Waiting for start screen (Multiplayer) */}
      {gameState === 'waiting-for-start' && room && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 max-w-md w-full mx-4 text-center">
            <h2 className="text-3xl font-bold text-cyan-400 mb-4">Waiting for Game</h2>
            <p className="text-slate-400 mb-6">
              Room: <span className="text-white font-mono">{room.code}</span>
            </p>
            <p className="text-slate-400">
              {room.players.length} player{room.players.length !== 1 ? 's' : ''} connected
            </p>
            <div className="mt-6 flex justify-center gap-2">
              {room.players.map((p, i) => (
                <div
                  key={p.id}
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold"
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
            <p className="mt-6 text-slate-500 text-sm animate-pulse">
              Waiting for host to start...
            </p>
          </div>
        </div>
      )}

      {/* Name Entry Screen */}
      {gameState === 'name-entry' && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-card p-8 rounded-xl border border-border max-w-md w-full mx-4">
            <h2 className="text-4xl font-bold text-cyan-400 mb-2 text-center tracking-wider">
              QBIT CITY
            </h2>
            <p className="text-muted-foreground text-center mb-6">Survive as long as you can!</p>
            
            <input
              type="text"
              placeholder="Enter your name..."
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value.slice(0, 15))}
              onKeyDown={(e) => e.key === 'Enter' && startGame()}
              className="w-full px-4 py-3 bg-background border border-border rounded-lg 
                         text-foreground text-lg mb-4 focus:outline-none focus:ring-2 
                         focus:ring-cyan-400"
              autoFocus
            />
            
            <button
              onClick={startGame}
              disabled={!playerName.trim()}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 
                         text-white font-bold rounded-lg disabled:opacity-50 
                         disabled:cursor-not-allowed hover:from-cyan-400 hover:to-blue-500
                         transition-all"
            >
              Start Game
            </button>
            
            <button
              onClick={() => setShowLeaderboard(true)}
              className="w-full py-2 mt-3 text-amber-400 hover:text-amber-300 
                         flex items-center justify-center gap-2 transition-colors"
            >
              <Trophy size={18} />
              View Leaderboard
            </button>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'game-over' && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-card p-8 rounded-xl border border-border max-w-md w-full mx-4 text-center">
            <h2 className="text-3xl font-bold text-red-500 mb-4">GAME OVER</h2>
            
            <p className="text-xl text-foreground mb-2">{playerName}</p>
            
            <div className="my-6">
              <div className="bg-background p-4 rounded-lg">
                <p className="text-muted-foreground text-sm">
                  {isMultiplayer ? 'Final Score' : 'Time Survived'}
                </p>
                <p className="text-3xl font-mono text-cyan-400">
                  {isMultiplayer ? `${coinsCollected} coins` : formatTime(finalStats.time)}
                </p>
              </div>
            </div>
            
            <div className="flex gap-3">
              {isMultiplayer ? (
                // Multiplayer: Return to Lobby
                <Link
                  to="/lobby"
                  className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 
                             text-white font-bold rounded-lg hover:from-cyan-400 hover:to-blue-500
                             transition-all text-center"
                >
                  Return to Lobby
                </Link>
              ) : (
                // Single player: Play Again
                <button
                  onClick={handlePlayAgain}
                  className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 
                             text-white font-bold rounded-lg hover:from-cyan-400 hover:to-blue-500
                             transition-all"
                >
                  Play Again
                </button>
              )}
              {!isMultiplayer && (
                <button
                  onClick={() => setShowLeaderboard(true)}
                  className="px-4 py-3 bg-amber-500/20 border border-amber-400 
                             text-amber-400 font-bold rounded-lg hover:bg-amber-500/30
                             transition-all"
                >
                  <Trophy size={20} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Popup */}
      {showLeaderboard && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-xl border border-border max-w-lg w-full mx-4 max-h-[80vh]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-amber-400 flex items-center gap-2">
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
                        <td className="py-2 text-right text-cyan-400">{formatTime(entry.timeSurvived)}</td>
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
            <h1 className="m-0 text-2xl text-cyan-400 uppercase tracking-widest font-bold drop-shadow-lg">
              Qbit City
            </h1>
            <button
              onClick={() => setShowLeaderboard(true)}
              className="pointer-events-auto p-2 text-amber-400 hover:text-amber-300 transition-colors"
            >
              <Trophy size={24} />
            </button>
          </div>
          
          {/* Timer */}
          <div className="flex items-center gap-4 mt-2 text-lg">
            <span className="text-cyan-400 font-mono text-xl">
              ⏱ {formatTime(gameTime)}
            </span>
          </div>

          {/* Immunity Indicator */}
          {immunityActive && (
            <div className="mt-2 bg-cyan-500/20 border border-cyan-400 rounded-lg px-3 py-2 animate-pulse">
              <span className="text-cyan-400 font-bold flex items-center gap-2">
                <Shield size={18} /> IMMUNE! {immunityTimeLeft.toFixed(1)}s
              </span>
            </div>
          )}

          {/* Coin Counter */}
          <div className="mt-3 flex items-center gap-2">
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
          </div>

          {/* Immunity Inventory */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Stored Immunity:</span>
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className={`w-6 h-6 rounded border-2 flex items-center justify-center
                    ${i < immunityInventory 
                      ? 'bg-cyan-500/30 border-cyan-400 text-cyan-400' 
                      : 'bg-muted/20 border-muted-foreground/30 text-muted-foreground/30'
                    }`}
                >
                  <Shield size={12} />
                </div>
              ))}
            </div>
            {immunityInventory > 0 && (
              <span className="text-cyan-400 text-xs">(Press V)</span>
            )}
          </div>

          {/* Energy Bar */}
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-muted-foreground text-sm">Portal Energy:</span>
              <span className={`text-xs ${energy >= 1 ? 'text-fuchsia-400' : 'text-muted-foreground'}`}>
                {energy >= 1 ? 'READY!' : `${Math.floor(energy * 100)}%`}
              </span>
            </div>
            <div className="h-3 bg-muted/30 rounded-full overflow-hidden border border-muted-foreground/30">
              <div 
                className={`h-full transition-all duration-100 ${
                  energy >= 1 ? 'bg-fuchsia-500 animate-pulse' : 'bg-fuchsia-500/60'
                }`}
                style={{ width: `${energy * 100}%` }}
              />
            </div>
          </div>

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
              <span className="text-orange-400 text-xs">(Press C)</span>
            )}
          </div>
          
          <div className="mt-3 space-y-1">
            <p className="text-sm text-muted-foreground">WASD / Arrows to Move</p>
            <p className="text-sm text-muted-foreground">
              <span className="text-fuchsia-500">SPACE</span>: Create Portal
            </p>
            <p className="text-sm text-muted-foreground">
              <span className="text-orange-400">C</span>: Deploy Sink Trap
            </p>
            <p className="text-sm text-muted-foreground">
              <span className="text-cyan-400">V</span>: Use Stored Immunity
            </p>
            <p className="text-sm text-muted-foreground">
              Ride <span className="text-amber-700">Boats</span> (They sink in 10s!)
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

      {/* Minimap - Always render but hide when not playing */}
      <canvas
        ref={minimapRef}
        width={150}
        height={150}
        className={`absolute top-5 right-5 border-2 border-border bg-black/80 rounded ${
          gameState !== 'playing' ? 'hidden' : ''
        }`}
      />

      {/* Back Button */}
      <Link
        to="/"
        className="absolute bottom-5 left-5 flex items-center gap-2 px-4 py-2 bg-secondary/90 hover:bg-secondary text-secondary-foreground rounded-lg transition-all pointer-events-auto"
      >
        <ArrowLeft size={18} />
        <span>Back to Animator</span>
      </Link>

      {/* Restart Button - Only show when playing */}
      {gameState === 'playing' && (
        <button
          onClick={handleRestart}
          className="absolute bottom-5 right-5 flex items-center gap-2 px-4 py-2 bg-secondary/90 hover:bg-secondary text-secondary-foreground rounded-lg transition-all pointer-events-auto"
        >
          <RefreshCw size={18} />
          <span>Restart</span>
        </button>
      )}
    </div>
  );
};

export default Game;
