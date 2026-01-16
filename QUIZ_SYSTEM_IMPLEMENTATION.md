# Quiz System Implementation - Complete Documentation

## Overview
Implemented a grid-based collision detection system that triggers a quiz when the unicorn catches a player. The game freezes for all players while the caught player answers quiz questions.

---

## Backend Implementation

### 1. New Files Created

#### `/Backend/config/questions.js`
- **QUIZ_QUESTIONS**: Array of 30 quiz questions with multiple choice options
- **getRandomQuestions(count)**: Function to generate random questions for each quiz
- **QUIZ_CONFIG**: Configuration object
  - `QUESTIONS_PER_QUIZ: 5` - Number of questions per quiz
  - `TOTAL_TIME_LIMIT: 120000` - 2 minutes total (in milliseconds)
  - `TIME_PER_QUESTION: 24000` - 24 seconds per question

### 2. Updated Files

#### `/Backend/config/constants.js`
Added new socket events:

**Client to Server:**
- `SUBMIT_QUIZ_ANSWER` - Player submits an answer to a quiz question

**Server to Client:**
- `GAME_FROZEN` - Broadcasted to all players when game freezes
- `QUIZ_START` - Sent to caught player with quiz questions
- `QUIZ_COMPLETE` - Broadcasted to all players when quiz ends

#### `/Backend/services/GameStateManager.js`

**New State Tracking:**
```javascript
this.activeQuizzes = new Map() // Tracks active quiz per room
```

**Updated `updatePlayerPosition()` method:**
- Changed from **pixel-based** to **grid-based** collision detection
- Uses `row` and `col` coordinates for exact position matching
- Fixed syntax errors in your original code:
  - `room.player` → `room.players` (plural)
  - Added `return` statement in `.find()` callback
  - Changed `==` to `===` for strict equality

**New Grid-Based Collision Logic:**
```javascript
if (isUnicorn && io) {
    const hasActiveQuiz = this.activeQuizzes.has(roomCode);
    
    if (!hasActiveQuiz && validatedPosition.row && validatedPosition.col) {
        const caughtPlayer = room.players.find(p => {
            const playerPos = this.getPlayerPosition(roomCode, p.id);
            return playerPos && 
                   playerPos.row === validatedPosition.row && 
                   playerPos.col === validatedPosition.col && 
                   p.id !== playerId &&
                   !p.isUnicorn;
        });
        
        if (caughtPlayer) {
            this.startQuiz(roomCode, playerId, caughtPlayer.id, io);
        }
    }
}
```

**New Methods Added:**

1. **`startQuiz(roomCode, unicornId, caughtId, io)`**
   - Generates 5 random quiz questions
   - Stores quiz state in `activeQuizzes` Map
   - Broadcasts `GAME_FROZEN` event to **ALL players**
   - Sends `QUIZ_START` event with questions to **caught player only**
   - Sets 2-minute timeout for auto-completion
   - **Security**: Only sends question text and options to client (NOT correct answers)

2. **`submitQuizAnswer(roomCode, playerId, questionId, answerIndex)`**
   - Validates player is the caught player
   - Records answer with timestamp
   - Checks if answer is correct
   - Returns result object
   - Prevents duplicate answers for same question

3. **`completeQuiz(roomCode, io, isTimeout)`**
   - Calculates quiz results (score, percentage, time taken)
   - Broadcasts `QUIZ_COMPLETE` event to all players
   - Cleans up quiz state
   - **Contains TODO comments for result-based logic** (to be implemented)

4. **`getActiveQuiz(roomCode)`** - Get active quiz data
5. **`hasActiveQuiz(roomCode)`** - Check if quiz is active

#### `/Backend/handlers/gameHandlers.js`

**New Handler:**
- `SUBMIT_QUIZ_ANSWER` event handler
  - Receives answer submissions from caught player
  - Validates and records answers
  - Sends immediate feedback (`quiz_answer_result`)
  - Auto-completes quiz when all questions answered

---

## How It Works

### Flow Diagram

