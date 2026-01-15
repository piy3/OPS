# Game Logic Implementation Guide

## Overview

This document explains how to implement position-based multiplayer game logic using the socket server.

## Your Proposed Flow (✅ Implemented)

1. ✅ **Users send updated position** → `update_position` event
2. ✅ **Server finds room** → Validates player is in room
3. ✅ **Server emits to room** → Broadcasts position to other players

## Enhanced Implementation

The basic flow is implemented with additional features for production-ready multiplayer:

### ✅ What's Implemented

1. **Position Updates** (`update_position`)
   - Rate limiting (60 updates/second max)
   - Position validation (bounds checking)
   - Automatic throttling to prevent spam

2. **Game State Management**
   - Tracks all player positions per room
   - Timestamps for lag compensation
   - State synchronization for late joiners

3. **Automatic Cleanup**
   - Removes player positions on disconnect
   - Cleans up room state when empty

4. **State Synchronization**
   - `get_game_state` for late joiners
   - Full state sync on game start

## Flow Diagram

```
┌─────────────┐
│   Client    │
│  Updates    │
│  Position   │
└──────┬──────┘
       │
       │ emit('update_position', { x, y, ... })
       ▼
┌─────────────────┐
│  Server Handler │
│ (gameHandlers)  │
└──────┬──────────┘
       │
       ├─► Validate room exists
       ├─► Check game is playing
       ├─► Rate limit check
       ├─► Validate position bounds
       │
       ▼
┌─────────────────┐
│ GameStateManager│
│  Store Position │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Broadcast to    │
│ Other Players   │
│ in Room         │
└─────────────────┘
```

## Client Implementation

### 1. Connect to Server

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');
```

### 2. Create/Join Room

```javascript
// Create room
socket.emit('create_room', { 
    name: 'Player1', 
    maxPlayers: 9 
});

socket.on('room_created', (data) => {
    console.log('Room created:', data.roomCode);
});

// OR join room
socket.emit('join_room', { 
    roomCode: 'ABC123', 
    playerName: 'Player2' 
});
```

### 3. Start Game (Host Only)

```javascript
socket.on('game_started', (data) => {
    console.log('Game started!', data.gameState);
    // Initialize your game with the gameState
    initializeGame(data.gameState);
});

// Host starts game
socket.emit('start_game');
```

### 4. Send Position Updates

```javascript
// In your game loop (e.g., requestAnimationFrame)
function gameLoop() {
    // Update your local player position
    player.x += velocityX;
    player.y += velocityY;
    
    // Send position to server (throttled automatically)
    socket.emit('update_position', {
        x: player.x,
        y: player.y,
        angle: player.angle,      // Optional
        velocity: player.velocity, // Optional
        state: 'moving'           // Optional
    });
    
    requestAnimationFrame(gameLoop);
}
```

### 5. Receive Position Updates

```javascript
socket.on('player_position_update', (data) => {
    const { playerId, position } = data;
    
    // Update remote player position
    if (remotePlayers[playerId]) {
        remotePlayers[playerId].x = position.x;
        remotePlayers[playerId].y = position.y;
        remotePlayers[playerId].angle = position.angle;
        // ... update other properties
    }
});
```

### 6. Handle Late Joining / Reconnection

```javascript
// Request full game state when joining mid-game
socket.emit('get_game_state');

socket.on('game_state_sync', (data) => {
    if (data.gameState) {
        // Sync all player positions
        data.gameState.players.forEach(player => {
            if (player.position) {
                updateRemotePlayer(player.id, player.position);
            }
        });
    }
});
```

## Server Events Reference

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `update_position` | `{ x, y, angle?, velocity?, state? }` | Send player position update |
| `get_game_state` | None | Request full game state |
| `game_action` | `{ type, data }` | Send non-position game actions |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `player_position_update` | `{ playerId, position }` | Position update from another player |
| `game_state_sync` | `{ gameState }` | Full game state for synchronization |
| `game_started` | `{ room, gameState }` | Game started with initial state |

## Position Data Structure

```javascript
{
    x: number,           // Required: X coordinate
    y: number,           // Required: Y coordinate
    angle: number,       // Optional: Rotation angle
    velocity: {          // Optional: Velocity vector
        x: number,
        y: number
    },
    state: string        // Optional: Player state ('idle', 'moving', etc.)
}
```

## Rate Limiting

- **Max Updates**: 60 per second per player
- **Update Interval**: ~16.67ms between updates
- **Behavior**: Updates sent faster than this are automatically throttled

## Position Validation

Positions are automatically clamped to valid ranges:
- Default: -10000 to 10000 (configurable in `GAME_CONFIG.POSITION_VALIDATION`)

## Complete Example

```javascript
// Complete client-side implementation
class MultiplayerGame {
    constructor() {
        this.socket = io('http://localhost:3000');
        this.localPlayer = { x: 0, y: 0 };
        this.remotePlayers = {};
        this.setupSocketHandlers();
    }
    
