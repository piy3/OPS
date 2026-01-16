import './FreezeOverlay.css';

function FreezeOverlay({ message }) {
  if (!message) return null;

  return (
    <div className="freeze-overlay">
      <div className="freeze-content">
        <div className="freeze-icon">❄️</div>
        <h1 className="freeze-message">{message.text}</h1>
        <p className="freeze-subtitle">Game Paused - Quiz in Progress</p>
        <div className="freeze-details">
          <div className="freeze-player unicorn-badge">
            🦄 {message.unicornName}
          </div>
          <div className="freeze-vs">vs</div>
          <div className="freeze-player caught-badge">
            🎯 {message.caughtName}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FreezeOverlay;
