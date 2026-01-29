import { useState, useEffect } from 'react';
import { useRoom } from '../context/RoomContext';
import { useGamePhase } from '../context/GamePhaseContext';
import './UnfreezeQuizModal.css';

function UnfreezeQuizModal() {
  const { socketService } = useRoom();
  const { unfreezeQuizData, setUnfreezeQuizData } = useGamePhase();
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [answerResult, setAnswerResult] = useState(null);
  const [answeredQuestions, setAnsweredQuestions] = useState([]);
  const [showFailed, setShowFailed] = useState(false);

  // Reset state when quiz data changes (new quiz starts)
  useEffect(() => {
    if (unfreezeQuizData && !unfreezeQuizData.failed) {
      setCurrentQuestionIndex(0);
      setSelectedAnswer(null);
      setHasAnswered(false);
      setAnswerResult(null);
      setAnsweredQuestions([]);
      setShowFailed(false);
    } else if (unfreezeQuizData?.failed) {
      setShowFailed(true);
    }
  }, [unfreezeQuizData]);

  // Listen for answer result
  useEffect(() => {
    if (!socketService) return;

    const handleAnswerResult = (data) => {
      setAnswerResult(data);
      setAnsweredQuestions(prev => [...prev, {
        questionIndex: data.questionIndex,
        isCorrect: data.isCorrect,
        correctAnswer: data.correctAnswer
      }]);

      // Move to next question after a brief delay
      if (data.totalAnswered < data.totalQuestions) {
        setTimeout(() => {
          setCurrentQuestionIndex(data.totalAnswered);
          setSelectedAnswer(null);
          setHasAnswered(false);
          setAnswerResult(null);
        }, 1500);
      }
    };

    socketService.onUnfreezeQuizAnswerResult(handleAnswerResult);

    return () => {
      socketService.off('unfreeze_quiz_answer_result', handleAnswerResult);
    };
  }, [socketService]);

  if (!unfreezeQuizData || !unfreezeQuizData.questions) {
    return null;
  }

  // Show failed state briefly before new quiz starts
  if (showFailed) {
    return (
      <div className="unfreeze-modal-overlay">
        <div className="unfreeze-modal failed-state">
          <div className="unfreeze-header">
            <div className="unfreeze-title">
              <span className="unfreeze-icon">❌</span>
              <h2>TRY AGAIN</h2>
              <span className="unfreeze-icon">❌</span>
            </div>
            <p className="unfreeze-subtitle">
              You got {unfreezeQuizData.correctCount} of {unfreezeQuizData.totalQuestions} correct.
            </p>
            <p className="unfreeze-retry-text">New questions coming...</p>
          </div>
        </div>
      </div>
    );
  }

  const questions = unfreezeQuizData.questions;
  const currentQuestion = questions[currentQuestionIndex];
  
  if (!currentQuestion) {
    return null;
  }

  const handleAnswerSelect = (optionIndex) => {
    if (hasAnswered) return;
    setSelectedAnswer(optionIndex);
    setHasAnswered(true);

    // Submit answer to server
    socketService.submitUnfreezeQuizAnswer(currentQuestionIndex, optionIndex);
  };

  // Calculate progress
  const correctCount = answeredQuestions.filter(a => a.isCorrect).length;
  const progressText = `Question ${currentQuestionIndex + 1} of ${questions.length}`;

  return (
    <div className="unfreeze-modal-overlay">
      <div className="unfreeze-modal">
        {/* Header */}
        <div className="unfreeze-header">
          <div className="unfreeze-title">
            <span className="unfreeze-icon">🧊</span>
            <h2>UNFREEZE QUIZ</h2>
            <span className="unfreeze-icon">🧊</span>
          </div>
          <p className="unfreeze-subtitle">
            Answer to unfreeze yourself!
          </p>
        </div>

        {/* Progress indicator */}
        <div className="unfreeze-progress">
          <div className="progress-text">{progressText}</div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${((currentQuestionIndex) / questions.length) * 100}%` }}
            />
          </div>
          <div className="progress-score">
            Correct: {correctCount} / Need: {unfreezeQuizData.passThreshold}
          </div>
        </div>

        {/* Question */}
        <div className="unfreeze-question-container">
          <h3 className="unfreeze-question">{currentQuestion.question}</h3>
          
          <div className="unfreeze-options">
            {currentQuestion.options.map((option, index) => (
              <button
                key={index}
                className={`unfreeze-option ${
                  selectedAnswer === index ? 'selected' : ''
                } ${
                  hasAnswered && answerResult
                    ? index === answerResult.correctAnswer
                      ? 'correct'
                      : selectedAnswer === index && !answerResult.isCorrect
                        ? 'incorrect'
                        : ''
                    : ''
                }`}
                onClick={() => handleAnswerSelect(index)}
                disabled={hasAnswered}
              >
                <span className="option-letter">{String.fromCharCode(65 + index)}</span>
                <span className="option-text">{option}</span>
                {hasAnswered && answerResult && (
                  <>
                    {index === answerResult.correctAnswer && (
                      <span className="option-feedback">✓</span>
                    )}
                    {selectedAnswer === index && !answerResult.isCorrect && (
                      <span className="option-feedback">✗</span>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>

          {/* Feedback */}
          {hasAnswered && answerResult && (
            <div className={`unfreeze-feedback ${answerResult.isCorrect ? 'feedback-correct' : 'feedback-incorrect'}`}>
              <div className="feedback-icon">
                {answerResult.isCorrect ? '✅' : '❌'}
              </div>
              <div className="feedback-text">
                {answerResult.isCorrect ? 'Correct!' : 'Incorrect!'}
              </div>
              {answerResult.totalAnswered < answerResult.totalQuestions && (
                <div className="feedback-next">
                  Next question coming...
                </div>
              )}
              {answerResult.totalAnswered >= answerResult.totalQuestions && (
                <div className="feedback-waiting">
                  {correctCount >= unfreezeQuizData.passThreshold 
                    ? 'Quiz passed! Unfreezing...' 
                    : 'Quiz failed. Retrying...'}
                </div>
              )}
            </div>
          )}

          {/* Hint */}
          {!hasAnswered && (
            <div className="unfreeze-hint">
              Take your time - no timer! Get at least {unfreezeQuizData.passThreshold} correct to unfreeze.
            </div>
          )}
        </div>

        {/* Score summary */}
        <div className="unfreeze-score-summary">
          <div className="score-item">
            <span className="score-icon">✅</span>
            <span className="score-value">{correctCount}</span>
            <span className="score-label">Correct</span>
          </div>
          <div className="score-item">
            <span className="score-icon">📝</span>
            <span className="score-value">{answeredQuestions.length}</span>
            <span className="score-label">Answered</span>
          </div>
          <div className="score-item">
            <span className="score-icon">🎯</span>
            <span className="score-value">{unfreezeQuizData.passThreshold}</span>
            <span className="score-label">To Pass</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UnfreezeQuizModal;
