/**
 * Lobby page for multiplayer room management
 * Players can create rooms, join with codes, and see player list
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import socketService, { SOCKET_EVENTS, Room, Player } from '@/services/SocketService';

const Lobby = () => {
  const navigate = useNavigate();
  
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Room state
  const [room, setRoom] = useState<Room | null>(null);
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('playerName') || '';
  });
  const [roomCode, setRoomCode] = useState('');
  
  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  // Get current player
  const getCurrentPlayer = useCallback((): Player | null => {
    if (!room) return null;
    const socketId = socketService.getSocketId();
    return room.players.find(p => p.id === socketId) || null;
  }, [room]);

  // Connect to server on mount
  useEffect(() => {
    setIsConnecting(true);
    socketService.connect();

    const unsubConnection = socketService.onConnectionChange((connected) => {
      setIsConnected(connected);
      setIsConnecting(false);
      if (!connected) {
        setError('Disconnected from server');
      }
    });

    // Check if already connected
    if (socketService.isConnected()) {
      setIsConnected(true);
      setIsConnecting(false);
    }

    return () => {
      unsubConnection();
    };
  }, []);

  // Set up socket event listeners
  useEffect(() => {
    if (!isConnected) return;

    // Room created successfully
    const unsubRoomCreated = socketService.on(SOCKET_EVENTS.SERVER.ROOM_CREATED, (data: { roomCode: string; room: Room }) => {
      console.log('Room created:', data);
      setRoom(data.room);
      setIsCreating(false);
      setError(null);
    });

    // Room joined successfully
    const unsubRoomJoined = socketService.on(SOCKET_EVENTS.SERVER.ROOM_JOINED, (data: { roomCode: string; room: Room }) => {
      console.log('Room joined:', data);
      setRoom(data.room);
      setIsJoining(false);
      setError(null);
    });

    // Another player joined
    const unsubPlayerJoined = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_JOINED, (data: { player: Player; room: Room }) => {
      console.log('Player joined:', data.player.name);
      setRoom(data.room);
    });

    // Player left
    const unsubPlayerLeft = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_LEFT, (data: { playerId: string; room: Room }) => {
      console.log('Player left:', data.playerId);
      setRoom(data.room);
    });

    // Room update
    const unsubRoomUpdate = socketService.on(SOCKET_EVENTS.SERVER.ROOM_UPDATE, (data: { room: Room }) => {
      setRoom(data.room);
    });

    // Host transferred
    const unsubHostTransferred = socketService.on(SOCKET_EVENTS.SERVER.HOST_TRANSFERRED, (data: { room: Room }) => {
      setRoom(data.room);
    });

    // Left room
    const unsubRoomLeft = socketService.on(SOCKET_EVENTS.SERVER.ROOM_LEFT, () => {
      setRoom(null);
    });

    // Game started - navigate to game
    const unsubGameStarted = socketService.on(SOCKET_EVENTS.SERVER.GAME_STARTED, (data: any) => {
      console.log('Game started:', data);
      navigate('/game', { state: { room: data.room, gameState: data.gameState } });
    });

    // Error handling
    const unsubJoinError = socketService.on(SOCKET_EVENTS.SERVER.JOIN_ERROR, (data: { message: string }) => {
      setError(data.message);
      setIsJoining(false);
    });

    const unsubStartError = socketService.on(SOCKET_EVENTS.SERVER.START_ERROR, (data: { message: string }) => {
      setError(data.message);
    });

    return () => {
      unsubRoomCreated();
      unsubRoomJoined();
      unsubPlayerJoined();
      unsubPlayerLeft();
      unsubRoomUpdate();
      unsubHostTransferred();
      unsubRoomLeft();
      unsubGameStarted();
      unsubJoinError();
      unsubStartError();
    };
  }, [isConnected, navigate]);

  // Save player name to localStorage
  useEffect(() => {
    if (playerName) {
      localStorage.setItem('playerName', playerName);
    }
  }, [playerName]);

  // Create a new room
  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    setError(null);
    setIsCreating(true);
    socketService.createRoom(playerName.trim());
  };

  // Join an existing room
  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }
    setError(null);
    setIsJoining(true);
    socketService.joinRoom(roomCode.trim().toUpperCase(), playerName.trim());
  };

  // Leave current room
  const handleLeaveRoom = () => {
    socketService.leaveRoom();
    setRoom(null);
  };

  // Start the game (host only)
  const handleStartGame = () => {
    socketService.startGame();
  };

  const currentPlayer = getCurrentPlayer();
  const isHost = currentPlayer?.isHost || false;
  const canStart = room && room.players.length >= 2;

  // Connection screen
  if (isConnecting) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center">
        <Card className="w-[400px] bg-slate-800 border-slate-700">
          <CardContent className="pt-6 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-300">Connecting to server...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not connected screen
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center">
        <Card className="w-[400px] bg-slate-800 border-slate-700">
          <CardContent className="pt-6 text-center">
            <p className="text-red-400 mb-4">Failed to connect to server</p>
            <Button onClick={() => socketService.connect()} variant="outline">
              Retry Connection
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // In a room - show lobby
  if (room) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <Card className="w-[500px] bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-2xl text-white">Game Lobby</CardTitle>
                <CardDescription className="text-slate-400">
                  Room Code: <span className="text-blue-400 font-mono text-lg">{room.code}</span>
                </CardDescription>
              </div>
              <Badge variant={room.status === 'waiting' ? 'secondary' : 'default'}>
                {room.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Player List */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3">
                Players ({room.players.length}/{room.maxPlayers})
              </h3>
              <div className="space-y-2">
                {room.players.map((player) => (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      player.id === socketService.getSocketId()
                        ? 'bg-blue-900/30 border border-blue-700'
                        : 'bg-slate-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-white font-medium">{player.name}</span>
                      {player.id === socketService.getSocketId() && (
                        <Badge variant="outline" className="text-xs">You</Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {player.isHost && (
                        <Badge className="bg-yellow-600">Host</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Waiting message */}
            {!canStart && (
              <p className="text-center text-slate-400 text-sm">
                Waiting for more players... (minimum 2 required)
              </p>
            )}

            {/* Error message */}
            {error && (
              <p className="text-center text-red-400 text-sm">{error}</p>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleLeaveRoom}
                variant="outline"
                className="flex-1"
              >
                Leave Room
              </Button>
              {isHost && (
                <Button
                  onClick={handleStartGame}
                  disabled={!canStart}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  Start Game
                </Button>
              )}
            </div>

            {!isHost && (
              <p className="text-center text-slate-500 text-sm">
                Waiting for host to start the game...
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not in a room - show create/join options
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <Card className="w-[450px] bg-slate-800 border-slate-700">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl text-white">Qbitrig Multiplayer</CardTitle>
          <CardDescription className="text-slate-400">
            Create or join a game room
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Player Name */}
          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 block">
              Your Name
            </label>
            <Input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              className="bg-slate-700 border-slate-600 text-white"
              maxLength={20}
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-center text-red-400 text-sm">{error}</p>
          )}

          {/* Create Room */}
          <Button
            onClick={handleCreateRoom}
            disabled={isCreating || !playerName.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {isCreating ? 'Creating...' : 'Create New Room'}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-600" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-800 px-2 text-slate-400">Or</span>
            </div>
          </div>

          {/* Join Room */}
          <div className="space-y-3">
            <Input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="Enter room code"
              className="bg-slate-700 border-slate-600 text-white text-center font-mono tracking-widest"
              maxLength={6}
            />
            <Button
              onClick={handleJoinRoom}
              disabled={isJoining || !playerName.trim() || !roomCode.trim()}
              variant="outline"
              className="w-full"
            >
              {isJoining ? 'Joining...' : 'Join Room'}
            </Button>
          </div>

          {/* Single Player Option */}
          <div className="pt-4 border-t border-slate-700">
            <Button
              onClick={() => navigate('/game', { state: { singlePlayer: true } })}
              variant="ghost"
              className="w-full text-slate-400 hover:text-white"
            >
              Play Single Player (Practice)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Lobby;
