# Quick Start Guide

## Get Started in 3 Steps

### 1. Install Dependencies

```bash
# Backend
cd OPS/Backend
npm install

# Frontend (new terminal)
cd OPS/Frontend
npm install
```

### 2. Start Servers

```bash
# Terminal 1: Start Backend
cd OPS/Backend
npm run dev
# Backend runs on http://localhost:3000

# Terminal 2: Start Frontend
cd OPS/Frontend
npm run dev
# Frontend runs on http://localhost:5173
```

### 3. Play!

1. Open `http://localhost:5173` in your browser
2. Enter your name
3. Click **"Create Room"** or **"Join Room"**
4. Share room code with friends
5. Host clicks **"Start Game"**
6. Move with **WASD** or **Arrow Keys**
7. Press **ESC** to leave game

## Game Features

### 🎮 Core Gameplay
- Real-time multiplayer maze navigation
- Smooth movement with wrap-around
- Up to 9 players per room

### 🦄 Unicorn Mechanic
- One player is the unicorn (purple with glow)
- Unicorn can catch other players
- Catches award +10 coins to unicorn
- Caught players lose -10 coins

### 💰 Scoring System
- Everyone starts with 100 coins
- Coins shown in HUD (💰)
- Real-time leaderboard
- Ranked by coins (descending)
- Top 3 highlighted (🥇🥈🥉)

### 🏆 Leaderboard
- Toggle with "📊 Show/Hide Leaderboard" button
- Your player highlighted in gold
- Unicorn highlighted in purple
- Real-time updates
- Smooth animations

## Testing Multiplayer

### Option 1: Multiple Browser Windows
1. Open 2-3 browser windows side by side
2. Create room in first window
3. Join with the others using room code
4. Start game and see players move!

### Option 2: Incognito/Different Browsers
1. Normal window: Create room
2. Incognito window: Join room
3. Start playing!

## Controls

- **WASD** or **Arrow Keys**: Move
- **ESC**: Leave game
- **📊 Button**: Toggle leaderboard

## Visual Indicators

### Player Colors
- **Yellow**: You (local player)
- **Green**: Other players
- **Purple (pulsing)**: Unicorn

### HUD Elements
- Room code
- Player count
- Your coins (💰)
- Unicorn indicator (if you're unicorn)
- Leaderboard toggle

### Leaderboard
- **Gold background**: You
- **Purple background**: Unicorn
- **Gold rank (#1)**: First place
- **Silver rank (#2)**: Second place
- **Bronze rank (#3)**: Third place

## Architecture

```
Frontend (React + Vite + Socket.IO Client)
    ↕ WebSocket Connection
Backend (Express + Socket.IO Server)
    ↕ Room & Game State Management
Database (In-Memory Maps)
```

## Troubleshooting

**Can't connect?**
- Check both servers are running
- Backend should be on port 3000
- Frontend should be on port 5173

**Room not working?**
- Check browser console for errors
- Verify socket connection (green indicator)
- Try refreshing the page

**Players not syncing?**
- Ensure game has started
- Check network tab for socket events
- Verify both players are in the same room

**Coins not updating?**
- Unicorn must be within 30 pixels to catch
- Check backend console for collision logs
- Verify leaderboard is visible

## Next Steps

See detailed documentation:
- `INTEGRATION_GUIDE.md` - Technical details
- `UNICORN_FEATURE.md` - Unicorn mechanics
- `SCORING_SYSTEM.md` - Scoring and leaderboard
- `IMPLEMENTATION_SUMMARY.md` - Feature overview

Happy gaming! 🎮🦄💰
