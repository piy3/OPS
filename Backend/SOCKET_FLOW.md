# Socket.IO Room Management Flow

## Overview
This document describes the complete flow for room creation, joining, and game management using Socket.IO.

## Flow Diagram

```
┌─────────────┐
│   Player    │
│  Connects   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Socket Connected│
│ (socket.id assigned)
└──────┬──────────┘
       │
       ├─────────────────┬─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Create Room│  │  Join Room  │  │ Get Room    │
│            │  │  (by code)  │  │   Info      │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                 │
       ▼                ▼                 │
┌─────────────┐  ┌─────────────┐         │
│ Room Created│  │ Room Joined │         │
│ (6-char code)│  │ (validated) │         │
└──────┬──────┘  └──────┬──────┘         │
       │                │                 │
       └────────┬───────┴─────────────────┘
                │
                ▼
        ┌───────────────┐
        │  Room State   │
        │  (waiting)    │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │  Start Game   │
        │  (host only)  │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │  Game Events  │
        │  (playing)    │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │ Disconnect /  │
        │  Leave Room   │
        └───────────────┘
```

## Socket Events

### Client → Server Events

#### 1. `create_room`
**Purpose**: Create a new game room
**Payload**:
```javascript
{
  name: "Player Name",      // Optional
  maxPlayers: 4             // Optional, default: 4
}
```
**Response**: Server emits `room_created`
**Flow**:
- Server generates unique 6-character room code
- Player becomes host
- Room status set to 'waiting'
- Player automatically joins the room

#### 2. `join_room`
**Purpose**: Join an existing room using room code
**Payload**:
```javascript
{
  roomCode: "ABC123",
  playerName: "Player Name"  // Optional
}
```
**Response**: Server emits `room_joined` (to joiner) and `player_joined` (to others)
**Flow**:
- Validates room exists
- Checks room is not full
- Checks game hasn't started
- Adds player to room
- Notifies all players in room

#### 3. `leave_room`
**Purpose**: Leave current room
**Payload**: None
**Response**: Server emits `room_left`
**Flow**:
- Removes player from room
- If host leaves, assigns new host (first player)
- If room becomes empty, deletes room
- Notifies remaining players

#### 4. `start_game`
**Purpose**: Host starts the game
**Payload**: None
**Response**: Server emits `game_started` to all players
**Flow**:
- Validates player is host
- Validates at least 2 players
- Changes room status to 'playing'
- Notifies all players

#### 5. `game_action`
**Purpose**: Send in-game actions/updates
**Payload**:
```javascript
{
  // Your custom game action data
  type: "move",
  data: { x: 100, y: 200 }
}
```
**Response**: Server broadcasts to other players in room
**Flow**:
- Validates player is in room
- Validates game is playing
- Broadcasts to all other players in room

#### 6. `get_room_info`
**Purpose**: Get current room information
**Payload**: None
**Response**: Server emits `room_info`

### Server → Client Events

#### 1. `room_created`
**Emitted to**: Player who created room
**Payload**:
```javascript
{
  roomCode: "ABC123",
  room: {
    code: "ABC123",
    hostId: "socket_id",
    players: [{ id, name, isHost }],
    status: "waiting",
    createdAt: timestamp,
    maxPlayers: 4
  }
}
```

#### 2. `room_joined`
**Emitted to**: Player who joined
**Payload**: Same as `room_created`

#### 3. `player_joined`
**Emitted to**: Other players in room
**Payload**:
```javascript
{
  player: { id, name, isHost },
  room: { /* full room object */ }
}
```

#### 4. `room_update`
**Emitted to**: All players in room
**Payload**:
```javascript
{
  room: { /* updated room object */ }
}
```

#### 5. `player_left`
**Emitted to**: Remaining players in room
**Payload**:
```javascript
{
  playerId: "socket_id",
  room: { /* updated room object */ }
}
```

#### 6. `game_started`
**Emitted to**: All players in room
**Payload**:
```javascript
{
  room: { /* room object with status: 'playing' */ }
}
```

#### 7. `game_action`
**Emitted to**: Other players in room
**Payload**:
```javascript
{
  playerId: "socket_id",
  action: { /* custom action data */ }
}
```

#### 8. `host_transferred`
**Emitted to**: New host
**Payload**:
```javascript
{
  room: { /* updated room object */ }
}
```

#### 9. `room_info`
**Emitted to**: Requesting player
**Payload**:
```javascript
{
  room: { /* room object or null */ }
}
```

#### 10. Error Events
- `join_error`: Room not found, full, or game in progress
- `leave_error`: Not in any room
- `start_error`: Not host, game already started, or not enough players

## Complete Flow Example

### Scenario: Two Players Create and Join a Room

1. **Player 1 creates room**:
   ```javascript
   socket.emit('create_room', { name: 'Alice', maxPlayers: 4 });
   // Receives: room_created { roomCode: 'ABC123', room: {...} }
   ```

2. **Player 2 joins room**:
   ```javascript
   socket.emit('join_room', { roomCode: 'ABC123', playerName: 'Bob' });
   // Player 2 receives: room_joined { roomCode: 'ABC123', room: {...} }
   // Player 1 receives: player_joined { player: {...}, room: {...} }
   // Both receive: room_update { room: {...} }
   ```

3. **Host starts game**:
   ```javascript
   // Player 1 (host) emits:
   socket.emit('start_game');
   // Both players receive: game_started { room: {...} }
   ```

4. **Players send game actions**:
   ```javascript
   socket.emit('game_action', { type: 'move', x: 100, y: 200 });
   // Other players receive: game_action { playerId: '...', action: {...} }
   ```

5. **Player leaves**:
   ```javascript
   socket.emit('leave_room');
   // Receives: room_left { roomCode: 'ABC123' }
   // Other players receive: player_left { playerId: '...', room: {...} }
   ```

## Room States

- **waiting**: Room created, waiting for players/start
- **playing**: Game in progress
- **finished**: Game completed (if you implement this)

## Room Management

- **Room Code**: 6-character alphanumeric (A-Z, 0-9)
- **Max Players**: Configurable per room (default: 4)
- **Host**: First player to create room, can start game
- **Auto-cleanup**: Room deleted when empty
- **Host Transfer**: If host leaves, first remaining player becomes host

## Client Implementation Example

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

// Create room
socket.emit('create_room', { name: 'MyName', maxPlayers: 4 });
socket.on('room_created', (data) => {
  console.log('Room created:', data.roomCode);
  console.log('Room info:', data.room);
});

// Join room
socket.emit('join_room', { roomCode: 'ABC123', playerName: 'MyName' });
socket.on('room_joined', (data) => {
  console.log('Joined room:', data.roomCode);
});

// Listen for updates
socket.on('player_joined', (data) => {
  console.log('New player:', data.player.name);
});

socket.on('room_update', (data) => {
  console.log('Room updated:', data.room);
});

socket.on('game_started', (data) => {
  console.log('Game started!');
  // Start your game logic
});

// Handle errors
socket.on('join_error', (error) => {
  console.error('Join error:', error.message);
});
```
