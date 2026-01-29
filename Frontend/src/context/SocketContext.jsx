/**
 * Socket Context for React
 * Coordinates socket events and provides combined state to components
 * Uses split contexts for better render optimization
 * 
 * Event handlers are split into logical groups:
 * - Connection & Room: socket lifecycle, room/player updates
 * - Game Phase & Quiz: game phases, quizzes, hunt mechanics
 * - Combat & Items: health, combat, coins, powerups
 */

import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import socketService from '../services/socket';
import soundManager from '../services/PhaserSoundManager';
import log from '../utils/logger';

// Import split contexts
import { RoomProvider, useRoom } from './RoomContext';
import { GamePhaseProvider, useGamePhase, GAME_PHASE } from './GamePhaseContext';
import { CombatProvider, useCombat, PLAYER_STATE, COMBAT_CONFIG } from './CombatContext';

// Re-export constants for backward compatibility
export { GAME_PHASE } from './GamePhaseContext';
export { PLAYER_STATE, COMBAT_CONFIG } from './CombatContext';

const SocketContext = createContext(null);

/**
 * Combined hook for components that need everything (backward compatible)
 */
export const useSocket = () => {
  const room = useRoom();
  const gamePhase = useGamePhase();
  const combat = useCombat();
  
  return useMemo(() => ({
    ...room,
    ...gamePhase,
    ...combat,
  }), [room, gamePhase, combat]);
};

/**
 * Internal component that sets up socket event handlers
 * Must be inside all three providers to access their setters
 */
