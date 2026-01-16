# Collision Detection & Freeze System

## Overview
The system detects when any player collides with the unicorn, freezes the game for all players simultaneously, and respawns the unicorn at a random valid location.

## How It Works

### 1. Backend Collision Detection
**File**: `Backend/services/GameStateManager.js`

- **Detection Method**: Grid-based collision detection
- **Trigger**: Runs on every position update from any player
- **Condition**: Player is in the same cell OR adjacent cell (within 1 cell) of the unicorn
- **Threshold**: Grid cells (row, col) - more reliable than pixel coordinates

```javascript
// Detects collision when:
// - Same cell: row === unicornRow && col === unicornCol
// - Adjacent: rowDiff <= 1 && colDiff <= 1
```

### 2. Freeze Event Broadcasting
When collision is detected:
1. Server finds a valid spawn position (no walls, no players)
2. Server broadcasts `unicorn_freeze` event to ALL players in the room
3. All players receive the event simultaneously
4. All players show the freeze popup and stop movement for 5 seconds

### 3. Unicorn Respawn
After 5 seconds:
1. Server broadcasts `unicorn_respawn` event with new position
2. Unicorn teleports to the new spawn position
3. Game resumes

## Events

### Server → Client Events

#### `unicorn_freeze`
Sent to all players when collision occurs.
```javascript
{
  unicornId: "socket_id",
  timestamp: Date.now()
}
```

#### `unicorn_respawn`
Sent to all players after 5 seconds.
```javascript
{
  unicornId: "socket_id",
  position: {
    row: 10,
    col: 15,
    x: 0,
    y: 0,
    isUnicorn: true
  }
}
```

## Frontend Implementation

### Event Listeners
**File**: `Frontend/src/components/StartGame.jsx`

```javascript
// Listen for freeze event
socketService.onUnicornFreeze((data) => {
  setIsGameFrozen(true);
  setShowFreezePopup(true);
  // Unfreeze after 5 seconds
});

// Listen for respawn event  
socketService.onUnicornRespawn((data) => {
  // Update unicorn position
});
```

### Freeze Popup
Displays for all players simultaneously:
- Message: "🦄 Game Frozen! 🦄"
- Subtext: "Unicorn collision detected!"
- Timer: "Game froze for 5 seconds"

## Technical Details

### Collision Detection Logic
```javascript
// Grid-based (reliable)
const sameCell = (unicornRow === playerRow && unicornCol === playerCol);
const isAdjacent = (rowDiff <= 1 && colDiff <= 1);
if (sameCell || isAdjacent) {
  // Trigger freeze
}
```

### Spawn Position Finding
```javascript
findValidSpawnPosition(roomCode, excludePlayerId) {
  // Try up to 100 random positions
  // Check: !isWall(row, col) && !isOccupied(row, col)
  // Returns: { row, col }
}
```

### Cooldown System
- 6 second cooldown (5s freeze + 1s buffer)
- Prevents multiple triggers during the same collision
- Tracked per room and unicorn

## Files Modified

### Backend
- `Backend/services/GameStateManager.js` - Collision detection & respawn logic
- `Backend/handlers/gameHandlers.js` - Event handlers
- `Backend/config/constants.js` - Socket event constants

### Frontend  
- `Frontend/src/components/StartGame.jsx` - Event listeners & popup
- `Frontend/src/services/socket.js` - Socket event methods
- `Frontend/src/App.css` - Freeze popup styling

## Testing

### To Test Collision:
1. Start a game with 2+ players
2. One player is the unicorn (🦄)
3. Move another player to collide with the unicorn
4. All players should see the freeze popup
5. After 5 seconds, unicorn should respawn at a new location

### Console Logs:
- Backend: "🦄 COLLISION DETECTED on server!"
- Backend: "🦄 Broadcasting freeze event to room..."
- Frontend: "🦄 Server freeze event received:"
- Frontend: "🦄 Unicorn respawned:"

## Troubleshooting

### Popup doesn't appear:
1. Check browser console for "🦄 Server freeze event received"
2. Check backend logs for "🦄 COLLISION DETECTED on server"
3. Verify `showFreezePopup` state is being set to `true`

### Unicorn doesn't respawn:
1. Check backend logs for "🦄 Broadcasting respawn event"
2. Verify `findValidSpawnPosition` is returning valid position
3. Check frontend console for "🦄 Unicorn respawned"

### Multiple triggers:
1. Cooldown should prevent this (6 second cooldown)
2. Check `lastFreezeTime` Map in GameStateManager
