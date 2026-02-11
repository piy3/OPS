/**
 * Teacher's Dashboard for creating and managing game rooms
 * Teacher creates room, students join via code, teacher spectates during game
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import socketService, { SOCKET_EVENTS, Room, Player } from '@/services/SocketService';
import logger from '@/utils/logger';

const Dashboard = () => {
  const navigate = useNavigate();

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedMinutes, setSelectedMinutes] = useState<number>(6);

  // Room state
  const [room, setRoom] = useState<Room | null>(null);
  const [quizId, setQuizId] = useState('');
  
  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

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
      logger.game('Room created (teacher):', data);
      setRoom(data.room);
      setIsCreating(false);
      setError(null);
    });

    // Another player joined
    const unsubPlayerJoined = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_JOINED, (data: { player: Player; room: Room }) => {
      logger.player('Player joined:', data.player.name);
      setRoom(data.room);
    });

    // Player left
    const unsubPlayerLeft = socketService.on(SOCKET_EVENTS.SERVER.PLAYER_LEFT, (data: { playerId: string; room: Room }) => {
      logger.player('Player left:', data.playerId);
      setRoom(data.room);
    });

    // Room update
    const unsubRoomUpdate = socketService.on(SOCKET_EVENTS.SERVER.ROOM_UPDATE, (data: { room: Room }) => {
      setRoom(data.room);
    });

    // Game started - navigate to teacher game view
    const unsubGameStarted = socketService.on(SOCKET_EVENTS.SERVER.GAME_STARTED, (data: any) => {
      logger.game('Game started (teacher view):', data);
      navigate('/dashboard/game', { state: { room: data.room, gameState: data.gameState } });
    });

    // Error handling
    const unsubStartError = socketService.on(SOCKET_EVENTS.SERVER.START_ERROR, (data: { message: string }) => {
      setError(data.message);
    });

    return () => {
      unsubRoomCreated();
      unsubPlayerJoined();
      unsubPlayerLeft();
      unsubRoomUpdate();
      unsubGameStarted();
      unsubStartError();
    };
  }, [isConnected, navigate]);


  // Create a new room as teacher
  const handleCreateRoom = () => {
    setError(null);
    setIsCreating(true);
    const totalRounds = Math.round(selectedMinutes * (4/3));
    // Pass isTeacher: true to create room as teacher
    socketService.createRoom('', 30, quizId.trim() || undefined, true, totalRounds);
  };

  // Start the game (teacher is host)
  const handleStartGame = () => {
    socketService.startGame();
  };

  const handleGameRounds = (minutes: number) => {
    setSelectedMinutes(minutes);
  }

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

  // Room created - show waiting room with prominent room code
  if (room) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <Card className="w-[600px] bg-slate-800 border-slate-700">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-white">Teacher Dashboard</CardTitle>
            <CardDescription className="text-slate-400">
              Share the room code with your students
            </CardDescription>
            {(room as Room & { totalRounds?: number }).totalRounds != null && (
            <p className="text-slate-500 text-sm">
                Game: {(room as Room & { totalRounds?: number }).totalRounds} rounds
            </p>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Prominent Room Code Display */}
            <div className="text-center py-6 bg-slate-700/50 rounded-xl border border-slate-600">
              <p className="text-slate-400 text-sm uppercase tracking-wider mb-2">Room Code</p>
              <p className="text-6xl font-mono font-bold text-blue-400 tracking-[0.3em]">
                {room.code}
              </p>
              <p className="text-slate-500 text-sm mt-3">
                Students can join at <span className="text-cyan-400">/lobby</span>
              </p>
            </div>

            {/* Player Count */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-700/30 rounded-lg">
              <span className="text-slate-300 font-medium">Players Joined</span>
              <Badge variant="secondary" className="text-lg px-4 py-1">
                {room.players.length}
              </Badge>
            </div>

            {/* Player List */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3">
                Student List
              </h3>
              {room.players.length === 0 ? (
                <div className="text-center py-8 text-slate-500 bg-slate-700/20 rounded-lg border border-dashed border-slate-600">
                  <p>Waiting for students to join...</p>
                  <p className="text-sm mt-1">Share the room code above</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {room.players.map((player, index) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500 font-mono w-6">{index + 1}.</span>
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-white font-medium">{player.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Waiting message */}
            {!canStart && (
              <p className="text-center text-amber-400 text-sm">
                Need at least 2 players to start the game
              </p>
            )}

            {/* Error message */}
            {error && (
              <p className="text-center text-red-400 text-sm">{error}</p>
            )}

            {/* Start Game Button */}
            <Button
              onClick={handleStartGame}
              disabled={!canStart}
              className="w-full py-6 text-xl bg-green-600 hover:bg-green-700 disabled:bg-slate-600"
            >
              {canStart ? 'Start Game' : 'Waiting for Players...'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not in a room - show create room form
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <Card className="w-[450px] bg-slate-800 border-slate-700">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl text-white">Teacher Dashboard</CardTitle>
          <CardDescription className="text-slate-400">
            Create a room for your class
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

        {/* Game length: minutes → rounds = minutes * (4/3) */}
        <div className="space-y-2">
        <label className="text-sm font-medium text-slate-300 block">Game length</label>
        <div className="flex gap-2 flex-wrap">
            {([6, 9, 12] as const).map((min) => {
            const isSelected = selectedMinutes === min;
            return (
                <Button
                key={min}
                type="button"
                variant={isSelected ? "default" : "outline"}
                className={`rounded-full px-4 py-2 ${
                    isSelected ? "bg-blue-600 hover:bg-blue-700 text-white" : "border-slate-200 text-slate-300"
                }`}
                onClick={() => handleGameRounds(min)}
                >
                {min} min
                </Button>
            );
            })}
        </div>
        </div>

          {/* Quiz ID - Optional */}
          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 block">
              Quiz ID (optional)
            </label>
            <Input
              value={quizId}
              onChange={(e) => setQuizId(e.target.value)}
              placeholder="Quizizz quiz ID for blitz/unfreeze"
              className="bg-slate-700 border-slate-600 text-white font-mono"
            />
            <p className="text-slate-500 text-xs mt-1">
              Leave empty to use default questions
            </p>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-center text-red-400 text-sm">{error}</p>
          )}

          {/* Create Room Button */}
          <Button
            onClick={handleCreateRoom}
            disabled={isCreating}
            className="w-full py-6 text-lg bg-blue-600 hover:bg-blue-700"
          >
            {isCreating ? 'Creating Room...' : 'Create Room'}
          </Button>

          <p className="text-center text-slate-500 text-sm">
            You will spectate while students play
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