const SocketEventHandler = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get state and setters from all contexts
  const {
    setSocket, setConnected, setRoomData, setUnicornId,
    setReserveUnicornId, setLeaderboard
  } = useRoom();
  
  const {
    setGameState, setGamePhase, setIsGameFrozen, setFreezeMessage,
    setQuizActive, setQuizData, setQuizResults,
    setBlitzQuizActive, setBlitzQuizData, setBlitzQuizResults,
    setHuntData, setHuntTimeRemaining, setTagNotification,
    setUnfreezeQuizActive, setUnfreezeQuizData
  } = useGamePhase();
  
  const {
    setPlayersHealth, setHitNotification, setMyPlayerState, setMyHealth,
    setInIFrames, setCoins, setPowerups, setCoinCollectNotification,
    setPowerupCollectNotification, setIsImmune, setImmunePlayers,
    setKnockbackActive, setKnockbackPlayers, powerupNotificationTimeoutRef
  } = useCombat();

  // Stable ref for location.pathname to avoid effect re-runs
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  // ========== EFFECT 1: Connection & Room Events ==========
  // Handles: socket lifecycle, room updates, player join/leave, host/unicorn transfer
  useEffect(() => {
    const socketInstance = socketService.connect();
    setSocket(socketInstance);

    // Connection lifecycle
    const handleConnect = () => {
      log.log('Connected to server');
      setConnected(true);
    };
    const handleDisconnect = () => {
      log.log('Disconnected from server');
      setConnected(false);
    };
    socketInstance.on('connect', handleConnect);
    socketInstance.on('disconnect', handleDisconnect);

    // Room events - all update roomData (players derived automatically)
    socketService.onRoomUpdate((data) => {
      log.log('Room updated:', data);
      setRoomData(data.room);
    });

    socketService.onPlayerJoined((data) => {
      log.log('Player joined:', data.player);
      setRoomData(data.room);
    });

    socketService.onPlayerLeft((data) => {
      log.log('Player left:', data.playerId);
      setRoomData(data.room);
    });

    socketService.onHostTransferred((data) => {
      log.log('Host transferred:', data);
      setRoomData(data.room);
    });

    socketService.onUnicornTransferred((data) => {
      log.log('Unicorn transferred:', data);
      setUnicornId(data.newUnicornId);
      setRoomData(data.room);
    });

    socketService.onScoreUpdate((data) => {
      log.log('Score updated:', data);
      if (data.room) setRoomData(data.room);
      if (data.leaderboard) setLeaderboard(data.leaderboard);
    });

    return () => {
      socketInstance.off('connect', handleConnect);
      socketInstance.off('disconnect', handleDisconnect);
      socketService.removeAllListeners('room_update');
      socketService.removeAllListeners('player_joined');
      socketService.removeAllListeners('player_left');
      socketService.removeAllListeners('host_transferred');
      socketService.removeAllListeners('unicorn_transferred');
      socketService.removeAllListeners('score_update');
    };
  }, [setSocket, setConnected, setRoomData, setUnicornId, setLeaderboard]);

  // ========== EFFECT 2: Game Start (needs navigate) ==========
  // Separated because it depends on navigate
  useEffect(() => {
    socketService.onGameStarted((data) => {
      log.log('Game started:', data);
      setRoomData(data.room);
      setGameState(data.gameState);
      
      soundManager.playGameStart();
      
      if (data.room?.unicornId) {
        setUnicornId(data.room.unicornId);
      }
      if (data.gameState?.leaderboard) {
        setLeaderboard(data.gameState.leaderboard);
      }
      
      // Use ref to avoid stale closure
      if (locationRef.current !== '/startgame') {
        navigate('/startgame');
      }
    });

    return () => {
      socketService.removeAllListeners('game_started');
    };
  }, [navigate, setRoomData, setGameState, setUnicornId, setLeaderboard]);

  // ========== EFFECT 3: Game Phase & Quiz Events ==========
  // Handles: freeze, quiz, blitz, phase changes, hunt, tagging
  useEffect(() => {
    // Quiz Events
    socketService.onGameFrozen((data) => {
      log.log('🥶 ===== GAME FROZEN =====');
      log.log('Freeze data:', data);
      log.log('Message:', data.message);
      log.log('Reason:', data.freezeReason);
      log.log('=========================');
      
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
      log.log('Quiz started:', data);
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
      log.log('Quiz answer result:', data);
      if (data.correct) {
        soundManager.playQuizCorrect();
      } else {
        soundManager.playQuizWrong();
      }
      setQuizData(prev => {
        if (!prev) return prev;
        return { ...prev, answers: [...prev.answers, data] };
      });
    });

    socketService.onQuizComplete((data) => {
      log.log('🏁 ===== QUIZ COMPLETE =====');
      log.log('Results:', data);
      log.log('Score:', data.correctAnswers, '/', data.totalQuestions, '(', data.scorePercentage, '%)');
      log.log('===========================');
      
      setQuizResults(data);
      setQuizActive(false);
      
      setTimeout(() => {
        log.log('🔓 Game unfrozen on frontend');
        setIsGameFrozen(false);
        setFreezeMessage(null);
        setQuizResults(null);
        setQuizData(null);
      }, 5000);
    });

    // Phase Change
    socketService.onPhaseChange((data) => {
      log.log('🔄 ===== PHASE CHANGE =====');
      log.log(`${data.previousPhase} → ${data.phase}`);
      log.log('===========================');
      setGamePhase(data.phase);
    });

    // Blitz Quiz
    socketService.onBlitzStart((data) => {
      log.log('⚡ ===== BLITZ QUIZ START =====');
      log.log('Question:', data.question?.question);
      log.log('Time Limit:', data.timeLimit);
      log.log('Players:', data.playerCount);
      log.log('==============================');
      
      soundManager.playBlitzStart();
      setBlitzQuizActive(true);
      setBlitzQuizResults(null);
      setBlitzQuizData({
        question: data.question,
        timeLimit: data.timeLimit,
        playerCount: data.playerCount,
        timestamp: data.timestamp
      });
      setIsGameFrozen(true);
    });

    socketService.onBlitzResult((data) => {
      log.log('⚡ ===== BLITZ QUIZ END =====');
      log.log('New Unicorn:', data.newUnicornName);
      log.log('Reserve:', data.reserveUnicornName);
      log.log('Correct:', data.correctCount, '/', data.totalPlayers);
      log.log('============================');
      
      setBlitzQuizActive(false);
      setBlitzQuizData(null);
      setBlitzQuizResults(data);
      setUnicornId(data.newUnicornId);
      setReserveUnicornId(data.reserveUnicornId);
    });

    // Hunt Timer Update
    socketService.onHuntEnd((data) => {
      const seconds = Math.floor(data.remainingTime / 1000);
      if ([10, 5, 3, 2, 1].includes(seconds)) {
        soundManager.playTimerWarning();
      }
      setHuntTimeRemaining(data.remainingTime);
    });

    // Player Tagged
    socketService.onPlayerTagged((data) => {
      log.log('🏷️ ===== PLAYER TAGGED =====');
      log.log(`${data.unicornName} tagged ${data.survivorName}!`);
      log.log(`Points transferred: ${data.pointsTransferred}`);
      log.log('============================');
      
      soundManager.playTag();
      setTagNotification({
        unicornName: data.unicornName,
        survivorName: data.survivorName,
        points: data.pointsTransferred
      });
      if (data.leaderboard) setLeaderboard(data.leaderboard);
      
      setTimeout(() => setTagNotification(null), 2000);
    });

    // Reserve Activated
    socketService.onReserveActivated((data) => {
      log.log('🦄 ===== RESERVE ACTIVATED =====');
      log.log('New Unicorn:', data.newUnicornName);
      log.log('================================');
      
      setUnicornId(data.newUnicornId);
      setReserveUnicornId(null);
    });

    return () => {
      socketService.removeAllListeners('game_frozen');
      socketService.removeAllListeners('quiz_start');
      socketService.removeAllListeners('quiz_answer_result');
      socketService.removeAllListeners('quiz_complete');
      socketService.removeAllListeners('phase_change');
      socketService.removeAllListeners('blitz_start');
      socketService.removeAllListeners('blitz_result');
      socketService.removeAllListeners('hunt_end');
      socketService.removeAllListeners('player_tagged');
      socketService.removeAllListeners('reserve_activated');
    };
  }, [
    setIsGameFrozen, setFreezeMessage, setQuizActive, setQuizData, setQuizResults,
    setGamePhase, setBlitzQuizActive, setBlitzQuizData, setBlitzQuizResults,
    setUnicornId, setReserveUnicornId, setHuntTimeRemaining, setTagNotification,
    setLeaderboard
  ]);

  // ========== EFFECT 4: Hunt Start (bridges phase & combat) ==========
  // Separated because it touches both game phase and combat state
  useEffect(() => {
    socketService.onHuntStart((data) => {
      soundManager.playHuntStart();
      
      // Game phase state
      setIsGameFrozen(false);
      setBlitzQuizResults(null);
      setHuntData({
        duration: data.duration,
        endTime: data.endTime,
        unicornId: data.unicornId,
        unicornName: data.unicornName,
        reserveUnicornId: data.reserveUnicornId,
        reserveUnicornName: data.reserveUnicornName
      });
      setHuntTimeRemaining(data.duration);

      // Combat state - reset for new round
      setPowerups([]);
      setPowerupCollectNotification(null);
      setInIFrames(false);

      // Initialize player health
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
        
        const myId = socketService.getSocket()?.id;
        const myHealthData = data.playersHealth.find(ph => ph.playerId === myId);
        if (myHealthData) {
          setMyHealth(myHealthData.health);
          setMyPlayerState(myHealthData.state);
        }
      }
    });

    return () => {
      socketService.removeAllListeners('hunt_start');
    };
  }, [
    setIsGameFrozen, setBlitzQuizResults, setHuntData, setHuntTimeRemaining,
    setPowerups, setPowerupCollectNotification, setInIFrames, setPlayersHealth,
    setMyHealth, setMyPlayerState
  ]);

  // ========== EFFECT 5: Combat Events ==========
  // Handles: player hit, respawn, state changes, health updates
  useEffect(() => {
    socketService.onPlayerHit((data) => {
      log.log('💥 ===== PLAYER HIT =====');
      log.log(`${data.attackerName} hit ${data.victimName} for ${data.damage} damage`);
      log.log(`New health: ${data.newHealth}/${data.maxHealth}`);
      log.log('========================');

      soundManager.playPlayerHit();
      const myId = socketService.getSocket()?.id;
      
      setPlayersHealth(prev => ({
        ...prev,
        [data.victimId]: {
          health: data.newHealth,
          maxHealth: data.maxHealth,
          inIFrames: true
        }
      }));

      if (data.victimId === myId) {
        setMyHealth(data.newHealth);
        setInIFrames(true);
        
        setTimeout(() => {
          setInIFrames(false);
          setPlayersHealth(prev => ({
            ...prev,
            [data.victimId]: { ...prev[data.victimId], inIFrames: false }
          }));
        }, data.iframeDuration || COMBAT_CONFIG.IFRAME_DURATION);
      }

      setHitNotification({
        attackerName: data.attackerName,
        victimName: data.victimName,
        damage: data.damage,
        victimId: data.victimId
      });
      setTimeout(() => setHitNotification(null), 1500);

      // Knockback handling
      if (data.knockback) {
        setKnockbackPlayers(prev => {
          const newSet = new Set(prev);
          newSet.add(data.victimId);
          return newSet;
        });

        if (data.victimId === myId) {
          setKnockbackActive(true);
        }

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

    // BATCHED EVENT: Respawn now includes position + health + state in one payload
    socketService.onPlayerRespawn((data) => {
      log.log('🔄 ===== PLAYER RESPAWN =====');
      log.log(`${data.playerName} respawned with ${data.health}/${data.maxHealth} HP`);
      if (data.position) {
        log.log(`Position: row=${data.position.row}, col=${data.position.col}`);
      }
      log.log('=============================');

      const myId = socketService.getSocket()?.id;

      // Update health and state (position handled by Phaser layer)
      setPlayersHealth(prev => ({
        ...prev,
        [data.playerId]: {
          health: data.health,
          maxHealth: data.maxHealth,
          state: data.state,
          inIFrames: data.inIFrames ?? true
        }
      }));

      if (data.playerId === myId) {
        setMyHealth(data.health);
        setMyPlayerState(data.state);
        setInIFrames(data.inIFrames ?? true);
        setTimeout(() => setInIFrames(false), COMBAT_CONFIG.IFRAME_DURATION);
      }
    });

    socketService.onPlayerStateChange((data) => {
      log.log('🔄 Player state change:', data.playerId, '→', data.state);

      const myId = socketService.getSocket()?.id;

      if (data.state === 'frozen' && data.playerId === myId) {
        soundManager.playFreeze();
      }

      setPlayersHealth(prev => ({
        ...prev,
        [data.playerId]: {
          ...prev[data.playerId],
          state: data.state,
          inIFrames: data.inIFrames || false
        }
      }));

      if (data.playerId === myId) {
        setMyPlayerState(data.state);
        if (data.inIFrames !== undefined) {
          setInIFrames(data.inIFrames);
        }
      }
    });

    socketService.onHealthUpdate((data) => {
      const myId = socketService.getSocket()?.id;

      setPlayersHealth(prev => ({
        ...prev,
        [data.playerId]: {
          ...prev[data.playerId],
          health: data.health,
          maxHealth: data.maxHealth
        }
      }));

      if (data.playerId === myId) {
        setMyHealth(data.health);
      }
    });

    return () => {
      socketService.removeAllListeners('player_hit');
      socketService.removeAllListeners('player_respawn');
      socketService.removeAllListeners('player_state_change');
      socketService.removeAllListeners('health_update');
    };
  }, [
    setPlayersHealth, setMyHealth, setInIFrames, setHitNotification,
    setKnockbackPlayers, setKnockbackActive, setMyPlayerState
  ]);

  // ========== EFFECT 6: Unfreeze Quiz Events ==========
  // Handles: personal unfreeze quiz when player health reaches zero
  useEffect(() => {
    // Unfreeze Quiz Start - player receives 2-question personal quiz
    socketService.onUnfreezeQuizStart((data) => {
      log.log('🧊 ===== UNFREEZE QUIZ START =====');
      log.log('Questions:', data.questions?.length);
      log.log('Pass threshold:', data.passThreshold);
      log.log('=================================');
      
      setUnfreezeQuizActive(true);
      setUnfreezeQuizData({
        questions: data.questions,
        totalQuestions: data.totalQuestions,
        passThreshold: data.passThreshold,
        currentQuestion: 0,
        answers: []
      });
    });

    // Unfreeze Quiz Complete - quiz finished (passed or failed with retry)
    socketService.onUnfreezeQuizComplete((data) => {
      log.log('🧊 ===== UNFREEZE QUIZ COMPLETE =====');
      log.log('Passed:', data.passed);
      log.log('Score:', data.correctCount, '/', data.totalQuestions);
      log.log('Retry:', data.retry);
      log.log('====================================');
      
      if (data.passed) {
        // Quiz passed - close modal (respawn handled by player_respawn event)
        setUnfreezeQuizActive(false);
        setUnfreezeQuizData(null);
      } else if (data.retry) {
        // Quiz failed - will receive new UNFREEZE_QUIZ_START shortly
        // Keep modal open but show failed state briefly
        setUnfreezeQuizData(prev => ({
          ...prev,
          failed: true,
          correctCount: data.correctCount
        }));
      }
    });

    // Unfreeze Quiz Cancelled - blitz started, close quiz
    socketService.onUnfreezeQuizCancelled((data) => {
      log.log('🧊 ===== UNFREEZE QUIZ CANCELLED =====');
      log.log('Reason:', data.reason);
      log.log('Message:', data.message);
      log.log('=====================================');
      
      // Close the unfreeze quiz modal
      setUnfreezeQuizActive(false);
      setUnfreezeQuizData(null);
    });

    return () => {
      socketService.removeAllListeners('unfreeze_quiz_start');
      socketService.removeAllListeners('unfreeze_quiz_complete');
      socketService.removeAllListeners('unfreeze_quiz_cancelled');
    };
  }, [setUnfreezeQuizActive, setUnfreezeQuizData]);

  // ========== EFFECT 7: Coins & Powerups ==========
  // Handles: coin/powerup spawn, collection, activation, expiration
  useEffect(() => {
    // Coin spawned
    socketService.onCoinSpawned((data) => {
      if (data.coins) {
        log.log('💰 ===== COINS SPAWNED =====');
        log.log(`Coins: ${data.coins.length}`);
        log.log('============================');
        setCoins(data.coins);
      } else if (data.coinId || data.id) {
        const coinId = data.coinId || data.id;
        log.log(`💰 Coin spawned at (${data.row}, ${data.col})`);
        setCoins(prev => {
          const exists = prev.some(c => c.id === coinId);
          if (exists) return prev;
          return [...prev, { id: coinId, row: data.row, col: data.col }];
        });
      }
    });

    // Coin collected
    socketService.onCoinCollected((data) => {
      log.log(`💰 ${data.playerName} collected coin! +${data.value}`);
      
      const myId = socketService.getSocket()?.id;
      log.log(`🔍 Coin collection check - data.playerId: ${data.playerId}, myId: ${myId}, match: ${data.playerId === myId}`);
      
      setCoins(prev => {
        const collectedCoin = prev.find(coin => coin.id === data.coinId);
        
        if (data.playerId === myId) {
          log.log('🔊 Playing coin collect sound...');
          soundManager.playCoinCollect();
          
          setCoinCollectNotification({
            value: data.value,
            newScore: data.newScore,
            row: collectedCoin?.row ?? data.row,
            col: collectedCoin?.col ?? data.col,
            coinId: data.coinId
          });
          setTimeout(() => setCoinCollectNotification(null), 1000);
        }
        
        return prev.filter(coin => coin.id !== data.coinId);
      });
      
      if (data.leaderboard) setLeaderboard(data.leaderboard);
    });

    // Powerup spawned
    socketService.onPowerupSpawned((data) => {
      log.log(`⚡ Powerup spawned at (${data.row}, ${data.col})`);
      setPowerups(prev => [...prev, {
        id: data.id,
        row: data.row,
        col: data.col,
        type: data.type
      }]);
    });

    // Powerup collected
    socketService.onPowerupCollected((data) => {
      log.log('Powerup collected:', data);
      
      const myId = socketService.getSocket()?.id;
      log.log(`🔍 Powerup collection check - data.playerId: ${data.playerId}, myId: ${myId}, match: ${data.playerId === myId}`);
      
      if (powerupNotificationTimeoutRef.current) {
        clearTimeout(powerupNotificationTimeoutRef.current);
        powerupNotificationTimeoutRef.current = null;
      }
      
      setPowerups(prev => {
        const collectedPowerup = prev.find(p => p.id === data.powerupId);
        
        if (data.playerId === myId) {
          log.log('🔊 Playing powerup pickup sound...');
          soundManager.playPowerupPickup();
          
          setPowerupCollectNotification({
            row: collectedPowerup?.row ?? data.row,
            col: collectedPowerup?.col ?? data.col,
            type: collectedPowerup?.type ?? data.type ?? 'immunity',
            powerupId: data.powerupId
          });
          
          powerupNotificationTimeoutRef.current = setTimeout(() => {
            setPowerupCollectNotification(null);
            powerupNotificationTimeoutRef.current = null;
          }, 500);
        }
        
        return prev.filter(p => p.id !== data.powerupId);
      });
    });

    // Powerup activated
    socketService.onPowerupActivated((data) => {
      log.log(`🛡️ ${data.playerName} activated ${data.type}!`);
      
      const myId = socketService.getSocket()?.id;
      
      setImmunePlayers(prev => {
        const newSet = new Set(prev);
        newSet.add(data.playerId);
        return newSet;
      });
      
      if (data.playerId === myId) {
        setIsImmune(true);
      }
    });

    // Powerup expired
    socketService.onPowerupExpired((data) => {
      log.log(`🛡️ ${data.playerName}'s ${data.type} expired`);
      
      const myId = socketService.getSocket()?.id;
      
      setImmunePlayers(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.playerId);
        return newSet;
      });
      
      if (data.playerId === myId) {
        setIsImmune(false);
      }
    });

    return () => {
      if (powerupNotificationTimeoutRef.current) {
        clearTimeout(powerupNotificationTimeoutRef.current);
        powerupNotificationTimeoutRef.current = null;
      }
      socketService.removeAllListeners('coin_spawned');
      socketService.removeAllListeners('coin_collected');
      socketService.removeAllListeners('powerup_spawned');
      socketService.removeAllListeners('powerup_collected');
      socketService.removeAllListeners('powerup_activated');
      socketService.removeAllListeners('powerup_expired');
    };
  }, [
    setCoins, setCoinCollectNotification, setPowerups, setPowerupCollectNotification,
    setIsImmune, setImmunePlayers, setLeaderboard, powerupNotificationTimeoutRef
  ]);

  return children;
};

/**
 * Main Socket Provider that wraps all context providers
 */
export const SocketProvider = ({ children }) => {
  return (
    <RoomProvider>
      <GamePhaseProvider>
        <CombatProvider>
          <SocketEventHandler>
            {children}
          </SocketEventHandler>
        </CombatProvider>
      </GamePhaseProvider>
    </RoomProvider>
  );
};

export default SocketContext;
