/**
 * Socket Context for React
 * Provides socket connection and game state to all components
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import socketService from '../services/socket';
import soundManager from '../services/PhaserSoundManager';

const SocketContext = createContext(null);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

// Game phase constants (matching backend)
export const GAME_PHASE = {
  WAITING: 'waiting',
  BLITZ_QUIZ: 'blitz_quiz',
  HUNT: 'hunt',
  ROUND_END: 'round_end'
};

// Player state constants (matching backend)
export const PLAYER_STATE = {
  ACTIVE: 'active',
  FROZEN: 'frozen',
  IMMUNE: 'immune',
  IN_IFRAMES: 'in_iframes'
};

// Combat config constants (matching backend)
export const COMBAT_CONFIG = {
  MAX_HEALTH: 100,
  IFRAME_DURATION: 3000,
  FREEZE_DURATION: 5000
};

export const SocketProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomData, setRoomData] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [players, setPlayers] = useState([]);
  const [unicornId, setUnicornId] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  
  // Quiz state (original collision quiz)
  const [isGameFrozen, setIsGameFrozen] = useState(false);
  const [freezeMessage, setFreezeMessage] = useState(null);
  const [quizActive, setQuizActive] = useState(false);
  const [quizData, setQuizData] = useState(null);
  const [quizResults, setQuizResults] = useState(null);

  // Game Loop state (new Blitz Quiz + Hunt system)
  const [gamePhase, setGamePhase] = useState(GAME_PHASE.WAITING);
  const [blitzQuizActive, setBlitzQuizActive] = useState(false);
  const [blitzQuizData, setBlitzQuizData] = useState(null);
  const [blitzQuizResults, setBlitzQuizResults] = useState(null);
  const [huntData, setHuntData] = useState(null);
  const [huntTimeRemaining, setHuntTimeRemaining] = useState(0);
  const [reserveUnicornId, setReserveUnicornId] = useState(null);
  const [tagNotification, setTagNotification] = useState(null);

  // Combat System state
  const [playersHealth, setPlayersHealth] = useState({}); // { playerId: { health, maxHealth, state, inIFrames } }
  const [hitNotification, setHitNotification] = useState(null); // { attackerName, victimName, damage }
  const [myPlayerState, setMyPlayerState] = useState(PLAYER_STATE.ACTIVE);
  const [myHealth, setMyHealth] = useState(COMBAT_CONFIG.MAX_HEALTH);
  const [inIFrames, setInIFrames] = useState(false);

  // Coin & Powerup state
  const [coins, setCoins] = useState([]); // [{ id, row, col }]
  const [powerups, setPowerups] = useState([]); // [{ id, row, col, type }]
  const [coinCollectNotification, setCoinCollectNotification] = useState(null);
  const [powerupCollectNotification, setPowerupCollectNotification] = useState(null);
  const [isImmune, setIsImmune] = useState(false);
  const [immunePlayers, setImmunePlayers] = useState(new Set()); // Set of player IDs with immunity

  // Knockback state
  const [knockbackActive, setKnockbackActive] = useState(false); // Is local player being knocked back
  const [knockbackPlayers, setKnockbackPlayers] = useState(new Set()); // Set of player IDs being knocked back

  useEffect(() => {
    // Connect to socket server (will reuse existing connection if available)
    const socketInstance = socketService.connect();
    setSocket(socketInstance);

    // Handle connection events
    socketInstance.on('connect', () => {
      console.log('Connected to server');
      setConnected(true);
    });

    socketInstance.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnected(false);
    });

    // Room events
    socketService.onRoomUpdate((data) => {
      console.log('Room updated:', data);
      setRoomData(data.room);
      if (data.room && data.room.players) {
        setPlayers(data.room.players);
      }
    });

    socketService.onPlayerJoined((data) => {
      console.log('Player joined:', data.player);
      setRoomData(data.room);
      if (data.room && data.room.players) {
        setPlayers(data.room.players);
      }
    });

    socketService.onPlayerLeft((data) => {
      console.log('Player left:', data.playerId);
      setRoomData(data.room);
      if (data.room && data.room.players) {
        setPlayers(data.room.players);
      }
    });

    socketService.onGameStarted((data) => {
      console.log('Game started:', data);
      setRoomData(data.room);
      setGameState(data.gameState);
      
      // Play game start sound
      soundManager.playGameStart();
      
      // Set initial unicorn
      if (data.room && data.room.unicornId) {
        setUnicornId(data.room.unicornId);
      }
      
      // Set initial leaderboard
      if (data.gameState && data.gameState.leaderboard) {
        setLeaderboard(data.gameState.leaderboard);
      }
      
      // Navigate to game screen
      if (location.pathname !== '/startgame') {
        navigate('/startgame');
      }
    });

    socketService.onHostTransferred((data) => {
      console.log('Host transferred:', data);
      setRoomData(data.room);
    });

    socketService.onUnicornTransferred((data) => {
      console.log('Unicorn transferred:', data);
      setUnicornId(data.newUnicornId);
      setRoomData(data.room);
      if (data.room && data.room.players) {
        setPlayers(data.room.players);
      }
    });

    socketService.onScoreUpdate((data) => {
      console.log('Score updated:', data);
      // Update room data with new player scores
      if (data.room) {
        setRoomData(data.room);
        setPlayers(data.room.players);
      }
      // Update leaderboard
      if (data.leaderboard) {
        setLeaderboard(data.leaderboard);
      }
    });

    // Quiz Events
    socketService.onGameFrozen((data) => {
      console.log('🥶 ===== GAME FROZEN =====');
      console.log('Freeze data:', data);
      console.log('Message:', data.message);
      console.log('Reason:', data.freezeReason);
      console.log('=========================');
      
      // Play freeze sound
      soundManager.playFreeze();
      
      setIsGameFrozen(true);
      setFreezeMessage({
        text: data.message,
        unicornName: data.unicornName,
        caughtName: data.caughtName,
        reason: data.freezeReason
      });
    });

    socketService.onQuizStart((data) => {
      console.log('Quiz started:', data);
      setQuizActive(true);
      setQuizData({
        questions: data.questions,
        totalTimeLimit: data.totalTimeLimit,
        timePerQuestion: data.timePerQuestion,
        unicornName: data.unicornName,
        currentQuestion: 0,
        answers: []
      });
    });

    socketService.onQuizAnswerResult((data) => {
      console.log('Quiz answer result:', data);
      
      // Play correct/wrong sound based on result
      if (data.correct) {
        soundManager.playQuizCorrect();
      } else {
        soundManager.playQuizWrong();
      }
      
      // Update quiz data with answer result
      setQuizData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          answers: [...prev.answers, data]
        };
      });
    });

    socketService.onQuizComplete((data) => {
      console.log('🏁 ===== QUIZ COMPLETE =====');
      console.log('Results:', data);
      console.log('Score:', data.correctAnswers, '/', data.totalQuestions, '(', data.scorePercentage, '%)');
      console.log('===========================');
      
      setQuizResults(data);
      setQuizActive(false);
      
      // Show results for 5 seconds, then unfreeze game
      setTimeout(() => {
        console.log('🔓 Game unfrozen on frontend');
        setIsGameFrozen(false);
        setFreezeMessage(null);
        setQuizResults(null);
        setQuizData(null);
      }, 5000);
    });

    // ========== GAME LOOP EVENTS ==========

    // Phase Change
    socketService.onPhaseChange((data) => {
      console.log('🔄 ===== PHASE CHANGE =====');
      console.log(`${data.previousPhase} → ${data.phase}`);
      console.log('===========================');
      setGamePhase(data.phase);
    });

    // Blitz Quiz Start - received by ALL players
    socketService.onBlitzStart((data) => {
      console.log('⚡ ===== BLITZ QUIZ START =====');
      console.log('Question:', data.question?.question);
      console.log('Time Limit:', data.timeLimit);
      console.log('Players:', data.playerCount);
      console.log('==============================');
      
      // Play blitz quiz start sound
      soundManager.playBlitzStart();
      
      setBlitzQuizActive(true);
      setBlitzQuizResults(null);
      setBlitzQuizData({
        question: data.question,
        timeLimit: data.timeLimit,
        playerCount: data.playerCount,
        timestamp: data.timestamp
      });
      setIsGameFrozen(true); // Freeze movement during Blitz Quiz
    });

    // Blitz Quiz End - results for all players
    socketService.onBlitzResult((data) => {
      console.log('⚡ ===== BLITZ QUIZ END =====');
      console.log('New Unicorn:', data.newUnicornName);
      console.log('Reserve:', data.reserveUnicornName);
      console.log('Correct:', data.correctCount, '/', data.totalPlayers);
      console.log('============================');
      
      setBlitzQuizActive(false);
      setBlitzQuizData(null);
      setBlitzQuizResults(data);
      setUnicornId(data.newUnicornId);
      setReserveUnicornId(data.reserveUnicornId);
      
      // Results will be cleared when Hunt phase starts
    });

    // Hunt Start
    socketService.onHuntStart((data) => {
      console.log('🏃 ===== HUNT START =====');
      console.log('Duration:', data.duration);
      console.log('Unicorn:', data.unicornName);
      console.log('Reserve:', data.reserveUnicornName);
      console.log('========================');
      
      // Play hunt start sound
      soundManager.playHuntStart();
      
      setIsGameFrozen(false); // Unfreeze for Hunt phase
      setBlitzQuizResults(null); // Clear quiz results
      setHuntData({
        duration: data.duration,
        endTime: data.endTime,
        unicornId: data.unicornId,
        unicornName: data.unicornName,
        reserveUnicornId: data.reserveUnicornId,
        reserveUnicornName: data.reserveUnicornName
      });
      setHuntTimeRemaining(data.duration);

      // Initialize player health for the round
      if (data.playersHealth) {
        const healthMap = {};
        data.playersHealth.forEach(ph => {
          healthMap[ph.playerId] = {
            health: ph.health,
            maxHealth: ph.maxHealth,
            state: ph.state,
            inIFrames: false
          };
        });
        setPlayersHealth(healthMap);
        
        // Set my health
        const myId = socketService.getSocket()?.id;
        const myHealthData = data.playersHealth.find(ph => ph.playerId === myId);
        if (myHealthData) {
          setMyHealth(myHealthData.health);
          setMyPlayerState(myHealthData.state);
        }
      }
      
      // Reset i-frames state
      setInIFrames(false);
    });

    // Hunt Timer Update
    socketService.onHuntEnd((data) => {
      // Play timer warning at 10, 5, 3, 2, 1 seconds
      const seconds = Math.floor(data.remainingTime / 1000);
      if ([10, 5, 3, 2, 1].includes(seconds)) {
        soundManager.playTimerWarning();
      }
      setHuntTimeRemaining(data.remainingTime);
    });

    // Player Tagged
    socketService.onPlayerTagged((data) => {
      console.log('🏷️ ===== PLAYER TAGGED =====');
      console.log(`${data.unicornName} tagged ${data.survivorName}!`);
      console.log(`Points transferred: ${data.pointsTransferred}`);
      console.log('============================');
      
      // Play tag sound
      soundManager.playTag();
      
      // Show tag notification
      setTagNotification({
        unicornName: data.unicornName,
        survivorName: data.survivorName,
        points: data.pointsTransferred
      });
      
      // Update leaderboard
      if (data.leaderboard) {
        setLeaderboard(data.leaderboard);
      }
      
      // Clear notification after 2 seconds
      setTimeout(() => {
        setTagNotification(null);
      }, 2000);
    });

    // Reserve Activated
    socketService.onReserveActivated((data) => {
      console.log('🦄 ===== RESERVE ACTIVATED =====');
      console.log('New Unicorn:', data.newUnicornName);
      console.log('================================');
      
      setUnicornId(data.newUnicornId);
      setReserveUnicornId(null);
    });

    // ========== COMBAT SYSTEM EVENTS ==========

    // Player Hit - damage dealt to a player
    socketService.onPlayerHit((data) => {
      console.log('💥 ===== PLAYER HIT =====');
      console.log(`${data.attackerName} hit ${data.victimName} for ${data.damage} damage`);
      console.log(`New health: ${data.newHealth}/${data.maxHealth}`);
      console.log('========================');

      // Play hit sound
      soundManager.playPlayerHit();

      const myId = socketService.getSocket()?.id;
      
      // Update player health
      setPlayersHealth(prev => ({
        ...prev,
        [data.victimId]: {
          health: data.newHealth,
          maxHealth: data.maxHealth,
          inIFrames: true // Player just got hit, now in i-frames
        }
      }));

      // If I was hit, update my state
      if (data.victimId === myId) {
        setMyHealth(data.newHealth);
        setInIFrames(true);
        
        // Clear i-frames after duration
        setTimeout(() => {
          setInIFrames(false);
          setPlayersHealth(prev => ({
            ...prev,
            [data.victimId]: {
              ...prev[data.victimId],
              inIFrames: false
            }
          }));
        }, data.iframeDuration || COMBAT_CONFIG.IFRAME_DURATION);
      }

      // Show hit notification
      setHitNotification({
        attackerName: data.attackerName,
        victimName: data.victimName,
        damage: data.damage,
        victimId: data.victimId
      });

      // Clear notification after 1.5 seconds
      setTimeout(() => {
        setHitNotification(null);
      }, 1500);

      // Handle knockback animation
      if (data.knockback) {
        // Track knockback for this player
        setKnockbackPlayers(prev => {
          const newSet = new Set(prev);
          newSet.add(data.victimId);
          return newSet;
        });

        // If I was knocked back
        if (data.victimId === myId) {
          setKnockbackActive(true);
        }

        // Clear knockback after animation duration (300ms)
        setTimeout(() => {
          setKnockbackPlayers(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.victimId);
            return newSet;
          });

          if (data.victimId === myId) {
            setKnockbackActive(false);
          }
        }, 300);
      }
    });

    // Player Respawn - player respawned after freeze
    socketService.onPlayerRespawn((data) => {
      console.log('🔄 ===== PLAYER RESPAWN =====');
      console.log(`${data.playerName} respawned with ${data.health}/${data.maxHealth} HP`);
      console.log('=============================');

      const myId = socketService.getSocket()?.id;

      // Update player health and state
      setPlayersHealth(prev => ({
        ...prev,
        [data.playerId]: {
          health: data.health,
          maxHealth: data.maxHealth,
          state: data.state,
          inIFrames: true // Respawned players get i-frames
        }
      }));

      // If I respawned, update my state
      if (data.playerId === myId) {
        setMyHealth(data.health);
        setMyPlayerState(data.state);
        setInIFrames(true);
        
        // Clear i-frames after duration
        setTimeout(() => {
          setInIFrames(false);
        }, COMBAT_CONFIG.IFRAME_DURATION);
      }
    });

    // Player State Change - frozen, active, etc.
    socketService.onPlayerStateChange((data) => {
      console.log('🔄 Player state change:', data.playerId, '→', data.state);

      const myId = socketService.getSocket()?.id;

      // Play freeze sound if player became frozen
      if (data.state === 'frozen' && data.playerId === myId) {
        soundManager.playFreeze();
      }

      // Update player state
      setPlayersHealth(prev => ({
        ...prev,
        [data.playerId]: {
          ...prev[data.playerId],
          state: data.state,
          inIFrames: data.inIFrames || false
        }
      }));

      // If my state changed
      if (data.playerId === myId) {
        setMyPlayerState(data.state);
        if (data.inIFrames !== undefined) {
          setInIFrames(data.inIFrames);
        }
      }
    });

    // Health Update - health changed for a player
    socketService.onHealthUpdate((data) => {
      const myId = socketService.getSocket()?.id;

      // Update player health
      setPlayersHealth(prev => ({
        ...prev,
        [data.playerId]: {
          ...prev[data.playerId],
          health: data.health,
          maxHealth: data.maxHealth
        }
      }));

      // If my health changed
      if (data.playerId === myId) {
        setMyHealth(data.health);
      }
    });

    // ========== COIN EVENTS ==========

    // Coin spawned (handles both initial spawn and respawns)
    socketService.onCoinSpawned((data) => {
      // Check if this is initial batch spawn (has coins array) or single coin spawn
      if (data.coins) {
        console.log('💰 ===== COINS SPAWNED =====');
        console.log(`Coins: ${data.coins.length}`);
        console.log('============================');
        setCoins(data.coins);
      } else if (data.coinId || data.id) {
        // Single coin spawn (respawn or new spawn)
        const coinId = data.coinId || data.id;
        console.log(`💰 Coin spawned at (${data.row}, ${data.col})`);
        setCoins(prev => {
          // Check if coin already exists
          const exists = prev.some(c => c.id === coinId);
          if (exists) return prev;
          return [...prev, {
            id: coinId,
            row: data.row,
            col: data.col
          }];
        });
      }
    });

    // Coin collected by a player
    socketService.onCoinCollected((data) => {
      console.log(`💰 ${data.playerName} collected coin! +${data.value}`);
      
      const myId = socketService.getSocket()?.id;
      
      // Find the coin position before removing it (for particle effects)
      setCoins(prev => {
        const collectedCoin = prev.find(coin => coin.id === data.coinId);
        
        // Show notification and play sound if I collected it
        if (data.playerId === myId) {
          // Play coin collect sound
          soundManager.playCoinCollect();
          
          setCoinCollectNotification({
            value: data.value,
            newScore: data.newScore,
            // Include coin position for particle effects
            row: collectedCoin?.row ?? data.row,
            col: collectedCoin?.col ?? data.col,
            coinId: data.coinId
          });
          
          // Clear notification after 1 second
          setTimeout(() => {
            setCoinCollectNotification(null);
          }, 1000);
        }
        
        // Remove collected coin from state
        return prev.filter(coin => coin.id !== data.coinId);
      });
      
      // Update leaderboard
      if (data.leaderboard) {
        setLeaderboard(data.leaderboard);
      }
    });

    // ========== POWERUP EVENTS ==========

    // Powerup spawned on map
    socketService.onPowerupSpawned((data) => {
      console.log(`⚡ Powerup spawned at (${data.row}, ${data.col})`);
      
      setPowerups(prev => [...prev, {
        id: data.id,
        row: data.row,
        col: data.col,
        type: data.type
      }]);
    });

    // Powerup collected by a player
    socketService.onPowerupCollected((data) => {
      console.log(`⚡ ${data.playerName} collected ${data.type} powerup!`);
      
      const myId = socketService.getSocket()?.id;
      
      // Find powerup position before removing (for particle effects)
      setPowerups(prev => {
        const collectedPowerup = prev.find(p => p.id === data.powerupId);
        
        // Play powerup pickup sound and show notification if I collected it
        if (data.playerId === myId) {
          soundManager.playPowerupPickup();
          
          setPowerupCollectNotification({
            type: data.type,
            row: collectedPowerup?.row ?? data.row,
            col: collectedPowerup?.col ?? data.col,
            powerupId: data.powerupId
          });
          
          // Clear notification after 500ms
          setTimeout(() => {
            setPowerupCollectNotification(null);
          }, 500);
        }
        
        // Remove collected powerup from state
        return prev.filter(p => p.id !== data.powerupId);
      });
    });

    // Powerup activated - player is now immune
    socketService.onPowerupActivated((data) => {
      console.log(`🛡️ ${data.playerName} activated ${data.type}!`);
      
      const myId = socketService.getSocket()?.id;
      
      // Track immune player
      setImmunePlayers(prev => {
        const newSet = new Set(prev);
        newSet.add(data.playerId);
        return newSet;
      });
      
      // If I activated it
      if (data.playerId === myId) {
        setIsImmune(true);
      }
    });

    // Powerup expired - player no longer immune
    socketService.onPowerupExpired((data) => {
      console.log(`🛡️ ${data.playerName}'s ${data.type} expired`);
      
      const myId = socketService.getSocket()?.id;
      
      // Remove from immune players
      setImmunePlayers(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.playerId);
        return newSet;
      });
      
      // If mine expired
      if (data.playerId === myId) {
        setIsImmune(false);
      }
    });

    // Cleanup on unmount - remove listeners only (keep connection alive)
    return () => {
      socketService.removeAllListeners('room_update');
      socketService.removeAllListeners('player_joined');
      socketService.removeAllListeners('player_left');
      socketService.removeAllListeners('game_started');
      socketService.removeAllListeners('host_transferred');
      socketService.removeAllListeners('unicorn_transferred');
      socketService.removeAllListeners('score_update');
      socketService.removeAllListeners('game_frozen');
      socketService.removeAllListeners('quiz_start');
      socketService.removeAllListeners('quiz_answer_result');
      socketService.removeAllListeners('quiz_complete');
      // Game loop events
      socketService.removeAllListeners('phase_change');
      socketService.removeAllListeners('blitz_start');
      socketService.removeAllListeners('blitz_result');
      socketService.removeAllListeners('hunt_start');
      socketService.removeAllListeners('hunt_end');
      socketService.removeAllListeners('player_tagged');
      socketService.removeAllListeners('reserve_activated');
      // Combat events
      socketService.removeAllListeners('player_hit');
      socketService.removeAllListeners('player_respawn');
      socketService.removeAllListeners('player_state_change');
      socketService.removeAllListeners('health_update');
      // Coin events
      socketService.removeAllListeners('coin_spawned');
      socketService.removeAllListeners('coin_collected');
      // Powerup events
      socketService.removeAllListeners('powerup_spawned');
      socketService.removeAllListeners('powerup_collected');
      socketService.removeAllListeners('powerup_activated');
      socketService.removeAllListeners('powerup_expired');
    };
  }, [navigate, location.pathname]);

  const value = {
    socket,
    connected,
    roomData,
    setRoomData,
    gameState,
    setGameState,
    players,
    setPlayers,
    unicornId,
    setUnicornId,
    leaderboard,
    setLeaderboard,
    isGameFrozen,
    setIsGameFrozen,
    freezeMessage,
    setFreezeMessage,
    quizActive,
    setQuizActive,
    quizData,
    setQuizData,
    quizResults,
    setQuizResults,
    socketService,
    // Game Loop state
    gamePhase,
    setGamePhase,
    blitzQuizActive,
    setBlitzQuizActive,
    blitzQuizData,
    setBlitzQuizData,
    blitzQuizResults,
    setBlitzQuizResults,
    huntData,
    setHuntData,
    huntTimeRemaining,
    setHuntTimeRemaining,
    reserveUnicornId,
    setReserveUnicornId,
    tagNotification,
    setTagNotification,
    // Combat System state
    playersHealth,
    setPlayersHealth,
    hitNotification,
    setHitNotification,
    myPlayerState,
    setMyPlayerState,
    myHealth,
    setMyHealth,
    inIFrames,
    setInIFrames,
    // Coin & Powerup state
    coins,
    setCoins,
    powerups,
    setPowerups,
    coinCollectNotification,
    setCoinCollectNotification,
    powerupCollectNotification,
    setPowerupCollectNotification,
    isImmune,
    setIsImmune,
    immunePlayers,
    setImmunePlayers,
    // Knockback state
    knockbackActive,
    setKnockbackActive,
    knockbackPlayers,
    setKnockbackPlayers
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export default SocketContext;
