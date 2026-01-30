/**
 * Game Phase Context - Handles game loop, quiz, and hunt state
 * Changes with game phase transitions
 */

import { createContext, useContext, useState, useMemo, useEffect, useRef } from 'react';
import { useSound } from './SoundContext';

// Game phase constants (matching backend)
export const GAME_PHASE = {
  WAITING: 'waiting',
  BLITZ_QUIZ: 'blitz_quiz',
  HUNT: 'hunt',
  ROUND_END: 'round_end'
};

const GamePhaseContext = createContext(null);

export const useGamePhase = () => {
  const context = useContext(GamePhaseContext);
  if (!context) {
    throw new Error('useGamePhase must be used within a GamePhaseProvider');
  }
  return context;
};

export const GamePhaseProvider = ({ children }) => {
  const { playTimerWarning } = useSound();
  
  const [gameState, setGameState] = useState(null);
  const [gamePhase, setGamePhase] = useState(GAME_PHASE.WAITING);
  
  // Freeze/Quiz state
  const [isGameFrozen, setIsGameFrozen] = useState(false);
  const [freezeMessage, setFreezeMessage] = useState(null);
  const [quizActive, setQuizActive] = useState(false);
  const [quizData, setQuizData] = useState(null);
  const [quizResults, setQuizResults] = useState(null);

  // Blitz Quiz state
  const [blitzQuizActive, setBlitzQuizActive] = useState(false);
  const [blitzQuizData, setBlitzQuizData] = useState(null);
  const [blitzQuizResults, setBlitzQuizResults] = useState(null);

  // Hunt state
  const [huntData, setHuntData] = useState(null);
  const [huntTimeRemaining, setHuntTimeRemaining] = useState(0);
  const [tagNotification, setTagNotification] = useState(null);

  // Unfreeze Quiz state (personal quiz when player health reaches 0)
  const [unfreezeQuizActive, setUnfreezeQuizActive] = useState(false);
  const [unfreezeQuizData, setUnfreezeQuizData] = useState(null);

  // Ref to track last warning second played (prevents duplicate plays)
  const lastWarningSecondRef = useRef(null);

  // Local countdown timer for hunt phase (updates every second from endTime)
  // Also triggers timer warning sounds at 10, 5, 3, 2, 1 seconds
  useEffect(() => {
    // Only run interval when in HUNT phase and we have an endTime
    if (gamePhase !== GAME_PHASE.HUNT || !huntData?.endTime) {
      // Reset warning ref when leaving hunt or no endTime
      lastWarningSecondRef.current = null;
      return;
    }

    const WARNING_SECONDS = [10, 5, 3, 2, 1];

    // Function to update time and check for warning
    const updateTimeAndCheckWarning = () => {
      const remaining = Math.max(0, huntData.endTime - Date.now());
      setHuntTimeRemaining(remaining);

      // Check if we should play timer warning sound
      const seconds = Math.floor(remaining / 1000);
      if (WARNING_SECONDS.includes(seconds) && lastWarningSecondRef.current !== seconds) {
        lastWarningSecondRef.current = seconds;
        playTimerWarning();
      }

      // Reset ref when timer reaches 0 so next hunt can trigger warnings again
      if (remaining <= 0) {
        lastWarningSecondRef.current = null;
      }
    };

    // Start 1-second interval to compute remaining time from endTime
    const intervalId = setInterval(updateTimeAndCheckWarning, 1000);

    // Initial update immediately (don't wait 1 second)
    updateTimeAndCheckWarning();

    // Cleanup: clear interval and reset ref when phase changes or huntData.endTime changes
    return () => {
      clearInterval(intervalId);
      lastWarningSecondRef.current = null;
    };
  }, [gamePhase, huntData?.endTime, playTimerWarning]);

  const value = useMemo(() => ({
    gameState,
    setGameState,
    gamePhase,
    setGamePhase,
    isGameFrozen,
    setIsGameFrozen,
    freezeMessage,
    setFreezeMessage,
    quizActive,
    setQuizActive,
    quizData,
    setQuizData,
    quizResults,
    setQuizResults,
    blitzQuizActive,
    setBlitzQuizActive,
    blitzQuizData,
    setBlitzQuizData,
    blitzQuizResults,
    setBlitzQuizResults,
    huntData,
    setHuntData,
    huntTimeRemaining,
    setHuntTimeRemaining,
    tagNotification,
    setTagNotification,
    // Unfreeze Quiz
    unfreezeQuizActive,
    setUnfreezeQuizActive,
    unfreezeQuizData,
    setUnfreezeQuizData,
  }), [
    gameState, gamePhase, isGameFrozen, freezeMessage,
    quizActive, quizData, quizResults,
    blitzQuizActive, blitzQuizData, blitzQuizResults,
    huntData, huntTimeRemaining, tagNotification,
    unfreezeQuizActive, unfreezeQuizData
  ]);

  return (
    <GamePhaseContext.Provider value={value}>
      {children}
    </GamePhaseContext.Provider>
  );
};

export default GamePhaseContext;
