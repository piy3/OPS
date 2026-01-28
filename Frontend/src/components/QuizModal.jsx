import { useState, useEffect } from 'react';
import { useRoom } from '../context/RoomContext';
import { useGamePhase } from '../context/GamePhaseContext';
import './QuizModal.css';

function QuizModal() {
  // Use focused hooks - avoid re-renders from combat state changes
  const { socketService } = useRoom();
  const { quizData, setQuizData } = useGamePhase();
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [hasAnswered, setHasAnswered] = useState(false);

  // Initialize timer
  useEffect(() => {
    if (quizData && quizData.totalTimeLimit) {
      setTimeRemaining(quizData.totalTimeLimit);
    }
  }, [quizData]);

  // Countdown timer
  useEffect(() => {
    if (timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        const newTime = prev - 100;
        return newTime < 0 ? 0 : newTime;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [timeRemaining]);

  if (!quizData || !quizData.questions) {
    return null;
  }

  const currentQuestionIndex = quizData.currentQuestion || 0;
  const currentQuestion = quizData.questions[currentQuestionIndex];
  const totalQuestions = quizData.questions.length;
  const answeredCount = quizData.answers ? quizData.answers.length : 0;

  // Format time remaining
  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);
  const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  // Calculate progress percentage
  const progressPercentage = (answeredCount / totalQuestions) * 100;

  const handleAnswerSelect = (optionIndex) => {
    if (hasAnswered) return;
    setSelectedAnswer(optionIndex);
  };

  const handleSubmit = () => {
    if (selectedAnswer === null || hasAnswered) return;

    // Submit answer to server
    socketService.submitQuizAnswer(currentQuestion.id, selectedAnswer);
    setHasAnswered(true);

    // Wait for server response, then move to next question
    setTimeout(() => {
      if (currentQuestionIndex < totalQuestions - 1) {
        // Move to next question
        setQuizData(prev => ({
          ...prev,
          currentQuestion: prev.currentQuestion + 1
        }));
        setSelectedAnswer(null);
        setHasAnswered(false);
      }
      // If last question, quiz will be auto-completed by server
    }, 1000);
  };

  // Get the last answer result for feedback
  const lastAnswer = quizData.answers && quizData.answers.length > 0 
    ? quizData.answers[quizData.answers.length - 1] 
    : null;

  return (
    <div className="quiz-modal-overlay">
      <div className="quiz-modal">
        {/* Header */}
        <div className="quiz-header">
          <h2>🎯 Quiz Challenge!</h2>
          <p className="quiz-subtitle">
            Answer correctly to escape from {quizData.unicornName}
          </p>
        </div>

        {/* Timer and Progress */}
        <div className="quiz-info">
          <div className="quiz-timer">
            <span className="timer-icon">⏱️</span>
            <span className={`timer-text ${timeRemaining < 30000 ? 'timer-warning' : ''}`}>
              {timeString}
            </span>
          </div>
          <div className="quiz-progress">
            <span className="progress-text">
              Question {answeredCount + 1} / {totalQuestions}
            </span>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Question */}
        <div className="quiz-question-container">
          <h3 className="quiz-question">{currentQuestion.question}</h3>
          
          <div className="quiz-options">
            {currentQuestion.options.map((option, index) => (
              <button
                key={index}
                className={`quiz-option ${
                  selectedAnswer === index ? 'selected' : ''
                } ${
                  hasAnswered && lastAnswer && lastAnswer.questionId === currentQuestion.id
                    ? selectedAnswer === index
                      ? lastAnswer.isCorrect
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
                {hasAnswered && lastAnswer && lastAnswer.questionId === currentQuestion.id && selectedAnswer === index && (
                  <span className="option-feedback">
                    {lastAnswer.isCorrect ? '✓' : '✗'}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Submit Button */}
          <button
            className="quiz-submit-btn"
            onClick={handleSubmit}
            disabled={selectedAnswer === null || hasAnswered}
          >
            {hasAnswered ? 'Next Question...' : 'Submit Answer'}
          </button>

          {/* Feedback */}
          {hasAnswered && lastAnswer && (
            <div className={`quiz-feedback ${lastAnswer.isCorrect ? 'feedback-correct' : 'feedback-incorrect'}`}>
              {lastAnswer.isCorrect ? '🎉 Correct!' : '❌ Incorrect'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuizModal;
