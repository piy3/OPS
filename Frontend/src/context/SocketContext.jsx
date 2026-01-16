/**
 * Socket Context for React
 * Provides socket connection and game state to all components
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import socketService from '../services/socket';

const SocketContext = createContext(null);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
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
  
  // Quiz state
  const [isGameFrozen, setIsGameFrozen] = useState(false);
  const [freezeMessage, setFreezeMessage] = useState(null);
  const [quizActive, setQuizActive] = useState(false);
  const [quizData, setQuizData] = useState(null);
  const [quizResults, setQuizResults] = useState(null);

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
    socketService
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export default SocketContext;