```
1. Unicorn moves to position (row: 5, col: 10)
   ↓
2. Backend: updatePlayerPosition() called
   ↓
3. Check: Is player unicorn? → YES
   ↓
4. Check: Any active quiz? → NO
   ↓
5. Find players at same grid position (row: 5, col: 10)
   ↓
6. Player found! → startQuiz()
   ↓
7. Generate 5 random questions
   ↓
8. Store quiz state in activeQuizzes Map
   ↓
9. Broadcast GAME_FROZEN to ALL players
   ↓
10. Send QUIZ_START to caught player only
   ↓
11. Start 2-minute countdown timer
   ↓
12. Caught player submits answers (1-5 questions)
   ↓
13. Backend validates each answer
   ↓
14. Send immediate feedback to player
   ↓
15. All answered OR timeout reached
   ↓
16. completeQuiz() called
   ↓
17. Calculate results
   ↓
18. Broadcast QUIZ_COMPLETE to ALL players
   ↓
19. Game unfrozen, play resumes
```

### Quiz Data Structure

**Stored in `activeQuizzes` Map:**
```javascript
{
  unicornId: "socket-id-1",
  unicornName: "Player1",
  caughtId: "socket-id-2",
  caughtName: "Player2",
  questions: [
    {
      id: 0,
      question: "12 + 15 = ?",
      options: ["25", "27", "30"],
      correctAnswer: 1
    },
    // ... 4 more questions
  ],
  startTime: 1234567890,
  timeLimit: 120000,
  answers: [
    {
      questionId: 0,
      answerIndex: 1,
      isCorrect: true,
      timestamp: 1234567900
    }
    // ... more answers as they come in
  ],
  completed: false
}
```

---

## Security Features

1. **Answer Validation Server-Side**
   - Correct answers NEVER sent to client
   - Server validates all submissions
   - Prevents cheating via console inspection

2. **Player Verification**
   - Only caught player can submit answers
   - Validates player ID on each submission

3. **Duplicate Prevention**
   - Can't answer same question twice
   - Tracks answered questions in server state

4. **Time Enforcement**
   - Server-side timeout (2 minutes)
   - Auto-completes quiz if time runs out

---

## Grid-Based Collision vs Pixel-Based

### Why Grid-Based is Better

**Old System (Pixel-based):**
```javascript
// Problem: Different screen sizes = different pixel positions
const distance = Math.sqrt(dx*dx + dy*dy);
if (distance < 30) { /* collision */ }
```
- ❌ Inconsistent across screen sizes
- ❌ Floating point precision issues
- ❌ Can miss collisions or false positives

**New System (Grid-based):**
```javascript
// Solution: Exact grid coordinate matching
if (playerPos.row === unicornPos.row && 
    playerPos.col === unicornPos.col) {
  /* collision */
}
```
- ✅ Consistent across ALL screen sizes
- ✅ Exact position matching
- ✅ No false positives
- ✅ Reliable collision detection

---

## TODO: Result-Based Logic

The `completeQuiz()` method contains TODO comments for implementing game logic based on quiz results. Here are some suggestions:

### Option 1: Pass/Fail System
```javascript
const PASS_THRESHOLD = 60; // 60% to pass

if (scorePercentage >= PASS_THRESHOLD) {
    // Player PASSED
    // - Caught player gets +20 coins (bonus for escaping)
    // - Unicorn loses -5 coins (penalty)
    // - Caught player becomes new unicorn
    roomManager.updatePlayerCoins(roomCode, quiz.caughtId, 20);
    roomManager.updatePlayerCoins(roomCode, quiz.unicornId, -5);
    roomManager.transferUnicorn(roomCode, quiz.caughtId);
} else {
    // Player FAILED
    // - Caught player loses -15 coins (penalty)
    // - Unicorn gets +25 coins (reward)
    // - Unicorn remains unicorn
    roomManager.updatePlayerCoins(roomCode, quiz.caughtId, -15);
    roomManager.updatePlayerCoins(roomCode, quiz.unicornId, 25);
}
```

### Option 2: Scaled Rewards
```javascript
// Reward based on score
const caughtReward = scorePercentage * 0.5; // 0-50 coins
const unicornReward = (100 - scorePercentage) * 0.3; // 0-30 coins

roomManager.updatePlayerCoins(roomCode, quiz.caughtId, caughtReward);
roomManager.updatePlayerCoins(roomCode, quiz.unicornId, unicornReward);
```

### Option 3: Time Bonus
```javascript
// Bonus for quick answers
const timeBonus = Math.max(0, (QUIZ_CONFIG.TOTAL_TIME_LIMIT - timeTaken) / 1000);
const totalReward = correctAnswers * 5 + timeBonus;

roomManager.updatePlayerCoins(roomCode, quiz.caughtId, totalReward);
```

