/**
 * Teacher's Game View - Information dashboard while students play
 * Shows leaderboard and game status without spectating
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Trophy, Users, Clock, Zap } from 'lucide-react';
import socketService, { SOCKET_EVENTS, Room, MapConfig } from '@/services/SocketService';
import logger from '@/utils/logger';

// Leaderboard entry
interface LeaderboardEntry {
  id: string;
  name: string;
  coins: number;
  isUnicorn: boolean;
  questionsAttempted: number;
  questionsCorrect: number;
}

// Location state from Dashboard
interface LocationState {
  room?: Room;
  gameState?: any;
  quizId?: string;
}

const TeacherGame: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const locationState = location.state as LocationState | null;
  const quizId = locationState?.quizId ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('QUIZ_ID') : null);
  const dashboardPath = quizId ? `/dashboard/${quizId}` : '/dashboard';

  // Room state
  const [room, setRoom] = useState<Room | null>(locationState?.room || null);
  const [mapConfig, setMapConfig] = useState<MapConfig | null>(locationState?.room?.mapConfig || null);
  
  // Game phase state
  const [gamePhase, setGamePhase] = useState<'waiting' | 'blitz_quiz' | 'hunt' | 'round_end' | 'game_end'>('hunt');
  const [huntTimeLeft, setHuntTimeLeft] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(4);
  const [unicornIds, setUnicornIds] = useState<string[]>([]);
  
  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  
  // Game end state
  const [isGameOver, setIsGameOver] = useState(false);
  const [finalLeaderboard, setFinalLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isRestarting, setIsRestarting] = useState(false);
  const [showEndGameConfirm, setShowEndGameConfirm] = useState(false);
  const isGameOverRef = useRef(false);
  isGameOverRef.current = isGameOver;

  // Redirect if no room
  useEffect(() => {
    if (!locationState?.room) {
      navigate(dashboardPath);
    }
  }, [locationState, navigate, dashboardPath]);

  // Socket event listeners
  useEffect(() => {
    // Game state sync
    const unsubGameStateSync = socketService.on(SOCKET_EVENTS.SERVER.GAME_STATE_SYNC, (data: any) => {
      if (!data.gameState) return;
      
      if (data.mapConfig) {
        setMapConfig(data.mapConfig);
      }

      const unicornIdsSync = data.gameState.unicornIds ?? (data.gameState.unicornId ? [data.gameState.unicornId] : []);
      setUnicornIds(unicornIdsSync);

      // Update leaderboard
      if (data.gameState.players) {
        const leaderboardData: LeaderboardEntry[] = data.gameState.players.map((p: any) => ({
          id: p.id,
          name: p.name || 'Player',
          coins: p.coins ?? 0,
          isUnicorn: unicornIdsSync.includes(p.id),
          questionsAttempted: p.questions_attempted ?? 0,
          questionsCorrect: p.questions_correctly_answered ?? 0,
        })).sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.coins - a.coins);
        setLeaderboard(leaderboardData);
      }

      if (data.phase) {
        setGamePhase(data.phase);
      }
      if (data.gameState.currentRound) {
        setCurrentRound(data.gameState.currentRound);
      }
      if (data.gameState.totalRounds) {
        setTotalRounds(data.gameState.totalRounds);
      }
    });

    // Hunt start
    const unsubHuntStart = socketService.on(SOCKET_EVENTS.SERVER.HUNT_START, (data: any) => {
      setGamePhase('hunt');
      setHuntTimeLeft(data.duration / 1000);
      setCurrentRound(data.roundInfo?.currentRound || 1);
      setTotalRounds(data.roundInfo?.totalRounds || 4);
      
      if (data.unicornIds) {
        setUnicornIds(data.unicornIds);
      }
    });

    // Hunt end / timer update
    const unsubHuntEnd = socketService.on(SOCKET_EVENTS.SERVER.HUNT_END, (data: any) => {
      if (data.remainingTime != null && data.remainingTime > 0) {
        setHuntTimeLeft(data.remainingTime / 1000);
      } else {
        setGamePhase('round_end');
      }
    });

    // Blitz start
    const unsubBlitzStart = socketService.on(SOCKET_EVENTS.SERVER.BLITZ_START, () => {
      setGamePhase('blitz_quiz');
    });

    // Blitz result
    const unsubBlitzResult = socketService.on(SOCKET_EVENTS.SERVER.BLITZ_RESULT, (data: any) => {
      if (data.unicornIds) {
        setUnicornIds(data.unicornIds);
        // Update leaderboard unicorn status
        setLeaderboard(prev => prev.map(entry => ({
          ...entry,
          isUnicorn: data.unicornIds.includes(entry.id)
        })));
      }
    });

    // Coin collected - update leaderboard
    const unsubCoinCollected = socketService.on(SOCKET_EVENTS.SERVER.COIN_COLLECTED, (data: any) => {
      if (Array.isArray(data.leaderboard)) {
        const leaderboardData: LeaderboardEntry[] = data.leaderboard.map((p: any) => ({
          id: p.id,
          name: p.name || 'Player',
          coins: p.coins ?? 0,
          isUnicorn: unicornIds.includes(p.id),
          questionsAttempted: p.questions_attempted ?? 0,
          questionsCorrect: p.questions_correctly_answered ?? 0,
        })).sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.coins - a.coins);
        setLeaderboard(leaderboardData);
      }
    });

    // Score update (on tag)
    const unsubScoreUpdate = socketService.on(SOCKET_EVENTS.SERVER.SCORE_UPDATE, (data: any) => {
      if (Array.isArray(data.leaderboard)) {
        const leaderboardData: LeaderboardEntry[] = data.leaderboard.map((p: any) => ({
          id: p.id,
          name: p.name || 'Player',
          coins: p.coins ?? 0,
          isUnicorn: unicornIds.includes(p.id),
          questionsAttempted: p.questions_attempted ?? 0,
          questionsCorrect: p.questions_correctly_answered ?? 0,
        })).sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.coins - a.coins);
        setLeaderboard(leaderboardData);
      }
    });

    // Game end
    const unsubGameEnd = socketService.on(SOCKET_EVENTS.SERVER.GAME_END, (data: any) => {
      setGamePhase('game_end');
      setIsGameOver(true);
      
      if (Array.isArray(data.leaderboard)) {
        const finalData: LeaderboardEntry[] = data.leaderboard.map((p: any) => ({
          id: p.id,
          name: p.name || 'Player',
          coins: p.coins ?? 0,
          isUnicorn: false,
          questionsAttempted: p.questions_attempted ?? 0,
          questionsCorrect: p.questions_correctly_answered ?? 0,
        })).sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.coins - a.coins);
        setFinalLeaderboard(finalData);
      }
      setSearchParams({ isCompleted: 'true' });
    });

    // Game started (initial start or restart after game over)
    const unsubGameStarted = socketService.on(SOCKET_EVENTS.SERVER.GAME_STARTED, (data: any) => {
      if (isGameOverRef.current) {
        // Restart: leave game-over screen and restore in-game view
        setIsGameOver(false);
        setIsRestarting(false);
        setGamePhase(data.phase ?? 'blitz_quiz');
        setCurrentRound(data.roundInfo?.currentRound ?? 1);
        setTotalRounds(data.roundInfo?.totalRounds ?? 4);
        if (data.room) setRoom(data.room);
        if (data.mapConfig) setMapConfig(data.mapConfig);
        const unicornIdsNew = data.gameState?.unicornIds ?? (data.gameState?.unicornId ? [data.gameState.unicornId] : []);
        setUnicornIds(unicornIdsNew);
        if (data.gameState?.players) {
          const leaderboardData: LeaderboardEntry[] = data.gameState.players.map((p: any) => ({
            id: p.id,
            name: p.name || 'Player',
            coins: p.coins ?? 0,
            isUnicorn: unicornIdsNew.includes(p.id),
            questionsAttempted: p.questions_attempted ?? 0,
            questionsCorrect: p.questions_correctly_answered ?? 0,
          })).sort((a: LeaderboardEntry, b: LeaderboardEntry) => b.coins - a.coins);
          setLeaderboard(leaderboardData);
        }
      }
    });

    // Request initial game state
    socketService.getGameState();

    return () => {
      unsubGameStateSync();
      unsubHuntStart();
      unsubHuntEnd();
      unsubBlitzStart();
      unsubBlitzResult();
      unsubCoinCollected();
      unsubScoreUpdate();
      unsubGameEnd();
      unsubGameStarted();
    };
  }, [unicornIds]);

  // Timer countdown
  useEffect(() => {
    if (gamePhase !== 'hunt' || huntTimeLeft <= 0) return;
    const interval = setInterval(() => {
      setHuntTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [gamePhase, huntTimeLeft]);

  // Game over screen
  if (isGameOver) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-black flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-2xl w-full shadow-xl shadow-black/20">
          <h1 className="text-4xl font-bold text-center text-cream mb-6">GAME OVER</h1>
          
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-cream mb-4 flex items-center gap-2">
              <Trophy size={24} /> Final Standings
            </h2>
            <div className="bg-muted/50 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
              <table className="w-full">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-muted-foreground text-sm">
                    <th className="py-3 px-4 text-left">#</th>
                    <th className="py-3 px-4 text-left">Name</th>
                    <th className="py-3 px-4 text-right">Coins</th>
                    <th className="py-3 px-4 text-right">Questions</th>
                  </tr>
                </thead>
                <tbody>
                  {finalLeaderboard.map((entry, i) => (
                    <tr key={entry.id} className="border-t border-border">
                      <td className="py-3 px-4 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="py-3 px-4 text-foreground">{entry.name}</td>
                      <td className="py-3 px-4 text-right font-mono text-cream">{entry.coins}</td>
                      <td className="py-3 px-4 text-right font-mono text-cream-muted">
                        {entry.questionsCorrect}/{entry.questionsAttempted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                setIsRestarting(true);
                socketService.startGame();
              }}
              disabled={isRestarting}
              className="flex-1 py-4 bg-cream text-wine-800 hover:bg-cream-muted disabled:opacity-50 disabled:cursor-not-allowed font-bold rounded-lg transition-colors"
            >
              {isRestarting ? 'Starting…' : 'Restart Game'}
            </button>
            <button
              onClick={() => navigate(dashboardPath)}
              className="flex-1 py-4 bg-wine-600 text-cream hover:bg-wine-700 font-bold rounded-lg transition-colors border border-cream/30"
            >
              Return to Dashboard
            </button>
          </div>
          {isRestarting && (
            <p className="text-center text-muted-foreground text-sm mt-3">Restarting game with same quiz and players…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-black p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Teacher Dashboard</h1>
            <p className="text-muted-foreground">Game in progress</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-card px-6 py-3 rounded-lg border border-border">
              <span className="text-muted-foreground text-sm">Room Code: </span>
              <span className="text-cream font-mono font-bold text-2xl">{room?.code}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowEndGameConfirm(true)}
              className="py-3 px-5 rounded-lg font-bold border border-destructive/50 bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
            >
              End game
            </button>
          </div>
        </div>

        {/* End game confirmation modal */}
        {showEndGameConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowEndGameConfirm(false)}>
            <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-xl" onClick={e => e.stopPropagation()}>
              <p className="text-foreground mb-4">End game now? Students will see final standings.</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEndGameConfirm(false);
                    socketService.endGame();
                  }}
                  className="flex-1 py-3 rounded-lg font-bold bg-destructive text-cream hover:bg-destructive/90"
                >
                  End game
                </button>
                <button
                  type="button"
                  onClick={() => setShowEndGameConfirm(false)}
                  className="flex-1 py-3 rounded-lg font-bold bg-muted text-foreground hover:bg-muted/80"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Game Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Phase Card */}
          <div className={`p-6 rounded-xl border ${
            gamePhase === 'blitz_quiz' 
              ? 'bg-neutral-800/80 border-cream/40'
              : gamePhase === 'hunt'
                ? 'bg-neutral-700/80 border-cream/30'
                : 'bg-card border-border'
          }`}>
            <div className="flex items-center gap-3 mb-2">
              <Zap size={24} className="text-cream" />
              <span className="text-muted-foreground font-medium">Current Phase</span>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {gamePhase === 'blitz_quiz' && 'Blitz Quiz'}
              {gamePhase === 'hunt' && 'Hunt Phase'}
              {gamePhase === 'round_end' && 'Round End'}
              {gamePhase === 'waiting' && 'Waiting'}
            </p>
          </div>

          {/* Round Card */}
          <div className="bg-card p-6 rounded-xl border border-border">
            <div className="flex items-center gap-3 mb-2">
              <Users size={24} className="text-cream" />
              <span className="text-muted-foreground font-medium">Round</span>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {currentRound} <span className="text-muted-foreground">/ {totalRounds}</span>
            </p>
          </div>

          {/* Timer Card */}
          <div className="bg-card p-6 rounded-xl border border-border">
            <div className="flex items-center gap-3 mb-2">
              <Clock size={24} className="text-cream" />
              <span className="text-muted-foreground font-medium">Time Left</span>
            </div>
            <p className={`text-4xl font-mono font-bold ${huntTimeLeft <= 10 ? 'text-destructive' : 'text-foreground'}`}>
              {gamePhase === 'hunt' ? `${Math.ceil(huntTimeLeft)}s` : '--'}
            </p>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
            <Trophy size={24} className="text-cream" />
            <h2 className="text-xl font-semibold text-cream">Live Leaderboard</h2>
            <span className="ml-auto text-muted-foreground flex items-center gap-2">
              <Users size={18} /> {leaderboard.length} players
            </span>
          </div>
          
          <div className="overflow-y-auto max-h-[50vh]">
            <table className="w-full">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-muted-foreground text-sm">
                  <th className="py-3 px-4 text-left">Rank</th>
                  <th className="py-3 px-4 text-left">Player</th>
                  <th className="py-3 px-4 text-center">Role</th>
                  <th className="py-3 px-4 text-right">Coins</th>
                  <th className="py-3 px-4 text-right">Questions</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      Waiting for game data...
                    </td>
                  </tr>
                ) : (
                  leaderboard.map((entry, i) => (
                    <tr 
                      key={entry.id} 
                      className={`border-t border-border/50 ${
                        entry.isUnicorn ? 'bg-wine-600/20' : ''
                      } ${i < 3 ? 'bg-cream/5' : ''}`}
                    >
                      <td className="py-3 px-4">
                        <span className={`font-mono font-bold ${
                          i === 0 ? 'text-cream text-lg' :
                          i === 1 ? 'text-cream-muted' :
                          i === 2 ? 'text-cream-dim' :
                          'text-muted-foreground'
                        }`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-foreground font-medium">
                        {entry.name}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {entry.isUnicorn ? (
                          <span className="uppercase inline-flex items-center gap-1 px-2 py-1 rounded bg-wine-600/50 text-cream text-sm">
                            🚔 Enforcer
                          </span>
                        ) : (
                          <span className="uppercase text-muted-foreground text-sm">🏃 Bandit</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-cream font-bold">
                        {entry.coins}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-cream-muted">
                        {entry.questionsCorrect}/{entry.questionsAttempted}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-muted-foreground text-sm">
          Game will end after {totalRounds} rounds
        </div>
      </div>
    </div>
  );
};

export default TeacherGame;
