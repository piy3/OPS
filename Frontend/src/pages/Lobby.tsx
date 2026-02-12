/**
 * Lobby page for players to join a game.
 * Players join with room code from teacher; see player list and wait for host to start.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import socketService, { SOCKET_EVENTS, Room, Player } from '@/services/SocketService';
import logger from '@/utils/logger';

const LOBBY_BG_IMAGE = `${import.meta.env.BASE_URL}backgroundLobby.png`;

/** Full-screen lobby background: image + overlay for readability */
const LobbyBackground = () => (
  <>
    <div
      className="absolute inset-0 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${LOBBY_BG_IMAGE})` }}
      aria-hidden
    />
    <div className="absolute inset-0 bg-black/50" aria-hidden />
  </>
);

const Lobby = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Room state
  const [room, setRoom] = useState<Room | null>(null);
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('playerName') || '';
  });
  const [roomCode, setRoomCode] = useState('');

  // Pre-fill join code from URL query param: ?code=MAZABCD
  useEffect(() => {
    const codeFromUrl = searchParams.get('code');
    if (codeFromUrl?.trim()) {
      setRoomCode(codeFromUrl.trim().toUpperCase());
    }
  }, [searchParams]);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(true);

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

  // When returning from game over, request current room so we show in-room UI without having left the room
  useEffect(() => {
    if (!isConnected) return;
    const returnFromGameOver = (location.state as { returnFromGameOver?: boolean } | null)?.returnFromGameOver;
    if (returnFromGameOver) {
      socketService.requestRoomInfo();
    }
  }, [isConnected, location.state]);

  // Set up socket event listeners
  useEffect(() => {
    if (!isConnected) return;

    // Room info (response to requestRoomInfo; e.g. after return from game over)
    const unsubRoomInfo = socketService.on(SOCKET_EVENTS.SERVER.ROOM_INFO, (data: { room: Room | null }) => {
      setRoom(data.room ?? null);
    });

    // Room joined successfully
    const unsubRoomJoined = socketService.on(SOCKET_EVENTS.SERVER.ROOM_JOINED, (data: { roomCode: string; room: Room }) => {
      logger.game('Room joined:', data);
      setRoom(data.room);
      setIsJoining(false);
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
      logger.game('Game started:', data);
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
      unsubRoomInfo();
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
      <div className="relative min-h-screen flex items-center justify-center">
        <LobbyBackground />
        <Card className="relative z-10 w-[400px] bg-card border-border">
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
      <div className="relative min-h-screen flex items-center justify-center">
        <LobbyBackground />
        <Card className="relative z-10 w-[400px] bg-card border-border">
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

  // In a room - show lobby and How to Play
  if (room) {
    return (
      <div className="relative min-h-screen flex items-center justify-center p-4 flex-wrap gap-6">
        <LobbyBackground />
        <Card className="relative z-10 w-[500px] bg-card border-border shadow-xl shadow-black/20">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-2xl text-foreground">Game Lobby</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Room Code: <span className="text-cream font-mono text-lg font-semibold">{room.code}</span>
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
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Players ({room.players.length}/{room.maxPlayers})
              </h3>
              <div className="space-y-2">
                {room.players.map((player) => (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      player.id === socketService.getSocketId()
                        ? 'bg-wine-600/40 border border-cream/30'
                        : 'bg-muted/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-wine-600 flex items-center justify-center text-cream font-bold">
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-foreground font-medium">{player.name}</span>
                      {player.id === socketService.getSocketId() && (
                        <Badge variant="outline" className="text-xs border-cream/50 text-cream">You</Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {player.isHost && (
                        <Badge className="bg-cream text-wine-800">Host</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Waiting message */}
            {!canStart && (
              <p className="text-center text-muted-foreground text-sm">
                Waiting for more players... (minimum 2 required)
              </p>
            )}

            {/* Error message */}
            {error && (
              <p className="text-center text-destructive text-sm">{error}</p>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleLeaveRoom}
                variant="outline"
                className="flex-1 border-cream/40 text-cream hover:bg-wine-600"
              >
                Leave Room
              </Button>
              {isHost && (
                <Button
                  onClick={handleStartGame}
                  disabled={!canStart}
                  className="flex-1 bg-cream text-wine-800 hover:bg-cream-muted font-semibold"
                >
                  Start Game
                </Button>
              )}
            </div>

            {!isHost && (
              <p className="text-center text-muted-foreground text-sm">
                Waiting for host to start the game...
              </p>
            )}
          </CardContent>
        </Card>

        {/* How to Play panel */}
        {showHowToPlay ? (
          <Card className="relative z-10 w-[380px] bg-card border-border rounded-xl shadow-xl shadow-black/20">
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 text-muted-foreground hover:text-cream h-8 w-8 p-0"
              onClick={() => setShowHowToPlay(false)}
              aria-label="Close"
            >
              ✕
            </Button>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-bold text-center text-cream">
                HOW TO PLAY
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-2">
              <div>
                <div className='text-center mb-2'>
                  <span className='uppercase text-cream text-xl font-bold'>Collect most coins to win!</span> <br />
                  <span className='uppercase text-cream-muted text-lg font-bold'>Enforcers get coins on tagging!</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-bold text-cream">MOVEMENT</span>
                </div>
                <div className="flex gap-1.5 mb-1.5 flex-wrap">
                  <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">↑</kbd>
                  <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">↓</kbd>
                  <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">←</kbd>
                  <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">→</kbd>
                </div>
                <p className="text-muted-foreground text-xs mb-1">or</p>
                <div className="flex gap-1.5 flex-wrap">
                  <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">W</kbd>
                  <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">A</kbd>
                  <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">S</kbd>
                  <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">D</kbd>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-wine-600 flex items-center justify-center text-cream text-lg font-bold">C</div>
                  <span className="font-bold text-cream">DEPLOY SINK</span>
                </div>
                <p className="text-muted-foreground text-xs mt-1">Place a sink trap (need sink in inventory)</p>
              </div>
              <div className='border border-border p-2 rounded-xl'>
                <span className='italic text-sm text-muted-foreground'>Look at top left corner for game information in hunt phase!</span>
                <img className='' src={`${import.meta.env.BASE_URL}infoCard.png`} alt="info_card" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button
            variant="outline"
            className="relative z-10 border-cream/40 text-muted-foreground hover:text-cream hover:bg-wine-600"
            onClick={() => setShowHowToPlay(true)}
          >
            Show How to Play
          </Button>
        )}
      </div>
    );
  }

  // Not in a room - show join form and How to Play
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 flex-wrap gap-6">
      <LobbyBackground />
      <Card className="relative z-10 w-[450px] bg-card border-border shadow-xl shadow-black/20">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl text-foreground">Join a game</CardTitle>
          <CardDescription className="text-muted-foreground">
            Enter the room code from your teacher to join the game
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Player Name */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Your Name
            </label>
            <Input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              maxLength={20}
            />
          </div>

          {/* Room code */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Room Code
            </label>
            <Input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="e.g. MAZABCD"
              className="bg-muted border-border text-foreground text-center font-mono tracking-widest placeholder:text-muted-foreground"
              maxLength={7}
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-center text-destructive text-sm">{error}</p>
          )}

          <Button
            onClick={handleJoinRoom}
            disabled={isJoining || !playerName.trim() || !roomCode.trim()}
            className="w-full bg-cream text-wine-800 hover:bg-cream-muted font-semibold"
          >
            {isJoining ? 'Joining...' : 'Join Room'}
          </Button>
        </CardContent>
      </Card>

      {/* How to Play panel - same as in-room view */}
      {showHowToPlay ? (
        <Card className="relative z-10 w-[380px] bg-card border-border rounded-xl shadow-xl shadow-black/20">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 text-muted-foreground hover:text-cream h-8 w-8 p-0"
            onClick={() => setShowHowToPlay(false)}
            aria-label="Close"
          >
            ✕
          </Button>
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-bold text-center text-cream">
              HOW TO PLAY
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">
            <div>
              <div className='text-center mb-2'>
                <span className='uppercase text-cream text-xl font-bold'>Collect most coins to win!</span> <br />
                <span className='uppercase text-cream-muted text-lg font-bold'>Enforcers get coins on tagging!</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-bold text-cream">MOVEMENT</span>
              </div>
              <div className="flex gap-1.5 mb-1.5 flex-wrap">
                <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">↑</kbd>
                <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">↓</kbd>
                <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">←</kbd>
                <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">→</kbd>
              </div>
              <p className="text-muted-foreground text-xs mb-1">or</p>
              <div className="flex gap-1.5 flex-wrap">
                <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">W</kbd>
                <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">A</kbd>
                <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">S</kbd>
                <kbd className="px-2.5 py-1.5 rounded-md bg-wine-600 text-cream text-xs font-medium shadow">D</kbd>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-wine-600 flex items-center justify-center text-cream text-lg font-bold">C</div>
                <span className="font-bold text-cream">DEPLOY SINK</span>
              </div>
              <p className="text-muted-foreground text-xs mt-1">Place a sink trap (need sink in inventory)</p>
            </div>
            <div className='border border-border p-2 rounded-xl'>
              <span className='italic text-sm text-muted-foreground'>Look at top left corner for game information in hunt phase!</span>
              <img className='' src={`${import.meta.env.BASE_URL}infoCard.png`} alt="info_card" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          className="relative z-10 border-cream/40 text-muted-foreground hover:text-cream hover:bg-wine-600"
          onClick={() => setShowHowToPlay(true)}
        >
          Show How to Play
        </Button>
      )}
    </div>
  );
};

export default Lobby;
