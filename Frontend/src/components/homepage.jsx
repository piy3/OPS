import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRoom } from '../context/RoomContext'
import log from '../utils/logger'
import './homepage.css'

function HomePage() {
  const navigate = useNavigate()
  // Use focused RoomContext - homepage doesn't need combat or game phase state
  const { socketService, setRoomData, roomData, players } = useRoom()
  const [hoveredButton, setHoveredButton] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [isFetchingRoomId, setIsFetchingRoomId] = useState(false)
  const [joinRoomIdInput, setJoinRoomIdInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [playerName, setPlayerName] = useState('')

  const handleCreateRoom = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    setShowCreateModal(true)
    setIsFetchingRoomId(true)
    setError('')
    
    try {
      // Create room via socket
      const data = await socketService.createRoom(playerName.trim(), 9)
      log.log('Room created:', data)
      setRoomId(data.roomCode)
      setRoomData(data.room)
      setIsFetchingRoomId(false)
    } catch (err) {
      log.error('Error creating room:', err)
      setError('Failed to create room. Please try again.')
      setIsFetchingRoomId(false)
      setShowCreateModal(false)
    }
  }

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    setShowJoinModal(true)
    setError('')
  }

  const handleCopyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      log.error('Failed to copy:', err)
    }
  }

  const handleJoinRoomSubmit = async () => {
    if (!joinRoomIdInput.trim()) {
      setError('Please enter a room ID')
      return
    }
    
    if (!playerName.trim()) {
      setError('Please enter your name')
      return
    }

    setError('')
    
    try {
      // Join room via socket
      const data = await socketService.joinRoom(joinRoomIdInput.trim(), playerName.trim())
      log.log('Joined room:', data)
      setRoomId(data.roomCode)
      setRoomData(data.room)
    } catch (err) {
      log.error('Error joining room:', err)
      setError(err.message || 'Failed to join room. Please check the room ID.')
    }
  }

  const handleEnterGame = () => {
    navigate('/startgame')
  }

  const handleStartGame = () => {
    // Host starts the game
    socketService.startGame()
    // Game started event will be handled in SocketContext
    // which will trigger navigation via the useEffect in this component or globally
  }

  const closeModal = () => {
    // Leave room when closing modal
    if (roomId) {
      socketService.leaveRoom()
    }
    setShowCreateModal(false)
    setShowJoinModal(false)
    setRoomId('')
    setJoinRoomIdInput('')
    setIsFetchingRoomId(false)
    setError('')
    setRoomData(null) // This also clears players (derived from roomData)
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
            <span className="title-letter">W</span>
            <span className="title-letter">A</span>
            <span className="title-letter">Y</span>
            <span className="title-letter">M</span>
            <span className="title-letter">A</span>
            <span className="title-letter">Z</span>
            <span className="title-letter">E</span>
          </h1>
          <p className="game-subtitle">Navigate through the labyrinth</p>
        </div>

        {/* Player Name Input */}
        <div className="name-input-section">
          <input
            type="text"
            className="player-name-input"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={20}
          />
        </div>

        {error && <div className="error-message">{error}</div>}

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
                  <h3 className="users-title">Joined Users ({players.length})</h3>
                  <div className="users-list">
                    {players.map((player, index) => (
                      <div key={index} className="user-item">
                        <span className="user-avatar">👤</span>
                        <span className="user-name">
                          {player.name} {player.isHost && '(Host)'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {players.length > 0 && players[0].isHost && players[0].id === socketService.getSocket()?.id && (
                  <button className="enter-game-button" onClick={handleStartGame}>
                    Start Game
                  </button>
                )}
                
                {!(players.length > 0 && players[0].isHost && players[0].id === socketService.getSocket()?.id) && (
                  <div className="waiting-message">Waiting for host to start the game...</div>
                )}
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

            {error && <div className="error-message">{error}</div>}

            {players.length > 0 && (
              <>
                <div className="users-section">
                  <h3 className="users-title">Current Users ({players.length})</h3>
                  <div className="users-list">
                    {players.map((player, index) => (
                      <div key={index} className="user-item">
                        <span className="user-avatar">👤</span>
                        <span className="user-name">
                          {player.name} {player.isHost && '(Host)'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {players[0].isHost && players[0].id === socketService.getSocket()?.id ? (
                  <button className="enter-game-button" onClick={handleStartGame}>
                    Start Game
                  </button>
                ) : (
                  <div className="waiting-message">Waiting for host to start the game...</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default HomePage