    setupSocketHandlers() {
        // Room events
        this.socket.on('room_created', (data) => {
            console.log('Room:', data.roomCode);
        });
        
        this.socket.on('game_started', (data) => {
            console.log('Game started!');
            this.initializeGame(data.gameState);
        });
        
        // Position updates
        this.socket.on('player_position_update', (data) => {
            this.updateRemotePlayer(data.playerId, data.position);
        });
        
        // State sync
        this.socket.on('game_state_sync', (data) => {
            if (data.gameState) {
                this.syncGameState(data.gameState);
            }
        });
    }
    
    initializeGame(gameState) {
        // Initialize game with starting positions
        if (gameState && gameState.players) {
            gameState.players.forEach(player => {
                if (player.position) {
                    this.remotePlayers[player.id] = {
                        x: player.position.x,
                        y: player.position.y
                    };
                }
            });
        }
        this.startGameLoop();
    }
    
    updateRemotePlayer(playerId, position) {
        if (!this.remotePlayers[playerId]) {
            this.remotePlayers[playerId] = {};
        }
        this.remotePlayers[playerId].x = position.x;
        this.remotePlayers[playerId].y = position.y;
        // Update other properties as needed
    }
    
    syncGameState(gameState) {
        gameState.players.forEach(player => {
            if (player.position) {
                this.updateRemotePlayer(player.id, player.position);
            }
        });
    }
    
    startGameLoop() {
        const loop = () => {
            // Update local player (your game logic)
            this.updateLocalPlayer();
            
            // Send position to server
            this.socket.emit('update_position', {
                x: this.localPlayer.x,
                y: this.localPlayer.y
            });
            
            // Render game
            this.render();
            
            requestAnimationFrame(loop);
        };
        loop();
    }
    
    updateLocalPlayer() {
        // Your game logic here
        // e.g., handle input, apply physics, etc.
    }
    
    render() {
        // Render local player
        // Render remote players from this.remotePlayers
    }
}
```

## Additional Considerations

### 1. **Interpolation** (Recommended)
For smooth movement, interpolate between received positions:
```javascript
// Store target position
remotePlayer.targetX = position.x;
remotePlayer.targetY = position.y;

// Interpolate in render loop
remotePlayer.x += (remotePlayer.targetX - remotePlayer.x) * 0.2;
remotePlayer.y += (remotePlayer.targetY - remotePlayer.y) * 0.2;
```

### 2. **Lag Compensation**
Use timestamps from position updates to handle network delay:
```javascript
socket.on('player_position_update', (data) => {
    const latency = Date.now() - data.position.timestamp;
    // Adjust position based on latency
});
```

### 3. **Client-Side Prediction**
Update local player immediately, then correct if server disagrees:
```javascript
// Update immediately
player.x += velocityX;

// Send to server
socket.emit('update_position', { x: player.x, y: player.y });

// If server corrects, adjust
socket.on('position_corrected', (corrected) => {
    player.x = corrected.x;
    player.y = corrected.y;
});
```

### 4. **Error Handling**
```javascript
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    // Handle reconnection logic
});
```

## Testing

1. **Start Server**: `npm run dev`
2. **Open Multiple Clients**: Test with 2+ browser tabs
3. **Create Room**: First client creates room
4. **Join Room**: Other clients join with room code
5. **Start Game**: Host starts game
6. **Move Players**: Send position updates and verify they appear for other players

## Summary

✅ **Your flow is implemented and enhanced with:**
- Rate limiting to prevent spam
- Position validation for security
- State synchronization for late joiners
- Automatic cleanup on disconnect
- Full game state management

The server is ready to handle position updates efficiently and reliably!
