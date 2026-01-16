import './QuizResults.css';

function QuizResults({ results }) {
  if (!results) return null;

  const isPassed = results.scorePercentage >= 60; // 60% pass threshold
  const timeInSeconds = Math.floor(results.timeTaken / 1000);

  return (
    <div className="quiz-results-overlay">
      <div className="quiz-results-modal">
        {/* Header */}
        <div className={`results-header ${isPassed ? 'passed' : 'failed'}`}>
          <div className="results-icon">
            {isPassed ? '🎉' : '😞'}
          </div>
          <h2 className="results-title">
            {isPassed ? 'Quiz Passed!' : 'Quiz Failed'}
          </h2>
        </div>

        {/* Score Display */}
        <div className="results-score">
          <div className="score-circle">
            <div className="score-percentage">
              {results.scorePercentage}%
            </div>
            <div className="score-details">
              {results.correctAnswers} / {results.totalQuestions}
            </div>
          </div>
        </div>

        {/* Player Info */}
        <div className="results-players">
          <div className="result-player">
            <span className="player-label">Caught Player:</span>
            <span className="player-name caught-name">
              {results.caughtName}
            </span>
          </div>
          <div className="result-player">
            <span className="player-label">Unicorn:</span>
            <span className="player-name unicorn-name">
              🦄 {results.unicornName}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="results-stats">
          <div className="stat-item">
            <span className="stat-label">Time Taken:</span>
            <span className="stat-value">{timeInSeconds}s</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Status:</span>
            <span className={`stat-value ${results.isTimeout ? 'timeout' : 'completed'}`}>
              {results.isTimeout ? '⏱️ Timeout' : '✓ Completed'}
            </span>
          </div>
        </div>

        {/* Message */}
        <div className={`results-message ${isPassed ? 'success' : 'failure'}`}>
          {isPassed 
            ? '🎊 Great job! You answered correctly!' 
            : '💪 Better luck next time!'}
        </div>

        <div className="results-footer">
          Game will resume shortly...
        </div>
      </div>
    </div>
  );
}

export default QuizResults;
