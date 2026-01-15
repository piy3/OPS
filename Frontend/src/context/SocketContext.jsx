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

  useEffect(() => {
    // Connect to socket server
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

    // Cleanup on unmount
    return () => {
      socketService.removeAllListeners('room_update');
      socketService.removeAllListeners('player_joined');
      socketService.removeAllListeners('player_left');
      socketService.removeAllListeners('game_started');
      socketService.removeAllListeners('host_transferred');
      socketService.removeAllListeners('unicorn_transferred');
      socketService.removeAllListeners('score_update');
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
    socketService
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export default SocketContext;
