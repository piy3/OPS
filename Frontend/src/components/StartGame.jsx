import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import '../App.css'
import { maze, MAZE_ROWS, MAZE_COLS, isWall } from '../maze'

function StartGame() {
  const navigate = useNavigate()
  const { socketService, roomData, gameState } = useSocket()
  
  // Player starting position (row 1, col 1 is an empty space)
  const [playerPos, setPlayerPos] = useState({ row: 1, col: 1 })
  const [playerPixelPos, setPlayerPixelPos] = useState({ x: 0, y: 0 })
  const [direction, setDirection] = useState(null) // null, 'up', 'down', 'left', 'right'
  const [remotePlayers, setRemotePlayers] = useState({}) // { playerId: { x, y, name } }
  const [remotePlayerPixelPos, setRemotePlayerPixelPos] = useState({}) // { playerId: { x, y } }
  
  const directionRef = useRef(null)
  const playerPixelPosRef = useRef({ x: 0, y: 0 })
  const targetGridPosRef = useRef({ row: 1, col: 1 })
  const animationFrameRef = useRef(null)
  const moveSpeed = 150 // milliseconds per cell
  const playerRef = useRef(null)
  const mazeContainerRef = useRef(null)
  const pendingDirectionRef = useRef(null) // Store pending direction change
  const lastFrameTimeRef = useRef(null) // Track time for smooth animation
  const lastPositionSentRef = useRef({ row: 1, col: 1 }) // Track last sent position
  const remotePlayerPositionsRef = useRef({}) // { playerId: { current: {x,y}, target: {x,y} } }
  const lastPositionUpdateTimeRef = useRef(0) // Track when we last sent position update

  // Check if we're in a game
  useEffect(() => {
    if (!roomData || !gameState) {
      console.log('No room or game state, redirecting to home')
      // navigate('/')
    }
  }, [roomData, gameState, navigate])

  // Setup socket listeners for multiplayer
  useEffect(() => {
    // Listen for position updates from other players
    const handlePositionUpdate = (data) => {
      const { playerId, position } = data
      
      // Don't update our own position
      if (playerId === socketService.getSocket()?.id) return
      
      // Update remote player target position for smooth interpolation
      const player = roomData?.players?.find(p => p.id === playerId)
      const playerName = player?.name || 'Player'
      
      setRemotePlayers(prev => {
        const existing = prev[playerId]
        return {
          ...prev,
          [playerId]: {
            x: position.x,
            y: position.y,
            name: playerName,
            timestamp: Date.now()
          }
        }
      })
      
      // Update target position for smooth interpolation
      if (!remotePlayerPositionsRef.current[playerId]) {
        // Initialize both current and target to the same position
        remotePlayerPositionsRef.current[playerId] = {
          current: { x: position.x, y: position.y },
          target: { x: position.x, y: position.y }
        }
        setRemotePlayerPixelPos(prev => ({
          ...prev,
          [playerId]: { x: position.x, y: position.y }
        }))
      } else {
        // Update target position, keep current position for smooth interpolation
        // This allows the player to smoothly move from current to target
        remotePlayerPositionsRef.current[playerId].target = { x: position.x, y: position.y }
      }
    }

    // Listen for game state sync (initial positions)
    const handleGameStateSync = (data) => {
      if (data.gameState && data.gameState.players) {
        const newRemotePlayers = {}
        const newRemotePixelPos = {}
        const newRemotePositions = {}
        
        data.gameState.players.forEach(player => {
          if (player.id !== socketService.getSocket()?.id && player.position) {
            newRemotePlayers[player.id] = {
              x: player.position.x,
              y: player.position.y,
              name: player.name
            }
            newRemotePixelPos[player.id] = {
              x: player.position.x,
              y: player.position.y
            }
            newRemotePositions[player.id] = {
              current: { x: player.position.x, y: player.position.y },
              target: { x: player.position.x, y: player.position.y }
            }
          }
        })
        setRemotePlayers(newRemotePlayers)
        setRemotePlayerPixelPos(newRemotePixelPos)
        remotePlayerPositionsRef.current = newRemotePositions
      }
    }

    // Listen for game started event
    const handleGameStarted = () => {
      console.log('Game started!')
      // Request initial game state
      socketService.getGameState()
    }

    socketService.onPlayerPositionUpdate(handlePositionUpdate)
    socketService.onGameStateSync(handleGameStateSync)
    socketService.onGameStarted(handleGameStarted)

    // Request initial game state
    socketService.getGameState()

    // Listen for player leaving to clean up their data
    const handlePlayerLeft = (data) => {
      const { playerId } = data
      setRemotePlayers(prev => {
        const updated = { ...prev }
        delete updated[playerId]
        return updated
      })
      setRemotePlayerPixelPos(prev => {
        const updated = { ...prev }
        delete updated[playerId]
        return updated
      })
      delete remotePlayerPositionsRef.current[playerId]
    }

    socketService.onPlayerLeft(handlePlayerLeft)

    // Cleanup
    return () => {
      socketService.off('player_position_update', handlePositionUpdate)
      socketService.off('game_state_sync', handleGameStateSync)
      socketService.off('game_started', handleGameStarted)
      socketService.off('player_left', handlePlayerLeft)
    }
  }, [socketService, roomData])

  // Send position updates to server (more frequently for smoother remote player movement)
  const sendPositionUpdate = (pixelX, pixelY) => {
    const now = Date.now()
    // Send updates every 33ms (~30 times per second) for very smooth remote player movement
    if (now - lastPositionUpdateTimeRef.current > 33) {
      socketService.updatePosition({ x: pixelX, y: pixelY })
      lastPositionUpdateTimeRef.current = now
    }
  }

  // Keep directionRef in sync with direction state
  useEffect(() => {
    directionRef.current = direction
  }, [direction])

  // Handle keyboard input
  useEffect(() => {
    const handleKeyPress = (e) => {
      const key = e.key.toLowerCase()
      let newDirection = null

      if (key === 'arrowup' || key === 'w') {
        newDirection = 'up'
      } else if (key === 'arrowdown' || key === 's') {
        newDirection = 'down'
      } else if (key === 'arrowleft' || key === 'a') {
        newDirection = 'left'
      } else if (key === 'arrowright' || key === 'd') {
        newDirection = 'right'
      } else if (key === 'escape') {
        // Leave game
        socketService.leaveRoom()
        navigate('/')
        return
      }

      if (newDirection) {
        // Check if there's a wall in the new direction
        const { row, col } = targetGridPosRef.current
        let checkRow = row
        let checkCol = col
        
        switch (newDirection) {
          case 'up':
            checkRow = row - 1
            break
          case 'down':
            checkRow = row + 1
            break
          case 'left':
            checkCol = col - 1
            break
          case 'right':
            checkCol = col + 1
            break
        }
        
        // Only allow direction change if there's no wall
        if (!isWall(checkRow, checkCol)) {
          // Check if player is aligned with grid (at a turn point)
          const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
          const current = playerPixelPosRef.current
          const targetX = targetGridPosRef.current.col * cellSize + cellSize / 2
          const targetY = targetGridPosRef.current.row * cellSize + cellSize / 2
          
          // Use a more lenient threshold (30% of cell size) for better responsiveness
          const threshold = cellSize * 0.3
          const dx = Math.abs(current.x - targetX)
          const dy = Math.abs(current.y - targetY)
          const isAligned = dx < threshold && dy < threshold
          
          if (isAligned) {
            // Player is at a turn point, apply direction immediately
            setDirection(newDirection)
            pendingDirectionRef.current = null
          } else {
            // Player is not aligned yet, queue the direction change
            pendingDirectionRef.current = newDirection
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [navigate, socketService])

  // Game loop for continuous movement (grid position updates)
  useEffect(() => {
    const moveInterval = setInterval(() => {
      if (!directionRef.current) return

      setPlayerPos((prevPos) => {
        const { row, col } = prevPos
        let newRow = row
        let newCol = col

        // Calculate new position based on direction
        switch (directionRef.current) {
          case 'up':
            newRow = row - 1
            break
          case 'down':
            newRow = row + 1
            break
          case 'left':
            newCol = col - 1
            break
          case 'right':
            newCol = col + 1
            break
          default:
            return prevPos
        }

        // Check if the new position is valid (not a wall)
        if (!isWall(newRow, newCol)) {
          targetGridPosRef.current = { row: newRow, col: newCol }
          return { row: newRow, col: newCol }
        }
        // If it's a wall, stop moving (don't change position)
        return prevPos
      })
    }, moveSpeed)

    return () => clearInterval(moveInterval)
  }, [])

  // Smooth animation loop using requestAnimationFrame
  useEffect(() => {
    const calculateCellSize = () => {
      return Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
    }
    
    const animate = (currentTime) => {
      const cellSize = calculateCellSize()
      
      // Initialize last frame time
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = currentTime
      }
      
      // Calculate time delta for smooth, frame-rate independent movement
      const deltaTime = currentTime - lastFrameTimeRef.current
      lastFrameTimeRef.current = currentTime
      
      // Calculate target pixel position
      const targetX = targetGridPosRef.current.col * cellSize + cellSize / 2
      const targetY = targetGridPosRef.current.row * cellSize + cellSize / 2
      
      // Smooth interpolation with time-based movement
      const current = playerPixelPosRef.current
      const dx = targetX - current.x
      const dy = targetY - current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      // Use time-based interpolation for consistent smoothness
      if (distance > 0.1) {
        const pixelsPerMs = cellSize / moveSpeed
        const moveAmount = pixelsPerMs * deltaTime
        
        // Move towards target, but don't overshoot
        if (moveAmount >= distance) {
          current.x = targetX
          current.y = targetY
        } else {
          const ratio = moveAmount / distance
          current.x += dx * ratio
          current.y += dy * ratio
        }
      } else {
        current.x = targetX
        current.y = targetY
      }
      
      // Send position update for local player (more frequently for smoother remote movement)
      sendPositionUpdate(current.x, current.y)
      
      // Check if we have a pending direction change and player is now aligned
      if (pendingDirectionRef.current) {
        const threshold = cellSize * 0.3
        const dx = Math.abs(current.x - targetX)
        const dy = Math.abs(current.y - targetY)
        const isAligned = dx < threshold && dy < threshold
        
        if (isAligned) {
          setDirection(pendingDirectionRef.current)
          pendingDirectionRef.current = null
        }
      }
      
      // Smooth interpolation for remote players - update every frame for smooth movement
      const updatedRemotePositions = {}
      let needsUpdate = false
      
      Object.keys(remotePlayerPositionsRef.current).forEach(playerId => {
        const playerPos = remotePlayerPositionsRef.current[playerId]
        if (!playerPos) return
        
        const currentPos = playerPos.current
        const targetPos = playerPos.target
        const dx = targetPos.x - currentPos.x
        const dy = targetPos.y - currentPos.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        if (distance > 0.1) {
          // Interpolate towards target at the same speed as local player
          const pixelsPerMs = cellSize / moveSpeed
          const moveAmount = pixelsPerMs * deltaTime
          
          if (moveAmount >= distance) {
            currentPos.x = targetPos.x
            currentPos.y = targetPos.y
          } else {
            const ratio = moveAmount / distance
            currentPos.x += dx * ratio
            currentPos.y += dy * ratio
          }
          needsUpdate = true
        } else if (distance > 0.01) {
          // Very close, snap to target
          currentPos.x = targetPos.x
          currentPos.y = targetPos.y
          needsUpdate = true
        }
        
        // Always collect position for rendering
        updatedRemotePositions[playerId] = { x: currentPos.x, y: currentPos.y }
      })
      
      // Update state every frame for smooth rendering (React will batch these efficiently)
      if (Object.keys(updatedRemotePositions).length > 0) {
        // Use functional update to ensure we get the latest state
        setRemotePlayerPixelPos(prev => {
          const newState = { ...prev }
          Object.keys(updatedRemotePositions).forEach(playerId => {
            newState[playerId] = updatedRemotePositions[playerId]
          })
          return newState
        })
      }
      
      // Update state for rendering
      setPlayerPixelPos({ x: current.x, y: current.y })
      
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    
    // Initialize pixel position
    const cellSize = calculateCellSize()
    const initialX = playerPos.col * cellSize + cellSize / 2
    const initialY = playerPos.row * cellSize + cellSize / 2
    playerPixelPosRef.current = { x: initialX, y: initialY }
    targetGridPosRef.current = { row: playerPos.row, col: playerPos.col }
    setPlayerPixelPos({ x: initialX, y: initialY })
    lastFrameTimeRef.current = null
    
    animationFrameRef.current = requestAnimationFrame(animate)
    
    // Handle window resize
    const handleResize = () => {
      const newCellSize = calculateCellSize()
      const newX = targetGridPosRef.current.col * newCellSize + newCellSize / 2
      const newY = targetGridPosRef.current.row * newCellSize + newCellSize / 2
      playerPixelPosRef.current = { x: newX, y: newY }
      setPlayerPixelPos({ x: newX, y: newY })
    }
    
    window.addEventListener('resize', handleResize)
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('resize', handleResize)
    }
  }, [playerPos])

  // Calculate player position as percentage
  const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
  const mazeWidth = cellSize * MAZE_COLS
  const mazeHeight = cellSize * MAZE_ROWS
  const playerLeftPercent = (playerPixelPos.x / mazeWidth) * 100
  const playerTopPercent = (playerPixelPos.y / mazeHeight) * 100

  return (
    <div className="game-container">
      {/* Game Info HUD */}
      <div className="game-hud">
        <div className="hud-item">
          Room: {roomData?.code || 'N/A'}
        </div>
        <div className="hud-item">
          Players: {Object.keys(remotePlayers).length + 1}
        </div>
        <div className="hud-item">
          Press ESC to leave
        </div>
      </div>

      <div className="maze-container" ref={mazeContainerRef}>
        {maze.map((row, rowIndex) => (
          <div key={rowIndex} className="maze-row">
            {row.map((cell, colIndex) => (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`maze-cell ${cell === 1 ? 'wall' : 'empty'}`}
              />
            ))}
          </div>
        ))}
        
        {/* Local Player */}
        <div
          ref={playerRef}
          className="player local-player"
          style={{
            left: `${playerLeftPercent}%`,
            top: `${playerTopPercent}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />

        {/* Remote Players */}
        {Object.entries(remotePlayers).map(([playerId, player]) => {
          // Use interpolated pixel position for smooth movement
          const pixelPos = remotePlayerPixelPos[playerId] || { x: player.x, y: player.y }
          const remoteLeftPercent = (pixelPos.x / mazeWidth) * 100
          const remoteTopPercent = (pixelPos.y / mazeHeight) * 100
          
          return (
            <div key={playerId}>
              <div
                className="player remote-player"
                style={{
                  left: `${remoteLeftPercent}%`,
                  top: `${remoteTopPercent}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
              <div
                className="player-name"
                style={{
                  left: `${remoteLeftPercent}%`,
                  top: `${remoteTopPercent}%`,
                  transform: 'translate(-50%, calc(-100% - 10px))',
                }}
              >
                {player.name}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default StartGame
