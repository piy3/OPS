import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './homepage.css'

function HomePage() {
  const navigate = useNavigate()
  const [hoveredButton, setHoveredButton] = useState(null)

  const handleCreateRoom = () => {
    // TODO: Implement create room logic
    console.log('Create room clicked')
    navigate('/startgame')
  }

  const handleJoinRoom = () => {
    // TODO: Implement join room logic
    console.log('Join room clicked')
    navigate('/startgame')
  }

  return (
    <div className="homepage-container">
      <div className="background-animation">
        <div className="gradient-orb orb-1"></div>
        <div className="gradient-orb orb-2"></div>
        <div className="gradient-orb orb-3"></div>
      </div>
      
      <div className="homepage-content">
        <div className="logo-section">
          <h1 className="game-title">
            <span className="title-letter">M</span>
            <span className="title-letter">A</span>
            <span className="title-letter">Z</span>
            <span className="title-letter">E</span>
            <span className="title-letter"> </span>
            <span className="title-letter">G</span>
            <span className="title-letter">A</span>
            <span className="title-letter">M</span>
            <span className="title-letter">E</span>
          </h1>
          <p className="game-subtitle">Navigate through the labyrinth</p>
        </div>

        <div className="button-container">
          <button
            className={`action-button create-room ${hoveredButton === 'create' ? 'hovered' : ''}`}
            onMouseEnter={() => setHoveredButton('create')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={handleCreateRoom}
          >
            <span className="button-icon">🏠</span>
            <span className="button-text">Create Room</span>
            <div className="button-shine"></div>
          </button>

          <button
            className={`action-button join-room ${hoveredButton === 'join' ? 'hovered' : ''}`}
            onMouseEnter={() => setHoveredButton('join')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={handleJoinRoom}
          >
            <span className="button-icon">🚪</span>
            <span className="button-text">Join Room</span>
            <div className="button-shine"></div>
          </button>
        </div>

        <div className="features-section">
         
          <div className="feature-card">
            <div className="feature-icon">🎮</div>
            <p className="feature-text">Multiplayer support</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🏆</div>
            <p className="feature-text">Compete with friends</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomePage
