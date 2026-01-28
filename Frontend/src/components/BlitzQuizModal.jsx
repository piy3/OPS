import { useState, useEffect } from 'react';
import { useRoom } from '../context/RoomContext';
import { useGamePhase } from '../context/GamePhaseContext';
import './BlitzQuizModal.css';

function BlitzQuizModal() {
  // Use focused hooks - avoid re-renders from combat state changes
  const { socketService, roomData } = useRoom();
  const { blitzQuizData } = useGamePhase();
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [answerResult, setAnswerResult] = useState(null);
  const [playersAnswered, setPlayersAnswered] = useState(new Set()); // Track who has answered

  // Initialize timer
  useEffect(() => {
    if (blitzQuizData && blitzQuizData.timeLimit) {
      setTimeRemaining(blitzQuizData.timeLimit);
      setSelectedAnswer(null);
      setHasAnswered(false);
      setAnswerResult(null);
    }
  }, [blitzQuizData]);

  // Countdown timer
  useEffect(() => {
    if (timeRemaining <= 0 || hasAnswered) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        const newTime = prev - 100;
        return newTime < 0 ? 0 : newTime;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [timeRemaining, hasAnswered]);

  // Listen for answer result
  useEffect(() => {
    if (!socketService) return;

    const handleAnswerResult = (data) => {
      setAnswerResult(data);
      // Track that I've answered
      const myId = socketService.getSocket()?.id;
      if (myId) {
        setPlayersAnswered(prev => {
          const newSet = new Set(prev);
          newSet.add(myId);
          return newSet;
        });
      }
    };

    socketService.onBlitzAnswerResult(handleAnswerResult);

    return () => {
      socketService.off('blitz_answer_result', handleAnswerResult);
    };
  }, [socketService]);

  // Reset state when new quiz starts
  useEffect(() => {
    if (blitzQuizData) {
      setPlayersAnswered(new Set());
    }
  }, [blitzQuizData]);

  if (!blitzQuizData || !blitzQuizData.question) {
    return null;
  }

  const question = blitzQuizData.question;

  // Format time remaining
  const seconds = Math.floor(timeRemaining / 1000);
  const milliseconds = Math.floor((timeRemaining % 1000) / 100);
  const timeString = `${seconds}.${milliseconds}s`;

  // Timer progress percentage
  const timerProgress = (timeRemaining / blitzQuizData.timeLimit) * 100;

  // Get urgency class based on time
  const getTimerClass = () => {
    if (timeRemaining <= 3000) return 'timer-critical';
    if (timeRemaining <= 7000) return 'timer-warning';
    return '';
  };

  const handleAnswerSelect = (optionIndex) => {
    if (hasAnswered) return;
    setSelectedAnswer(optionIndex);
    setHasAnswered(true);

    // Submit answer immediately
    socketService.submitBlitzAnswer(optionIndex);
  };

  return (
    <div className="blitz-modal-overlay">
      <div className="blitz-modal">
        {/* Header */}
        <div className="blitz-header">
          <div className="blitz-title">
            <span className="blitz-icon">⚡</span>
            <h2>BLITZ QUIZ</h2>
            <span className="blitz-icon">⚡</span>
          </div>
          <p className="blitz-subtitle">
            Answer fastest to become the Unicorn!
          </p>
        </div>

        {/* Timer */}
        <div className="blitz-timer-container">
          <div className={`blitz-timer ${getTimerClass()}`}>
            <span className="timer-value">{timeString}</span>
          </div>
          <div className="blitz-timer-bar">
            <div 
              className={`blitz-timer-fill ${getTimerClass()}`}
              style={{ width: `${timerProgress}%` }}
            />
          </div>
        </div>

        {/* Question */}
        <div className="blitz-question-container">
          <h3 className="blitz-question">{question.question}</h3>
          
          <div className="blitz-options">
            {question.options.map((option, index) => (
              <button
                key={index}
                className={`blitz-option ${
                  selectedAnswer === index ? 'selected' : ''
                } ${
                  hasAnswered && answerResult
                    ? selectedAnswer === index
                      ? answerResult.isCorrect
                        ? 'correct'
                        : 'incorrect'
                      : ''
                    : ''
                }`}
                onClick={() => handleAnswerSelect(index)}
                disabled={hasAnswered}
              >
                <span className="option-letter">{String.fromCharCode(65 + index)}</span>
                <span className="option-text">{option}</span>
                {hasAnswered && answerResult && selectedAnswer === index && (
                  <span className="option-feedback">
                    {answerResult.isCorrect ? '✓' : '✗'}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Feedback */}
          {hasAnswered && answerResult && (
            <div className={`blitz-feedback ${answerResult.isCorrect ? 'feedback-correct' : 'feedback-incorrect'}`}>
              <div className="feedback-icon">
                {answerResult.isCorrect ? '🎉' : '❌'}
              </div>
              <div className="feedback-text">
                {answerResult.isCorrect 
                  ? `Correct! Response time: ${(answerResult.responseTime / 1000).toFixed(2)}s` 
                  : 'Incorrect!'}
              </div>
              <div className="feedback-waiting">
                Waiting for other players... ({answerResult.answersReceived}/{answerResult.totalPlayers})
              </div>
            </div>
          )}

          {/* Waiting state before answer */}
          {!hasAnswered && (
            <div className="blitz-hint">
              Click your answer quickly! Speed matters!
            </div>
          )}
        </div>

        {/* Player Status Grid */}
        <div className="blitz-players-grid">
          <div className="players-grid-header">
            <span className="grid-icon">👥</span>
            <span className="grid-label">Players Answering</span>
            <span className="grid-count">{answerResult?.answersReceived || 0}/{blitzQuizData.playerCount}</span>
          </div>
          <div className="players-grid-list">
            {roomData?.players?.map((player) => {
              const isMe = player.id === socketService.getSocket()?.id;
              const hasThisPlayerAnswered = isMe ? hasAnswered : false; // Only know about my own answer locally
              
              return (
                <div 
                  key={player.id} 
                  className={`player-status-item ${isMe ? 'is-me' : ''} ${hasThisPlayerAnswered ? 'has-answered' : 'waiting'}`}
                >
                  <span className="player-status-icon">
                    {hasThisPlayerAnswered ? '✅' : '⏳'}
                  </span>
                  <span className="player-status-name">
                    {player.name}{isMe ? ' (You)' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Player count */}
        <div className="blitz-player-count">
          {blitzQuizData.playerCount} players competing
        </div>
      </div>
    </div>
  );
}

export default BlitzQuizModal;
