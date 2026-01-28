/**
 * Game Phase Context - Handles game loop, quiz, and hunt state
 * Changes with game phase transitions
 */

import { createContext, useContext, useState, useMemo } from 'react';

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
  }), [
    gameState, gamePhase, isGameFrozen, freezeMessage,
    quizActive, quizData, quizResults,
    blitzQuizActive, blitzQuizData, blitzQuizResults,
    huntData, huntTimeRemaining, tagNotification
  ]);

  return (
    <GamePhaseContext.Provider value={value}>
      {children}
    </GamePhaseContext.Provider>
  );
};

export default GamePhaseContext;
