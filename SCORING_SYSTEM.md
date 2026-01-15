# Scoring System & Leaderboard

## Overview

The game now features a coin-based scoring system where players start with 100 coins. When the unicorn catches another player, the unicorn gains 10 coins and the caught player loses 10 coins.

## Features

### 🪙 Coin System
- **Starting Coins:** 100 per player
- **Catch Reward:** Unicorn +10 coins
- **Catch Penalty:** Caught player -10 coins
- **Minimum:** 0 coins (can't go negative)

### 🏆 Leaderboard
- Real-time ranking by coins (descending)
- Top 3 highlighted (Gold, Silver, Bronze)
- Current player highlighted in gold
- Unicorn players highlighted in purple
- Toggle show/hide with button
- Smooth animations

## Backend Implementation

### Player Object Structure
```javascript
{
  id: "socket_id",
  name: "Player Name",
  isHost: false,
  isUnicorn: false,
  coins: 100  // NEW: Coin balance
}
```

### New Methods in RoomManager

#### `updatePlayerCoins(roomCode, playerId, coinChange)`
Updates a player's coin balance.
- **Parameters:**
  - `roomCode`: Room code
  - `playerId`: Player socket ID
  - `coinChange`: Amount to add/subtract (can be negative)
- **Returns:** Updated player object
- **Notes:** Prevents negative coins (minimum 0)

#### `getLeaderboard(roomCode)`
Gets players sorted by coins (descending).
- **Parameters:**
  - `roomCode`: Room code
- **Returns:** Array of players sorted by coins

### Collision Detection Logic

Located in `GameStateManager.checkUnicornCollision()`:

```javascript
// When collision detected (distance < 30px)
const unicornPlayer = roomManager.updatePlayerCoins(roomCode, unicornId, 10);
const caughtPlayer = roomManager.updatePlayerCoins(roomCode, player.id, -10);

// Emit score update to all players
io.to(roomCode).emit('score_update', {
  unicornId: unicornId,
  caughtId: player.id,
  unicornCoins: unicornPlayer?.coins,
  caughtCoins: caughtPlayer?.coins,
  room: updatedRoom,
  leaderboard: roomManager.getLeaderboard(roomCode)
});
```

### Socket Events

#### `score_update` (Server → Client)
**Emitted when:** Unicorn catches a player
**Payload:**
```javascript
{
  unicornId: "socket_id",        // Who caught
  caughtId: "socket_id",         // Who was caught
  unicornCoins: 110,             // Unicorn's new balance
  caughtCoins: 90,               // Caught player's new balance
  room: { /* updated room */ },  // Full room state
  leaderboard: [ /* sorted */ ]  // Updated leaderboard
}
```

## Frontend Implementation

### Context State
```javascript
const [leaderboard, setLeaderboard] = useState([]);
```

### Socket Listener
```javascript
socketService.onScoreUpdate((data) => {
  // Update room data
  setRoomData(data.room);
  setPlayers(data.room.players);
  
  // Update leaderboard
  setLeaderboard(data.leaderboard);
});
```

### HUD Display

**Coins Display:**
```jsx
<div className="hud-item coins-display">
  💰 {myCoins} Coins
</div>
```

**Toggle Button:**
```jsx
<button 
  className="hud-item leaderboard-toggle"
  onClick={() => setShowLeaderboard(!showLeaderboard)}
>
  {showLeaderboard ? '📊 Hide' : '📊 Show'} Leaderboard
</button>
```

### Leaderboard Component

Located in `StartGame.jsx`:

```jsx
{showLeaderboard && (
  <div className="leaderboard-container">
    <div className="leaderboard-header">
      <h3>🏆 Leaderboard</h3>
    </div>
    <div className="leaderboard-list">
      {leaderboard.map((player, index) => (
        <div className="leaderboard-item">
          <span className="rank">#{index + 1}</span>
          <span className="player-info">
            {player.isUnicorn && '🦄 '}
            {player.name}
            {player.id === myId && ' (You)'}
          </span>
          <span className="coins">💰 {player.coins}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

## Visual Design

### Leaderboard Styling

**Container:**
- Position: Fixed (top-right)
- Size: 300px width, max 500px height
- Background: Purple gradient with blur
- Animation: Slide in from right

**Rank Colors:**
- 🥇 1st Place: Gold (#FFD700) with glow
- 🥈 2nd Place: Silver (#C0C0C0) with glow
- 🥉 3rd Place: Bronze (#CD7F32) with glow
- Others: Gray

**Player Highlighting:**
- Current Player: Gold background
- Unicorn: Purple gradient background
- Hover: Slight translation left

**Coins Display:**
- Golden color (#FFD700)
- Shadow glow effect
- Bold font weight

### HUD Elements

**Coins Badge:**
- Golden gradient background
- Border with glow
- Positioned in HUD

**Toggle Button:**
- Purple background
- Hover effect
- Smooth transitions

## Flow Diagram

```
Unicorn catches player (distance < 30px)
    ↓
Backend: updatePlayerCoins()
    ├── Unicorn: +10 coins
    └── Caught: -10 coins
    ↓
Backend: getLeaderboard()
    ↓
Backend: emit('score_update', {...})
    ↓
Frontend: All clients receive update
    ↓
Frontend: Update room state
    ↓
Frontend: Update leaderboard
    ↓
Frontend: Re-render HUD and leaderboard
    ↓
Players see updated scores instantly
```

## Game State Sync

**Initial State (Game Start):**
```javascript
{
  players: [
    { id, name, coins: 100, isUnicorn },
    ...
  ],
  leaderboard: [...sorted by coins]
}
```

**State Updates:**
- Automatically on every catch
- Real-time for all players
- Sorted leaderboard maintained

## Testing

### Manual Test
1. Start game with 2+ players
2. Check initial coins: Everyone should have 100
3. Unicorn catches another player
4. **Expected:** 
   - Unicorn: 110 coins
   - Caught: 90 coins
   - Leaderboard updates
   - HUD shows new coins
5. Repeat catches
6. **Expected:** Scores update each time

### Console Verification
Backend logs when catch occurs:
```
Unicorn {id} caught player {id}! 
Coins: Unicorn +10 (110), Caught -10 (90)
```

### Leaderboard Test
1. Open leaderboard
2. Verify sorting (highest coins first)
3. Check visual highlights:
   - Your player: Gold background
   - Unicorn: Purple gradient
   - Top 3: Colored ranks
4. Toggle hide/show

## Customization

### Change Reward/Penalty
In `GameStateManager.checkUnicornCollision()`:
```javascript
// Current: +10 / -10
roomManager.updatePlayerCoins(roomCode, unicornId, 10);
roomManager.updatePlayerCoins(roomCode, player.id, -10);

// Custom: +20 / -5
roomManager.updatePlayerCoins(roomCode, unicornId, 20);
roomManager.updatePlayerCoins(roomCode, player.id, -5);
```

### Change Starting Coins
In `RoomManager.createRoom()` and `addPlayerToRoom()`:
```javascript
// Current: 100
coins: 100

// Custom: 500
coins: 500
```

### Change Collision Radius
In `GameStateManager.checkUnicornCollision()`:
```javascript
// Current: 30 pixels
const collisionRadius = 30;

// Easier catches: 50 pixels
const collisionRadius = 50;

// Harder catches: 20 pixels
const collisionRadius = 20;
```

### Styling
All styles in `Frontend/src/App.css`:
- `.leaderboard-container` - Main container
- `.leaderboard-item` - Individual entries
- `.coins-display` - HUD coins badge
- `.leaderboard-toggle` - Toggle button

## Advanced Features (Future)

### Suggested Enhancements
1. **Win Condition:** First to 200 coins wins
2. **Coin Pickups:** Collectible coins in maze
3. **Streak Bonus:** Extra coins for consecutive catches
4. **Score History:** Track score over time
5. **Achievements:** Badges for milestones
6. **Negative Scores:** Allow going below 0 (debt)
7. **Power-ups:** Buy with coins
8. **Betting System:** Wager coins on outcomes
9. **Coin Animations:** Visual feedback on score changes
10. **Sound Effects:** Audio on coin gain/loss

## Summary

✅ **Implemented:**
- Coin system (100 starting)
- Catch rewards (+10/-10)
- Real-time leaderboard
- HUD coins display
- Toggle leaderboard visibility
- Visual ranking (gold/silver/bronze)
- Player highlighting
- Smooth animations
- Socket event synchronization

✅ **Working:**
- Score updates on every catch
- Leaderboard auto-sorts
- All players see updates instantly
- No negative coins
- Persistent through game

The scoring system is fully functional and integrated with the unicorn catch mechanic! 🎮💰
