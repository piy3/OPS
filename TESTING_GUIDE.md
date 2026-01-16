# Quiz System - Quick Testing Guide

## Prerequisites

1. **Backend Running**
   ```bash
   cd OPS/Backend
   npm install
   node server.js
   ```
   Should see: `Server running on port 3000`

2. **Frontend Running**
   ```bash
   cd OPS/Frontend
   npm install
   npm run dev
   ```
   Should see: Vite dev server URL (usually http://localhost:5173)

---

## Quick Test Scenarios

### Scenario 1: Basic Quiz Flow (2 Players)

**Setup**:
1. Open two browser windows side-by-side
2. Window 1: Create room, start game (you become Player 1)
3. Window 2: Join room with code (you become Player 2)
4. One player will be unicorn (purple with 🦄)

**Test**:
1. **Move unicorn to catch other player**
   - Use WASD or arrow keys
   - Check coordinates panel to see positions
   - Move until both players at same grid coordinates (row, col)

2. **Verify Freeze**
   - Both screens should freeze
   - Both see: "🦄 [Unicorn] caught [Player]!"
   - Movement blocked on both screens

3. **Verify Quiz (Caught Player Only)**
   - Caught player sees quiz modal
   - Unicorn player still sees freeze overlay
   - Timer starts counting down from 2:00

4. **Answer Questions**
   - Select an answer (A, B, C, or D)
   - Click "Submit Answer"
   - See green ✓ or red ✗ feedback
   - Auto-advance to next question
   - Repeat for all 5 questions

5. **Verify Results**
   - Both players see results screen
   - Shows score percentage (e.g., 80%)
   - Shows correct answers (e.g., 4/5)
   - Shows pass/fail status
   - Auto-dismisses after 5 seconds

6. **Verify Resume**
   - Game unfreezes automatically
   - Both players can move again
   - Play continues normally

**Expected Results**:
✅ Game freezes for both players
✅ Only caught player gets quiz
✅ Immediate feedback on answers
✅ Results shown to both players
✅ Game auto-resumes after 5 seconds

---

### Scenario 2: Quiz Timeout

**Test**:
1. Get caught by unicorn
2. Answer 1-2 questions
3. Wait for 2 minutes without answering more
4. Quiz should auto-complete with timeout

**Expected Results**:
✅ Quiz ends after 2 minutes
✅ Results show "⏱️ Timeout" status
✅ Scored based on answered questions only
✅ Game unfreezes normally

---

### Scenario 3: Multiple Catches

**Test**:
1. Complete one quiz cycle
2. After game resumes, catch player again
3. New quiz should start
4. Complete second quiz

**Expected Results**:
✅ Second quiz starts normally
✅ Different random questions
✅ No stuck states or errors
✅ Each quiz independent

---

### Scenario 4: Player Count (3+ Players)

**Setup**:
- Open 3+ browser windows
- All join same room
- Start game

**Test**:
1. Unicorn catches one player
2. Game freezes for ALL players
3. Only caught player sees quiz
4. Other players see freeze overlay
5. All players see results
6. All players unfreeze together

**Expected Results**:
✅ All players freeze simultaneously
✅ All players see results together
✅ All players resume together
✅ No desync issues

---

## Debug Tools

### Browser Console Commands

```javascript
// Check socket connection
socketService.getSocket().connected

// Check current room
roomData

// Check if game frozen
isGameFrozen

// Check quiz state
quizActive
quizData
quizResults

// Manually submit answer (testing only)
socketService.submitQuizAnswer(0, 1) // questionId: 0, answer: 1
```

### Coordinates Panel
- Toggle with "📍 Show/Hide Coords" button
- Shows exact grid positions (row, col)
- Use to verify collision detection
- Helps navigate to catch players

---

## Common Issues and Fixes

### Issue: Can't catch player
**Cause**: Not at exact same grid coordinates
**Fix**: Use coordinates panel to verify positions match exactly

### Issue: Quiz doesn't appear
**Cause**: Socket event not received
**Fix**: Check browser console, verify backend running, check network tab

### Issue: Game doesn't unfreeze
**Cause**: Timeout issue in SocketContext
**Fix**: Manually refresh page, check console errors

### Issue: Multiple quizzes trigger
**Cause**: Collision detection firing repeatedly
**Fix**: Backend has `hasActiveQuiz` check - verify it's working

### Issue: Wrong player gets quiz
**Cause**: Socket ID mismatch
**Fix**: Check caught player ID in backend logs

---

## Manual Testing Checklist

### UI Testing
- [ ] Quiz modal displays correctly
- [ ] Timer counts down accurately
- [ ] Progress bar updates
- [ ] Answer options clickable
- [ ] Feedback shows immediately
- [ ] Results screen displays all data
- [ ] Animations smooth
- [ ] Responsive on mobile

### Functional Testing
- [ ] Grid collision detection works
- [ ] Game freezes all players
- [ ] Only caught player sees quiz
- [ ] Server validates answers
- [ ] Score calculated correctly
- [ ] Timeout works (2 minutes)
- [ ] Auto-resume after results
- [ ] Multiple quizzes work

### Edge Cases
- [ ] Player disconnects during quiz
- [ ] Unicorn disconnects during quiz
- [ ] Player rejoins during quiz
- [ ] Very fast answers (spam clicking)
- [ ] No answer selected and submit clicked
- [ ] Browser refresh during quiz
- [ ] Network lag during quiz

---

## Expected Console Logs

### Backend (server.js)
```
🦄 Unicorn socket-id-1 caught player socket-id-2 at grid position (10, 15)
Quiz started in room ABC123: Player1 caught Player2
Answer recorded: Q0, Answer: 1, Correct: true
Answer recorded: Q1, Answer: 2, Correct: false
...
All questions answered in room ABC123, completing quiz
Quiz completed in room ABC123:
  - Caught Player: Player2
  - Score: 4/5 (80%)
  - Time taken: 45000ms
  - Timeout: false
Game unfrozen in room ABC123
```

### Frontend (browser console)
```
Game frozen: {message: "🦄 Player1 caught Player2!", ...}
Quiz started: {questions: Array(5), totalTimeLimit: 120000, ...}
Quiz answer result: {questionId: 0, isCorrect: true, ...}
Quiz complete: {scorePercentage: 80, correctAnswers: 4, ...}
```

---

## Performance Testing

### Test with Multiple Players
1. Open 5+ browser windows
2. All join same room
3. Trigger quiz
4. Verify no lag or performance issues

### Test Rapid Catches
1. Catch player
2. Complete quiz quickly
3. Catch again immediately
4. Verify smooth transitions

### Test Long Duration
1. Start game
2. Play for 10+ minutes
3. Trigger multiple quizzes
4. Verify no memory leaks
5. Check console for errors

---

## Success Criteria

✅ **Must Have**
- Grid collision detection works 100% reliably
- Game freezes for all players simultaneously
- Quiz appears only for caught player
- All 5 questions answerable
- Correct/incorrect feedback immediate
- Results shown to all players
- Game auto-resumes after 5 seconds
- No crashes or errors

✅ **Should Have**
- Smooth animations
- Responsive design works
- Timer accurate
- Progress bar updates smoothly
- Pass/fail indicator correct
- Mobile friendly

✅ **Nice to Have**
- Beautiful UI
- Engaging animations
- Good performance with 5+ players
- Graceful error handling
- Helpful debug info in console

---

## Quick Start Commands

```bash
# Terminal 1: Backend
cd OPS/Backend
node server.js

# Terminal 2: Frontend
cd OPS/Frontend
npm run dev

# Open browsers
# Browser 1: http://localhost:5173 (create room)
# Browser 2: http://localhost:5173 (join room)
# Start testing!
```

---

## Video Walkthrough Script

1. **Intro (0:00-0:30)**
   - Show two browser windows
   - Create room, join room
   - Start game

2. **Collision (0:30-1:00)**
   - Open coordinates panel
   - Navigate unicorn to player
   - Show exact grid match
   - Collision triggers!

3. **Freeze (1:00-1:15)**
   - Both screens freeze
   - Freeze overlay appears
   - Show message and badges

4. **Quiz (1:15-2:30)**
   - Caught player sees quiz
   - Answer 5 questions
   - Show correct/incorrect feedback
   - Progress bar updates
   - Timer counts down

5. **Results (2:30-3:00)**
   - Results screen appears both sides
   - Show score, percentage
   - Pass/fail indication
   - Auto-dismiss countdown

6. **Resume (3:00-3:15)**
   - Game unfreezes
   - Players can move
   - Second catch demo

7. **Outro (3:15-3:30)**
   - Show coordinates panel
   - Show leaderboard
   - Thank you!

---

## Need Help?

### Check These First
1. Browser console (F12) for errors
2. Network tab for failed requests
3. Backend terminal for server logs
4. Coordinates panel for position debugging

### Common Commands
```bash
# Restart backend
Ctrl+C
node server.js

# Restart frontend
Ctrl+C
npm run dev

# Clear browser cache
Ctrl+Shift+Delete

# View all logs
Backend: Check terminal output
Frontend: F12 → Console tab
```

---

## Ready to Test! 🚀

Follow the scenarios above and check off each item. If everything works, you're good to go!

**Minimum Test**: Complete Scenario 1 with 2 players successfully.

**Full Test**: Complete all 4 scenarios + checklist items.

Good luck! 🎯
