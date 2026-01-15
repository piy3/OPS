# Unicorn (Villain) Feature

## Overview

The unicorn feature adds a "tag" or "villain" mechanic to the multiplayer maze game. One player is designated as the unicorn (villain) who can "catch" other players through collision detection.

## How It Works

### Backend Implementation

#### 1. Player Object Structure
Each player now has an `isUnicorn` field:

```javascript
{
  id: "socket_id",
  name: "Player Name",
  isHost: false,
  isUnicorn: true/false  // NEW: Unicorn status
}
```

#### 2. Room Object Structure
Room now tracks the current unicorn:

```javascript
{
  code: "ABC123",
  hostId: "socket_id",
  players: [...],
  status: "playing",
  unicornId: "socket_id",  // NEW: Current unicorn player ID
  ...
}
```

#### 3. Unicorn Assignment

**On Game Start:**
- First player in the room is automatically assigned as unicorn
- `RoomManager.startGame()` sets `players[0].isUnicorn = true`

**On Unicorn Disconnect:**
- If unicorn leaves or disconnects, a random remaining player becomes the new unicorn
- `RoomManager.removePlayerFromRoom()` handles transfer
- All players are notified via `unicorn_transferred` event

#### 4. Position Tracking with Unicorn Status

**Position Update Structure:**
```javascript
{
  x: 100,
  y: 200,
  row: 5,
  col: 10,
  playerId: "socket_id",
  timestamp: 1234567890,
  isWrap: false,
  isUnicorn: true/false  // NEW: Included in position updates
}
```

**GameStateManager:**
- Reads `isUnicorn` status from room's player object
- Includes it in position state
- Broadcasts unicorn status to all clients

#### 5. Collision Detection

Located in `GameStateManager.checkUnicornCollision()`:

```javascript
checkUnicornCollision(roomCode, unicornId, unicornPosition) {
  const collisionRadius = 30; // pixels
  
  // Check each non-unicorn player
  room.players.forEach(player => {
    if (player.isUnicorn) return; // Skip unicorn
    
    const distance = calculateDistance(unicornPos, playerPos);
    
    if (distance < collisionRadius) {
      // Collision detected!
      console.log(`Unicorn caught player ${player.id}!`);
      
      // TODO: Add your game logic here:
      // - Remove caught player
      // - Update scores
      // - Emit caught event
      // - etc.
    }
  });
}
```

**When Called:**
- Every time unicorn sends position update
- Automatic collision check for all players in room
- **Logic currently blank** - ready for customization

### Frontend Implementation

#### 1. Unicorn Tracking

**SocketContext:**
```javascript
const [unicornId, setUnicornId] = useState(null);
```

**Event Listeners:**
- `game_started` - Sets initial unicorn from `room.unicornId`
- `unicorn_transferred` - Updates unicorn when transferred
- `player_position_update` - Includes `isUnicorn` status

#### 2. Visual Distinction

**Unicorn Player Appearance:**
- **Color:** Purple gradient (`#667eea` to `#764ba2`)
- **Effect:** Pulsing glow animation
- **Size:** Slightly larger (scales 1.0 to 1.1)
- **Shadow:** Enhanced purple glow

**CSS Classes:**
```css
.unicorn-player {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 0 20px rgba(102, 126, 234, 0.8), 
              0 0 40px rgba(118, 75, 162, 0.6);
  animation: unicornPulse 2s ease-in-out infinite;
}
```

**Player Name Tag:**
- Unicorn emoji prefix: `🦄 Player Name`
- Purple gradient background
- Distinct from normal players (green) and local player (yellow)

#### 3. HUD Indicator

If you are the unicorn:
```
🦄 You are the Unicorn!
```

Appears in the game HUD with pulsing animation.

## Socket Events

### Server → Client Events

#### `unicorn_transferred`
**Emitted when:** Unicorn disconnects or leaves
**Payload:**
```javascript
{
  newUnicornId: "socket_id",
  room: { /* updated room object */ }
}
```

**Purpose:** Notify all players about new unicorn

## Flow Diagrams

### Game Start Flow
```
Host starts game
    ↓
Backend: Assign first player as unicorn
    ↓
Backend: Set room.unicornId
    ↓
Backend: Emit 'game_started' with unicornId
    ↓
Frontend: Set unicornId in context
    ↓
Frontend: Render unicorn player with purple style
```

### Unicorn Disconnect Flow
```
Unicorn player disconnects
    ↓
Backend: Detect unicorn left
    ↓
Backend: Randomly select new unicorn
    ↓
Backend: Update room.unicornId
    ↓
Backend: Emit 'unicorn_transferred'
    ↓
Frontend: Update unicornId
    ↓
Frontend: Re-render with new unicorn visual
```

