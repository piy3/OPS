import { useEffect, useState } from 'react';
import { useRoom } from '../context/RoomContext';
import './BlitzQuizResults.css';

function BlitzQuizResults({ results }) {
  // Only need socketService - use focused RoomContext to avoid re-renders from combat/phase changes
  const { socketService } = useRoom();
  const [countdown, setCountdown] = useState(3);
  const myId = socketService?.getSocket()?.id;

  // Countdown to hunt phase
  useEffect(() => {
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown(prev => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  if (!results) return null;

  const isWinner = results.newUnicornId === myId;
  const isReserve = results.reserveUnicornId === myId;
  const myRanking = results.rankings?.find(r => r.playerId === myId);

  return (
    <div className="blitz-results-overlay">
      <div className="blitz-results-modal">
        {/* Header */}
        <div className="blitz-results-header">
          <h2>⚡ BLITZ QUIZ RESULTS ⚡</h2>
        </div>

        {/* Winner Announcement */}
        <div className="winner-announcement">
          {isWinner ? (
            <div className="you-are-unicorn">
              <span className="unicorn-icon">🦄</span>
              <h3>YOU ARE THE UNICORN!</h3>
              <p>Hunt down the survivors!</p>
            </div>
          ) : isReserve ? (
            <div className="you-are-reserve">
              <span className="reserve-icon">🥈</span>
              <h3>YOU ARE THE RESERVE!</h3>
              <p>You'll become unicorn if current one is tagged</p>
            </div>
          ) : (
            <div className="you-are-survivor">
              <span className="survivor-icon">🏃</span>
              <h3>YOU ARE A SURVIVOR!</h3>
              <p>Run from {results.newUnicornName}!</p>
            </div>
          )}
        </div>

        {/* Correct Answer */}
        <div className="correct-answer-section">
          <div className="question-text">Q: {results.question}</div>
          <div className="answer-text">A: {results.correctAnswer}</div>
        </div>

        {/* Rankings */}
        <div className="blitz-rankings">
          <h4>Rankings ({results.correctCount}/{results.totalPlayers} correct)</h4>
          <div className="rankings-list">
            {results.rankings && results.rankings.length > 0 ? (
              results.rankings.map((ranking, index) => (
                <div 
                  key={ranking.playerId}
                  className={`ranking-item ${
                    ranking.isUnicorn ? 'unicorn-ranking' : ''
                  } ${
                    ranking.isReserve ? 'reserve-ranking' : ''
                  } ${
                    ranking.playerId === myId ? 'my-ranking' : ''
                  }`}
                >
                  <span className="rank">#{ranking.rank}</span>
                  <span className="text-[#9ca3af] text-[0.9rem] text-center font-mono">
                    {ranking.isUnicorn && '🦄 '}
                    {ranking.isReserve && '🥈 '}
                    {ranking.playerName}
                    {ranking.playerId === myId && ' (You)'}
                  </span>
                  <span className="response-time">{(ranking.responseTime / 1000).toFixed(2)}s</span>
                </div>
              ))
            ) : (
              <div className="no-correct-answers">
                No correct answers! Random unicorn selected.
              </div>
            )}
          </div>
        </div>

        {/* Countdown to Hunt */}
        <div className="hunt-countdown">
          <div className="countdown-label">Hunt begins in</div>
          <div className="countdown-number">{countdown}</div>
        </div>
      </div>
    </div>
  );
}

export default BlitzQuizResults;
