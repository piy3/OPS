import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './homepage.css'

function HomePage() {
  const navigate = useNavigate()
  const [hoveredButton, setHoveredButton] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [isFetchingRoomId, setIsFetchingRoomId] = useState(false)
  const [joinedUsers, setJoinedUsers] = useState([])
  const [joinRoomIdInput, setJoinRoomIdInput] = useState('')
  const [copied, setCopied] = useState(false)

  // Generate a random room ID (in real app, this would come from backend)
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
  }

  const handleCreateRoom = () => {
    setShowCreateModal(true)
    setIsFetchingRoomId(true)
    setJoinedUsers(['You']) // Add creator as first user
    
    // Simulate fetching room ID
    setTimeout(() => {
      const newRoomId = generateRoomId()
      setRoomId(newRoomId)
      setIsFetchingRoomId(false)
    }, 1500)
  }

  const handleJoinRoom = () => {
    setShowJoinModal(true)
    setJoinedUsers([])
  }

  const handleCopyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleJoinRoomSubmit = () => {
    if (!joinRoomIdInput.trim()) {
      alert('Please enter a room ID')
      return
    }
    
    // Simulate joining room and fetching users
    setJoinedUsers(['User1', 'User2', 'You'])
    // In real app, you would validate the room ID and fetch users from backend
  }

  const handleEnterGame = () => {
    navigate('/startgame')
  }

  const closeModal = () => {
    setShowCreateModal(false)
    setShowJoinModal(false)
    setRoomId('')
    setJoinRoomIdInput('')
    setJoinedUsers([])
    setIsFetchingRoomId(false)
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

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>×</button>
            <h2 className="modal-title">Create Room</h2>
            
            {isFetchingRoomId ? (
              <div className="loading-container">
                <div className="loading-spinner"></div>
                <p className="loading-text">Fetching room ID...</p>
              </div>
            ) : (
              <>
                <div className="room-id-section">
                  <label className="room-id-label">Room ID</label>
                  <div className="room-id-container">
                    <span className="room-id-value">{roomId}</span>
                    <button 
                      className={`copy-button ${copied ? 'copied' : ''}`}
                      onClick={handleCopyRoomId}
                    >
                      {copied ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                </div>

                <div className="users-section">
                  <h3 className="users-title">Joined Users ({joinedUsers.length})</h3>
                  <div className="users-list">
                    {joinedUsers.map((user, index) => (
                      <div key={index} className="user-item">
                        <span className="user-avatar">👤</span>
                        <span className="user-name">{user}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button className="enter-game-button" onClick={handleEnterGame}>
                  Enter Game
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Join Room Modal */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>×</button>
            <h2 className="modal-title">Join Room</h2>
            
            <div className="room-id-input-section">
              <label className="room-id-label">Enter Room ID</label>
              <input
                type="text"
                className="room-id-input"
                placeholder="Enter room ID"
                value={joinRoomIdInput}
                onChange={(e) => setJoinRoomIdInput(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button 
                className="join-room-submit-button"
                onClick={handleJoinRoomSubmit}
              >
                Join Room
              </button>
            </div>

            {joinedUsers.length > 0 && (
              <div className="users-section">
                <h3 className="users-title">Current Users ({joinedUsers.length})</h3>
                <div className="users-list">
                  {joinedUsers.map((user, index) => (
                    <div key={index} className="user-item">
                      <span className="user-avatar">👤</span>
                      <span className="user-name">{user}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {joinedUsers.length > 0 && (
              <button className="enter-game-button" onClick={handleEnterGame}>
                Enter Game
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default HomePage