### Collision Detection Flow
```
Unicorn moves
    ↓
Frontend: Send position update
    ↓
Backend: Receive unicorn position
    ↓
Backend: checkUnicornCollision() runs
    ↓
Backend: Calculate distances to all players
    ↓
If distance < 30px:
    ↓
Backend: Collision detected!
    ↓
Backend: TODO - Run your game logic here
```

## Player Types Visually

| Player Type | Color | Indicator | Animation |
|------------|-------|-----------|-----------|
| Local Player (Normal) | Yellow | None | None |
| Local Player (Unicorn) | Purple Gradient | 🦄 in HUD | Pulsing glow |
| Remote Player (Normal) | Green | None | None |
| Remote Player (Unicorn) | Purple Gradient | 🦄 in name | Pulsing glow |

## Customization Points

### 1. Collision Radius
Located in `GameStateManager.checkUnicornCollision()`:
```javascript
const collisionRadius = 30; // Adjust this value
```

### 2. Unicorn Selection
Currently random. Modify in `RoomManager.removePlayerFromRoom()`:
```javascript
// Current: Random selection
const randomIndex = Math.floor(Math.random() * room.players.length);

// Alternative: Next player in line
const nextPlayer = room.players[0];

// Alternative: Player with highest score
const highestScorePlayer = room.players.sort(...)[0];
```

### 3. Collision Logic
Add your game logic in `GameStateManager.checkUnicornCollision()`:
```javascript
if (distance < collisionRadius) {
  // Option 1: Remove caught player
  // removePlayerFromGame(player.id);
  
  // Option 2: Transfer unicorn status
  // roomManager.transferUnicorn(roomCode, player.id);
  
  // Option 3: Reduce player lives
  // player.lives -= 1;
  
  // Option 4: Update scores
  // unicorn.score += 10;
  // player.score -= 5;
  
  // Emit caught event to all players
  // io.to(roomCode).emit('player_caught', {
  //   unicornId, 
  //   caughtPlayerId: player.id
  // });
}
```

### 4. Visual Styling
Modify in `Frontend/src/App.css`:
```css
.unicorn-player {
  /* Change colors, size, effects */
  background: /* your gradient */;
  animation: /* your animation */;
}
```

## Testing

### Manual Test
1. Start backend and frontend servers
2. Create room with Player 1
3. Player 2 joins
4. Player 1 (host) starts game
5. **Expected:** Player 1 becomes unicorn (purple, pulsing)
6. Player 1 disconnects
7. **Expected:** Player 2 becomes unicorn automatically
8. Move unicorn close to another player
9. **Expected:** Collision logged in backend console

### Collision Test
1. Open browser console (backend)
2. Start game with 2+ players
3. Move unicorn player close to another
4. Watch for: `Unicorn {id} caught player {id}!`

## Future Enhancements

### Suggested Features
1. **Lives System:** Players have 3 lives, lose one when caught
2. **Unicorn Transfer on Catch:** Caught player becomes new unicorn
3. **Power-ups:** Items that make you immune or faster
4. **Score System:** Points for catching, bonus for survival time
5. **Sound Effects:** Audio when catching/getting caught
6. **Particle Effects:** Visual effects on collision
7. **Respawn System:** Caught players respawn after delay
8. **Safe Zones:** Areas where catching is disabled
9. **Multiple Unicorns:** More than one villain
10. **Team Mode:** Unicorns vs Runners

## API Reference

### RoomManager Methods

```javascript
// Transfer unicorn to specific player
transferUnicorn(roomCode, newUnicornId)

// Get current unicorn
getUnicorn(roomCode)
```

### GameStateManager Methods

```javascript
// Check collisions (called automatically)
checkUnicornCollision(roomCode, unicornId, unicornPosition)
// Returns: Array of caught player IDs
```

### Socket Context (Frontend)

```javascript
const { unicornId, setUnicornId } = useSocket();

// Check if current player is unicorn
const isUnicorn = unicornId === socketService.getSocket()?.id;
```

## Summary

✅ **Complete Features:**
- Unicorn assignment on game start
- Unicorn status in position updates
- Auto unicorn transfer on disconnect
- Visual distinction (purple, pulsing)
- HUD indicator for unicorn
- Collision detection framework
- Event synchronization

⏳ **Ready for Customization:**
- Collision game logic (currently blank)
- What happens when caught
- Score/lives system
- Additional game mechanics

The foundation is complete and ready for your custom game logic!
