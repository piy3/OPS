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
import { useParams } from 'react-router-dom';

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
  
  const { quizId: quizIdParam } = useParams<{ quizId?: string }>();
  
  useEffect(() => {
    if (quizIdParam) {
      // Build full quiz URL
      const baseURI = window.location.hostname === 'wayground.com'
        ? 'https://wayground.com/_quizserver/main'
        : 'https://dev.quizizz.com/_quizserver/main';
      const quizPath = `/v2/quiz/${quizIdParam}?convertQuestions=false&includeFsFeatures=true&sanitize=read&questionMetadata=true`;
      const fullQuizUrl = `${baseURI}${quizPath}`;
      
      // Store in localStorage
      localStorage.setItem('QUIZ_URL', fullQuizUrl);
      localStorage.setItem('QUIZ_ID', quizIdParam);
      
      // Set state
      setQuizId(quizIdParam);
    }
  }, [quizIdParam]);

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
      <div className="min-h-screen bg-gradient-to-b from-wine-900 to-wine-800 flex items-center justify-center">
        <Card className="w-[400px] bg-card border-border">
          <CardContent className="pt-6 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cream mx-auto mb-4"></div>
            <p className="text-muted-foreground">Connecting to server...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not connected screen
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-wine-900 to-wine-800 flex items-center justify-center">
        <Card className="w-[400px] bg-card border-border">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-4">Failed to connect to server</p>
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
      <div className="min-h-screen bg-gradient-to-b from-wine-900 to-wine-800 flex items-center justify-center p-4">
        <Card className="w-[600px] bg-card border-border shadow-xl shadow-black/20">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-foreground">Teacher Dashboard</CardTitle>
            <CardDescription className="text-muted-foreground">
              Share the room code with your students
            </CardDescription>
            {(room as Room & { totalRounds?: number }).totalRounds != null && (
            <p className="text-muted-foreground text-sm">
                Game: {(room as Room & { totalRounds?: number }).totalRounds} rounds
            </p>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Prominent Room Code Display */}
            <div className="text-center py-6 bg-muted/50 rounded-xl border border-border">
              <p className="text-muted-foreground text-sm uppercase tracking-wider mb-2">Room Code</p>
              <p className="text-6xl font-mono font-bold text-cream tracking-[0.3em]">
                {room.code}
              </p>
              <p className="text-muted-foreground text-sm mt-3">
                Students can join at <span className="text-cream">/lobby</span>
              </p>
            </div>

            {/* Player Count */}
            <div className="flex items-center justify-between px-4 py-3 bg-muted/30 rounded-lg">
              <span className="text-foreground font-medium">Players Joined</span>
              <Badge variant="secondary" className="text-lg px-4 py-1 bg-cream/20 text-cream border border-cream/30">
                {room.players.length}
              </Badge>
            </div>

            {/* Player List */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Student List
              </h3>
              {room.players.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
                  <p>Waiting for students to join...</p>
                  <p className="text-sm mt-1">Share the room code above</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {room.players.map((player, index) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground font-mono w-6">{index + 1}.</span>
                        <div className="w-8 h-8 rounded-full bg-wine-600 flex items-center justify-center text-cream font-bold">
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-foreground font-medium">{player.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Waiting message */}
            {!canStart && (
              <p className="text-center text-cream-muted text-sm">
                Need at least 2 players to start the game
              </p>
            )}

            {/* Error message */}
            {error && (
              <p className="text-center text-destructive text-sm">{error}</p>
            )}

            {/* Start Game Button */}
            <Button
              onClick={handleStartGame}
              disabled={!canStart}
              className="w-full py-6 text-xl bg-cream text-wine-800 hover:bg-cream-muted font-semibold disabled:opacity-50 disabled:bg-muted"
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
    <div className="min-h-screen bg-gradient-to-b from-wine-950 to-wine-800 flex items-center justify-center p-4">
      <Card className="w-[450px] bg-card border-border shadow-xl shadow-black/20">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl text-foreground">Teacher Dashboard</CardTitle>
          <CardDescription className="text-muted-foreground">
            Create a room for your class
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

        {/* Game length: minutes → rounds = minutes * (4/3) */}
        <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground block">Game length</label>
        <div className="flex gap-2 flex-wrap">
            {([6, 9, 12, 15, 18] as const).map((min) => {
            const isSelected = selectedMinutes === min;
            return (
                <Button
                key={min}
                type="button"
                variant={isSelected ? "default" : "outline"}
                className={`rounded-full px-4 py-2 ${
                    isSelected ? "bg-cream text-wine-800 hover:bg-cream-muted" : "border-cream/40 text-muted-foreground hover:text-cream"
                }`}
                onClick={() => handleGameRounds(min)}
                >
                {min} min
                </Button>
            );
            })}
        </div>
        </div>

          {/* Quiz ID - Optional
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Quiz ID (optional)
            </label>
            <Input
              value={quizId}
              onChange={(e) => setQuizId(e.target.value)}
              placeholder="Quizizz quiz ID for blitz/unfreeze"
              className="bg-muted border-border text-foreground font-mono"
            />
            <p className="text-muted-foreground text-xs mt-1">
              Leave empty to use default questions
            </p>
          </div> */}

          {/* Error message */}
          {error && (
            <p className="text-center text-destructive text-sm">{error}</p>
          )}

          {/* Create Room Button */}
          <Button
            onClick={handleCreateRoom}
            disabled={isCreating}
            className="w-full py-6 text-lg bg-cream text-wine-800 hover:bg-cream-muted font-semibold"
          >
            {isCreating ? 'Creating Room...' : 'Create Room'}
          </Button>

          <p className="text-center text-muted-foreground text-sm">
            You will spectate while students play
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