### Timeout Handling
```javascript
if (isTimeout) {
    // Harsh penalty for timeout
    roomManager.updatePlayerCoins(roomCode, quiz.caughtId, -20);
    roomManager.updatePlayerCoins(roomCode, quiz.unicornId, 30);
}
```

---

## Frontend Implementation Needed

To complete this feature, you'll need to implement on the frontend:

### 1. Socket Listeners

```javascript
// In SocketContext.jsx or socket service

socket.on('game_frozen', (data) => {
  // Show freeze overlay for ALL players
  // Display message: "🦄 {unicornName} caught {caughtName}!"
  setGameFrozen(true);
});

socket.on('quiz_start', (data) => {
  // ONLY for caught player
  // Show quiz modal with questions
  // Start 2-minute countdown timer
  setQuizData(data.questions);
  setQuizActive(true);
});

socket.on('quiz_answer_result', (data) => {
  // Show immediate feedback (correct/incorrect)
  // Update UI with progress
});

socket.on('quiz_complete', (data) => {
  // Hide quiz modal
  // Show results overlay to ALL players
  // Unfreeze game
  setGameFrozen(false);
  setQuizActive(false);
});
```

### 2. Quiz UI Component

```jsx
// QuizModal.jsx
function QuizModal({ questions, onSubmit, timeLimit }) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  
  const handleSubmit = () => {
    socketService.submitQuizAnswer({
      questionId: questions[currentQuestion].id,
      answerIndex: selectedAnswer
    });
    // Move to next question or finish
  };
  
  // Render quiz UI
}
```

### 3. Game Freeze Logic

```javascript
// In StartGame.jsx

useEffect(() => {
  if (isGameFrozen) {
    // Disable player movement
    // Disable keyboard input
    // Show freeze overlay
  }
}, [isGameFrozen]);
```

---

## Testing Checklist

### Backend Tests
- [ ] Unicorn catches player at exact grid position (row/col match)
- [ ] Game freezes for all players in room
- [ ] Quiz questions generated randomly (5 questions)
- [ ] Only caught player receives quiz
- [ ] Answer validation works correctly
- [ ] Duplicate answers prevented
- [ ] Quiz completes when all 5 questions answered
- [ ] Quiz auto-completes after 2 minutes
- [ ] No quiz starts if one is already active
- [ ] Multiple catches don't create multiple quizzes

### Integration Tests
- [ ] Different screen sizes use same grid collision
- [ ] Works with maze wrap-around edges
- [ ] Works with 2+ players in room
- [ ] Quiz state cleaned up after completion
- [ ] Room can handle multiple quiz cycles
- [ ] Player disconnect during quiz handled gracefully

---

## Configuration

All settings can be adjusted in `/Backend/config/questions.js`:

```javascript
export const QUIZ_CONFIG = {
    QUESTIONS_PER_QUIZ: 5,        // Change number of questions
    TOTAL_TIME_LIMIT: 120000,     // Change total time (ms)
    TIME_PER_QUESTION: 24000      // Change per-question time (ms)
};
```

---

## Next Steps

1. **Implement frontend quiz UI**
   - Quiz modal component
   - Timer display
   - Question/answer selection
   - Result display

2. **Add result-based logic in `completeQuiz()`**
   - Define pass/fail criteria
   - Implement coin rewards/penalties
   - Handle unicorn transfer logic

3. **Add visual feedback**
   - Freeze overlay animation
   - Quiz modal styling
   - Progress indicators
   - Celebration effects for good scores

4. **Testing**
   - Test grid collision thoroughly
   - Test quiz flow end-to-end
   - Test edge cases (disconnect, timeout, etc.)

5. **Polish**
   - Sound effects
   - Better error handling
   - Reconnection support during quiz
   - Statistics tracking

---

## Key Improvements Made

1. ✅ **Fixed syntax errors** in your original code
2. ✅ **Grid-based collision** - reliable across all screen sizes
3. ✅ **Complete quiz system** - question generation, validation, timing
4. ✅ **Security** - server-side answer validation
5. ✅ **Game freeze** - broadcasts to all players
6. ✅ **Scalable** - single quiz per room, clean state management
7. ✅ **Well documented** - comments and TODO markers for next iteration

---

## Questions or Issues?

The backend implementation is **complete and ready to test**. The main remaining work is:
- Frontend quiz UI
- Result-based game logic (marked with TODO comments)

All the hard parts (collision detection, quiz state management, timing, validation) are fully implemented and tested for syntax errors.
