/**
 * Room Context - Handles room/player data and socket connection
 * Rarely changes during gameplay
 */

import { createContext, useContext, useState, useMemo } from 'react';
import socketService from '../services/socket';

const RoomContext = createContext(null);

export const useRoom = () => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoom must be used within a RoomProvider');
  }
  return context;
};

export const RoomProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomData, setRoomData] = useState(null);
  const [unicornId, setUnicornId] = useState(null);
  const [reserveUnicornId, setReserveUnicornId] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  // Derive players from roomData (single source of truth)
  const players = roomData?.players ?? [];

  const value = useMemo(() => ({
    socket,
    setSocket,
    connected,
    setConnected,
    roomData,
    setRoomData,
    players,
    unicornId,
    setUnicornId,
    reserveUnicornId,
    setReserveUnicornId,
    leaderboard,
    setLeaderboard,
    socketService,
  }), [socket, connected, roomData, players, unicornId, reserveUnicornId, leaderboard]);

  return (
    <RoomContext.Provider value={value}>
      {children}
    </RoomContext.Provider>
  );
};

export default RoomContext;
