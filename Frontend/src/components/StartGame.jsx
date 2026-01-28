import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSocket, GAME_PHASE, PLAYER_STATE, COMBAT_CONFIG } from '../context/SocketContext'
import { useSound } from '../context/SoundContext'
import '../App.css'
import { maze, MAZE_ROWS, MAZE_COLS, isWall, hasWrapAround, getWrappedCol, getWallBorders } from '../maze'
import FreezeOverlay from './FreezeOverlay'
import QuizModal from './QuizModal'
import QuizResults from './QuizResults'
import BlitzQuizModal from './BlitzQuizModal'
import BlitzQuizResults from './BlitzQuizResults'
import PhaserPlayerLayer from './PhaserPlayerLayer'
import coinAnimation from '../assets/coinAnimation.gif'

function StartGame() {
  const navigate = useNavigate()
  const { 
    socketService, 
    roomData, 
    gameState, 
    unicornId, 
    leaderboard,
    isGameFrozen,
    freezeMessage,
    quizActive,
    quizResults,
    // Game Loop state
    gamePhase,
    blitzQuizActive,
    blitzQuizData,
    blitzQuizResults,
    huntData,
    huntTimeRemaining,
    reserveUnicornId,
    tagNotification,
    // Combat System state
    playersHealth,
    hitNotification,
    myPlayerState,
    myHealth,
    inIFrames,
    // Coin & Powerup state
    coins,
    powerups,
    coinCollectNotification,
    powerupCollectNotification,
    isImmune,
    immunePlayers,
    // Knockback state
    knockbackActive,
    knockbackPlayers
  } = useSocket()
  
  // Sound controls
  const { volume, muted, setVolume, toggleMute } = useSound()
  
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showCoordinates, setShowCoordinates] = useState(false)
  const [showSoundControls, setShowSoundControls] = useState(false)
  
  const [playerPos, setPlayerPos] = useState({ row: null, col: null })
  const [playerPixelPos, setPlayerPixelPos] = useState({ x: 0, y: 0 })
  const [direction, setDirection] = useState(null) // null, 'up', 'down', 'left', 'right'
  const [facingDirection, setFacingDirection] = useState('right') // Track which way the player is facing: 'up', 'down', 'left', 'right'
  const [remotePlayers, setRemotePlayers] = useState({}) // { playerId: { x, y, name } }
  const [remotePlayerPixelPos, setRemotePlayerPixelPos] = useState({}) // { playerId: { x, y } }
  const [remotePlayerDirections, setRemotePlayerDirections] = useState({}) // { playerId: 'up' | 'down' | 'left' | 'right' }
  
  const directionRef = useRef(null)
  const playerPixelPosRef = useRef({ x: 0, y: 0 })
  const targetGridPosRef = useRef({ row: 1, col: 1 })
  const animationFrameRef = useRef(null)
  const lastAnimationTimestampRef = useRef(0) // Track last frame timestamp for delta time
  const moveSpeed = 150 // milliseconds per cell
  const playerRef = useRef(null)
  const mazeContainerRef = useRef(null)
  const pendingDirectionRef = useRef(null) // Store pending direction change
  const lastPositionSentRef = useRef({ row: 1, col: 1 }) // Track last sent position
  const lastGridPosRef = useRef({ row: 1, col: 1 }) // Track last grid position to detect wraps
  const remotePlayerPositionsRef = useRef({}) // { playerId: { current: {x,y}, target: {x,y}, row, col } }
  const lastPositionUpdateTimeRef = useRef(0) // Track when we last sent position update
  const phaserLayerRef = useRef(null) // Phaser player layer reference
  const previousPowerupsRef = useRef([]) // Track previous powerups for aura management
  const [usePhaserRendering, setUsePhaserRendering] = useState(true) // Toggle between Phaser and DOM rendering
  const [usePhaserMaze, setUsePhaserMaze] = useState(true) // Whether to render maze via Phaser tilemap
  const [phaserMazeReady, setPhaserMazeReady] = useState(false) // Whether Phaser maze has loaded
  const [mazeDimensions, setMazeDimensions] = useState({ width: window.innerWidth, height: window.innerHeight })

  // Memoize the maze grid since it never changes - prevents recalculating borders on every render
  const mazeGrid = useMemo(() => {
    return maze.map((row, rowIndex) => (
      <div key={rowIndex} className="maze-row">
        {row.map((cell, colIndex) => {
          const borders = cell === 1 ? getWallBorders(rowIndex, colIndex) : null;
          return (
            <div
              key={`${rowIndex}-${colIndex}`}
              className={`maze-cell ${cell === 1 ? 'wall' : 'empty'}`}
            >
              {borders && (
                <>
                  {borders.top && (
                    <div className={`wall-border wall-border-top${borders.corners.topLeft ? ' has-corner-left' : ''}${borders.corners.topRight ? ' has-corner-right' : ''}`} />
                  )}
                  {borders.bottom && (
                    <div className={`wall-border wall-border-bottom${borders.corners.bottomLeft ? ' has-corner-left' : ''}${borders.corners.bottomRight ? ' has-corner-right' : ''}`} />
                  )}
                  {borders.left && (
                    <div className={`wall-border wall-border-left${borders.corners.topLeft ? ' has-corner-top' : ''}${borders.corners.bottomLeft ? ' has-corner-bottom' : ''}`} />
                  )}
                  {borders.right && (
                    <div className={`wall-border wall-border-right${borders.corners.topRight ? ' has-corner-top' : ''}${borders.corners.bottomRight ? ' has-corner-bottom' : ''}`} />
                  )}
                  {borders.corners.topLeft && (
                    <div className="wall-corner wall-corner-top-left" />
                  )}
                  {borders.corners.topRight && (
                    <div className="wall-corner wall-corner-top-right" />
                  )}
                  {borders.corners.bottomLeft && (
                    <div className="wall-corner wall-corner-bottom-left" />
                  )}
                  {borders.corners.bottomRight && (
                    <div className="wall-corner wall-corner-bottom-right" />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    ));
  }, []); // Empty deps - maze never changes

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
      
      // IMPORTANT: If this is OUR position (e.g., server respawned us), update local position immediately
      if (playerId === socketService.getSocket()?.id) {
        console.log('Received position update for SELF (respawn):', position);
        if (typeof position.row === 'number' && typeof position.col === 'number') {
          const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS);
          const newPixelX = position.col * cellSize + cellSize / 2;
          const newPixelY = position.row * cellSize + cellSize / 2;
          
          // Update local player position immediately
          setPlayerPos({ row: position.row, col: position.col });
          targetGridPosRef.current = { row: position.row, col: position.col };
          playerPixelPosRef.current = { x: newPixelX, y: newPixelY };
          setPlayerPixelPos({ x: newPixelX, y: newPixelY });
          lastGridPosRef.current = { row: position.row, col: position.col };
          
          console.log(`✅ Local position updated to: row=${position.row}, col=${position.col}`);
        }
        return; // Don't process as remote player
      }
      
      // CRITICAL: Ignore position updates if we haven't initialized this player with spawn position yet
      // This prevents gliding from (1,1) or (0,0) to spawn position
      if (!remotePlayerPositionsRef.current[playerId] || !remotePlayerPositionsRef.current[playerId].spawnInitialized) {
        // Player hasn't been initialized with spawn position yet, ignore this update
        // The spawn position will come from gameState sync
        return
      }
      
      // Update remote player target position for smooth interpolation
      const player = roomData?.players?.find(p => p.id === playerId)
      const playerName = player?.name || 'Player'
      const isUnicorn = position.isUnicorn || false
      
      setRemotePlayers(prev => {
        const existing = prev[playerId]
        return {
          ...prev,
          [playerId]: {
            x: position.x,
            y: position.y,
            name: playerName,
            isUnicorn: isUnicorn,
            timestamp: Date.now()
          }
        }
      })
      
      // Calculate pixel positions from grid positions using LOCAL cell size
      // This ensures consistency across different screen sizes
      const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
      
      // Always use grid positions to calculate target (ensures screen-size independence)
      // The grid position is the source of truth
      let targetPixelX, targetPixelY
      
      if (typeof position.row === 'number' && typeof position.col === 'number') {
        // Calculate sub-cell position for smoother movement
        // Use the fractional part of pixel position if available
        const gridCenterX = position.col * cellSize + cellSize / 2
        const gridCenterY = position.row * cellSize + cellSize / 2
        
        // If we have pixel positions from the sender, use them to calculate sub-cell offset
        // This allows for smooth interpolation between cells
        if (position.x && position.y && position.x !== 0 && position.y !== 0) {
          // The sender's pixel position represents progress within the cell
          // We need to normalize this to our local cell size
          // Extract the fractional position (how far along the cell they are)
          const senderCellSize = position.x / (position.col + 0.5) // Approximate sender's cell size
          if (senderCellSize > 0 && senderCellSize < cellSize * 3) {
            // Use proportional position within the cell
            targetPixelX = gridCenterX
            targetPixelY = gridCenterY
          } else {
            targetPixelX = gridCenterX
            targetPixelY = gridCenterY
          }
        } else {
          targetPixelX = gridCenterX
          targetPixelY = gridCenterY
        }
      } else {
        // Fallback to pixel positions if grid not available
        targetPixelX = position.x || cellSize / 2
        targetPixelY = position.y || cellSize / 2
      }
      
      // Update target position for smooth interpolation
      if (!remotePlayerPositionsRef.current[playerId]) {
        // This shouldn't happen due to check above, but handle it just in case
        remotePlayerPositionsRef.current[playerId] = {
          current: { x: targetPixelX, y: targetPixelY },
          target: { x: targetPixelX, y: targetPixelY },
          row: position.row || 1,
          col: position.col || 1,
          lastCol: position.col || 1,
          lastRow: position.row || 1,
          initialized: true,
          spawnInitialized: true
        }
        setRemotePlayerPixelPos(prev => ({
          ...prev,
          [playerId]: { x: targetPixelX, y: targetPixelY }
        }))
      } else {
        const remotePlayerPos = remotePlayerPositionsRef.current[playerId]
        
        // If this is the first update after initialization, snap to position immediately
        // to prevent gliding from (0,0) or previous position
        if (!remotePlayerPos.initialized || !remotePlayerPos.spawnInitialized) {
          // If spawn hasn't been initialized, calculate from row/col to ensure correct position
          const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
          const spawnRow = position.row || remotePlayerPos.row || 1
          const spawnCol = position.col || remotePlayerPos.col || 1
          const spawnPixelX = spawnCol * cellSize + cellSize / 2
          const spawnPixelY = spawnRow * cellSize + cellSize / 2
          
          remotePlayerPos.current = { x: spawnPixelX, y: spawnPixelY }
          remotePlayerPos.target = { x: spawnPixelX, y: spawnPixelY }
          remotePlayerPos.row = spawnRow
          remotePlayerPos.col = spawnCol
          remotePlayerPos.lastCol = spawnCol
          remotePlayerPos.lastRow = spawnRow
          remotePlayerPos.initialized = true
          remotePlayerPos.spawnInitialized = true
          
          setRemotePlayerPixelPos(prev => ({
            ...prev,
            [playerId]: { x: spawnPixelX, y: spawnPixelY }
          }))
          return // Skip interpolation for first update
        }
        
        // Normal update with interpolation
        const lastCol = remotePlayerPos.lastCol || remotePlayerPos.col
        const lastRow = remotePlayerPos.lastRow || remotePlayerPos.row
        const newCol = position.col || remotePlayerPos.col
        const newRow = position.row || remotePlayerPos.row
        
        // Track facing direction for remote players based on movement
        if (newCol !== lastCol) {
          const colDiff = newCol - lastCol
          // Handle wrap-around for direction detection
          if (Math.abs(colDiff) < MAZE_COLS / 2) {
            // Normal movement (no wrap)
            setRemotePlayerDirections(prev => ({
              ...prev,
              [playerId]: colDiff > 0 ? 'right' : 'left'
            }))
          } else {
            // Wrap-around movement
            setRemotePlayerDirections(prev => ({
              ...prev,
              [playerId]: colDiff > 0 ? 'left' : 'right'
            }))
          }
        } else if (newRow !== lastRow) {
          // Vertical movement
          const rowDiff = newRow - lastRow
          setRemotePlayerDirections(prev => ({
            ...prev,
            [playerId]: rowDiff > 0 ? 'down' : 'up'
          }))
        }
        
        // Detect wrap-around for remote players
        const mazeWidth = cellSize * MAZE_COLS
        // Use calculated pixel position from row/col if available, otherwise use position.x
        let adjustedTargetX = (typeof position.row === 'number' && typeof position.col === 'number') 
          ? targetPixelX 
          : position.x
        let wrapDetected = false
        
        if (hasWrapAround(newRow) && hasWrapAround(remotePlayerPos.row)) {
          const colDiff = newCol - lastCol
          
          // Detect wrap from right to left (31 -> 0)
          if (colDiff < -MAZE_COLS / 2 || (lastCol === MAZE_COLS - 1 && newCol === 0)) {
            wrapDetected = true
            // Snap current position to wrapped side (right side) immediately
            // This prevents gliding across the screen
            if (remotePlayerPos.current.x < mazeWidth / 2) {
              // Current is on left, target is on right after wrap
              // Snap current to right side near target
              remotePlayerPos.current.x = targetPixelX + mazeWidth
              adjustedTargetX = targetPixelX + mazeWidth
            } else {
              // Already on right side, just update target
              adjustedTargetX = targetPixelX + mazeWidth
            }
          }
          // Detect wrap from left to right (0 -> 31)
          else if (colDiff > MAZE_COLS / 2 || (lastCol === 0 && newCol === MAZE_COLS - 1)) {
            wrapDetected = true
            // Snap current position to wrapped side (left side) immediately
            // This prevents gliding across the screen
            if (remotePlayerPos.current.x > mazeWidth / 2) {
              // Current is on right, target is on left after wrap
              // Snap current to left side near target
              remotePlayerPos.current.x = targetPixelX - mazeWidth
              adjustedTargetX = targetPixelX - mazeWidth
            } else {
              // Already on left side, just update target
              adjustedTargetX = targetPixelX - mazeWidth
            }
          }
        }
        
        // If no wrap detected, normalize positions to ensure they're in valid range
        if (!wrapDetected && hasWrapAround(newRow)) {
          // Normalize target to 0-mazeWidth range
          while (adjustedTargetX < 0) {
            adjustedTargetX += mazeWidth
          }
          while (adjustedTargetX >= mazeWidth) {
            adjustedTargetX -= mazeWidth
          }
        }
        
        // Update target position (use calculated pixel position)
        remotePlayerPos.target = { x: adjustedTargetX, y: targetPixelY }
        remotePlayerPos.row = newRow
        remotePlayerPos.col = newCol
        remotePlayerPos.lastCol = newCol
        remotePlayerPos.lastRow = newRow
        
        // Add position to buffer for velocity-based prediction (keep last 3 positions)
        const newBufferEntry = { x: adjustedTargetX, y: targetPixelY, timestamp: Date.now() }
        remotePlayerPos.buffer = [...(remotePlayerPos.buffer || []), newBufferEntry].slice(-3)
        
        // If wrap was detected, immediately update the pixel position to prevent gliding
        if (wrapDetected) {
          setRemotePlayerPixelPos(prev => ({
            ...prev,
            [playerId]: { x: remotePlayerPos.current.x, y: remotePlayerPos.current.y }
          }))
        }
      }
    }

    // Listen for game state sync (initial positions)
    const handleGameStateSync = (data) => {
      if (data.gameState && data.gameState.players) {
        const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
        const currentPlayerId = socketService.getSocket()?.id
        const newRemotePlayers = {}
        const newRemotePixelPos = {}
        const newRemotePositions = {}
        const newRemoteDirections = {}
        
        data.gameState.players.forEach(player => {
          if (player.position) {
            // Calculate pixel position from row/col to ensure consistency
            const spawnRow = player.position.row || 1
            const spawnCol = player.position.col || 1
            const spawnPixelX = spawnCol * cellSize + cellSize / 2
            const spawnPixelY = spawnRow * cellSize + cellSize / 2
            
            if (player.id === currentPlayerId) {
              // Set local player's initial position from gameState spawn position
              setPlayerPos({ row: spawnRow, col: spawnCol })
              targetGridPosRef.current = { row: spawnRow, col: spawnCol }
              playerPixelPosRef.current = { x: spawnPixelX, y: spawnPixelY }
              setPlayerPixelPos({ x: spawnPixelX, y: spawnPixelY })
              lastGridPosRef.current = { row: spawnRow, col: spawnCol }
            } else {
              // Set remote players' initial positions immediately (no interpolation on first sync)
              // This prevents gliding from (0,0) or previous position
              newRemotePlayers[player.id] = {
                x: spawnPixelX,
                y: spawnPixelY,
                name: player.name
              }
              newRemotePixelPos[player.id] = {
                x: spawnPixelX,
                y: spawnPixelY
              }
              newRemotePositions[player.id] = {
                current: { x: spawnPixelX, y: spawnPixelY },
                target: { x: spawnPixelX, y: spawnPixelY },
                row: spawnRow,
                col: spawnCol,
                lastCol: spawnCol,
                lastRow: spawnRow,
                initialized: true, // Flag to prevent gliding on first position update
                spawnInitialized: true // Flag to indicate spawn position has been set
              }
              // Initialize all remote players facing right by default
              newRemoteDirections[player.id] = 'right'
            }
          }
        })
        setRemotePlayers(newRemotePlayers)
        setRemotePlayerPixelPos(newRemotePixelPos)
        setRemotePlayerDirections(newRemoteDirections)
        remotePlayerPositionsRef.current = newRemotePositions
      }
    }

    // Listen for game started event
    const handleGameStarted = () => {
      console.log('Game started!')
      // Clear all remote player data to prevent stale positions
      // This ensures we start fresh with spawn positions
      setRemotePlayers({})
      setRemotePlayerPixelPos({})
      setRemotePlayerDirections({})
      remotePlayerPositionsRef.current = {}
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
      setRemotePlayerDirections(prev => {
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
    // Don't send position updates if game is frozen
    if (isGameFrozen) {
      // console.log('🚫 Game frozen, not sending position update'); // Commented to reduce spam
      return;
    }
    
    const now = Date.now()
    // Send updates every 33ms (~30fps) for very smooth remote player movement
    // More frequent updates = smoother interpolation on other clients
    if (now - lastPositionUpdateTimeRef.current > 33) {
      const currentGridPos = targetGridPosRef.current
      const lastGridPos = lastGridPosRef.current
      
      // Detect wrap-around: if column changed by more than 1, it's a wrap
      let adjustedX = pixelX
      const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
      const mazeWidth = cellSize * MAZE_COLS
      
      if (hasWrapAround(currentGridPos.row)) {
        const colDiff = currentGridPos.col - lastGridPos.col
        
        // Detect wrap from right to left (31 -> 0)
        if (colDiff < -MAZE_COLS / 2 || (lastGridPos.col === MAZE_COLS - 1 && currentGridPos.col === 0)) {
          // Player wrapped from right to left, adjust X to continue from right side
          adjustedX = pixelX + mazeWidth
        }
        // Detect wrap from left to right (0 -> 31)
        else if (colDiff > MAZE_COLS / 2 || (lastGridPos.col === 0 && currentGridPos.col === MAZE_COLS - 1)) {
          // Player wrapped from left to right, adjust X to continue from left side
          adjustedX = pixelX - mazeWidth
        }
      }
      
      socketService.updatePosition({ 
        x: adjustedX, 
        y: pixelY,
        row: currentGridPos.row,
        col: currentGridPos.col
      })
      lastPositionUpdateTimeRef.current = now
      lastGridPosRef.current = { ...currentGridPos }
    }
  }

  // Keep directionRef in sync with direction state
  useEffect(() => {
    directionRef.current = direction
  }, [direction])

  // Handle keyboard input
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Block all movement if game is frozen
      if (isGameFrozen) {
        return
      }
      
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
        
        // Handle wrap-around for horizontal movement
        const wrappedCheckCol = getWrappedCol(checkRow, checkCol)
        
        // Only allow direction change if there's no wall
        if (!isWall(checkRow, wrappedCheckCol)) {
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
            // Update facing direction for all directions
            setFacingDirection(newDirection)
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
  }, [navigate, socketService, isGameFrozen])

  // Game loop for continuous movement (grid position updates)
  useEffect(() => {
    const moveInterval = setInterval(() => {
      // Stop movement if game is frozen
      if (isGameFrozen) {
        console.log('❄️ Movement loop: Game is frozen, skipping movement');
        return;
      }
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

        // Handle wrap-around for rows with 0s on both ends
        const wrappedCol = getWrappedCol(newRow, newCol)
        
        // Check if the new position is valid (not a wall)
        if (!isWall(newRow, wrappedCol)) {
          targetGridPosRef.current = { row: newRow, col: wrappedCol }
          return { row: newRow, col: wrappedCol }
        }
        // If it's a wall, stop moving (don't change position)
        return prevPos
      })
    }, moveSpeed)

    return () => clearInterval(moveInterval)
  }, [isGameFrozen])

  // Smooth animation loop using requestAnimationFrame
  useEffect(() => {
    const calculateCellSize = () => {
      return Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
    }
    
    const animate = (timestamp) => {
      // Calculate delta time for frame-rate independent interpolation
      const lastTimestamp = lastAnimationTimestampRef.current || timestamp
      const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.1) // Clamp to prevent large jumps
      lastAnimationTimestampRef.current = timestamp
      
      const cellSize = calculateCellSize()
      
      // Calculate target pixel position
      const targetX = targetGridPosRef.current.col * cellSize + cellSize / 2
      const targetY = targetGridPosRef.current.row * cellSize + cellSize / 2
      
      // Smooth interpolation with time-based movement
      const current = playerPixelPosRef.current
      const currentRow = targetGridPosRef.current.row
      const mazeWidth = cellSize * MAZE_COLS
      
      // Handle wrap-around for smooth animation
      let adjustedTargetX = targetX
      if (hasWrapAround(currentRow)) {
        // Calculate distance both ways (normal and wrapped)
        const dxNormal = targetX - current.x
        const dxWrappedLeft = (targetX + mazeWidth) - current.x  // Target is to the right, wrap left
        const dxWrappedRight = (targetX - mazeWidth) - current.x  // Target is to the left, wrap right
        
        // Choose the shortest path
        if (Math.abs(dxWrappedLeft) < Math.abs(dxNormal) && targetX < current.x) {
          adjustedTargetX = targetX + mazeWidth
        } else if (Math.abs(dxWrappedRight) < Math.abs(dxNormal) && targetX > current.x) {
          adjustedTargetX = targetX - mazeWidth
        }
      }
      
      const dx = adjustedTargetX - current.x
      const dy = targetY - current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      // Use exponential smoothing for frame-rate independent interpolation
      // Factor of 8 provides responsive movement similar to qbitrig's camera smoothing
      // Formula: 1 - exp(-speed * dt) gives smooth exponential decay
      const smoothingFactor = 1 - Math.exp(-8 * dt)
      
      if (distance > 0.3) {
        // Exponential smoothing for smooth movement
        current.x += dx * smoothingFactor
        current.y += dy * smoothingFactor
        
        // Handle wrap-around: normalize position after movement
        if (hasWrapAround(currentRow)) {
          while (current.x < 0) {
            current.x += mazeWidth
          }
          while (current.x >= mazeWidth) {
            current.x -= mazeWidth
          }
        }
      } else {
        // Snap to target when very close (prevents endless tiny movements)
        current.x = targetX
        current.y = targetY
        
        // Normalize position after snapping
        if (hasWrapAround(currentRow)) {
          while (current.x < 0) {
            current.x += mazeWidth
          }
          while (current.x >= mazeWidth) {
            current.x -= mazeWidth
          }
        }
      }
      
      // Send position update for local player (only if game not frozen)
      if (!isGameFrozen) {
        sendPositionUpdate(current.x, current.y)
      }
      
      // Check if we have a pending direction change and player is now aligned
      if (pendingDirectionRef.current) {
        const threshold = cellSize * 0.3
        const dx = Math.abs(current.x - targetX)
        const dy = Math.abs(current.y - targetY)
        const isAligned = dx < threshold && dy < threshold
        
        if (isAligned) {
          const newDir = pendingDirectionRef.current
          setDirection(newDir)
          // Update facing direction for all directions
          setFacingDirection(newDir)
          pendingDirectionRef.current = null
        }
      }
      
      // Update remote players EVERY FRAME for smooth interpolation
      // Using frame-rate independent exponential smoothing with velocity prediction
      Object.keys(remotePlayerPositionsRef.current).forEach(playerId => {
        const playerPos = remotePlayerPositionsRef.current[playerId]
        if (!playerPos) return
        
        const currentPos = playerPos.current
        const targetPos = playerPos.target
        const currentRow = playerPos.row
        
        // Calculate velocity from position buffer if available
        let predictedTargetX = targetPos.x
        let predictedTargetY = targetPos.y
        
        // Use position buffer for velocity-based prediction
        if (playerPos.buffer && playerPos.buffer.length >= 2) {
          const latest = playerPos.buffer[playerPos.buffer.length - 1]
          const previous = playerPos.buffer[playerPos.buffer.length - 2]
          const timeDelta = (latest.timestamp - previous.timestamp) / 1000
          
          if (timeDelta > 0 && timeDelta < 0.5) {
            // Calculate velocity from buffer
            const vx = (latest.x - previous.x) / timeDelta
            const vy = (latest.y - previous.y) / timeDelta
            
            // Store velocity for prediction
            playerPos.velocity = { x: vx, y: vy }
            
            // Predict position based on time since last update
            const timeSinceUpdate = (Date.now() - latest.timestamp) / 1000
            if (timeSinceUpdate < 0.2) { // Only predict for short time gaps
              predictedTargetX = targetPos.x + vx * timeSinceUpdate * 0.5 // Dampen prediction
              predictedTargetY = targetPos.y + vy * timeSinceUpdate * 0.5
            }
          }
        }
        
        // Smooth lerp interpolation for remote players
        let finalTargetX = predictedTargetX
        let finalTargetY = predictedTargetY
        
        // Handle wrap-around
        if (hasWrapAround(currentRow)) {
          // Normalize target position
          while (finalTargetX < 0) finalTargetX += mazeWidth
          while (finalTargetX >= mazeWidth) finalTargetX -= mazeWidth
          
          // Choose shortest path for wrap-around
          const dxNormal = finalTargetX - currentPos.x
          const dxWrappedLeft = (finalTargetX + mazeWidth) - currentPos.x
          const dxWrappedRight = (finalTargetX - mazeWidth) - currentPos.x
          
          if (Math.abs(dxWrappedLeft) < Math.abs(dxNormal) && finalTargetX < currentPos.x) {
            finalTargetX += mazeWidth
          } else if (Math.abs(dxWrappedRight) < Math.abs(dxNormal) && finalTargetX > currentPos.x) {
            finalTargetX -= mazeWidth
          }
        }
        
        // Calculate distance and apply exponential smoothing
        const rdx = finalTargetX - currentPos.x
        const rdy = finalTargetY - currentPos.y
        const rDistance = Math.sqrt(rdx * rdx + rdy * rdy)
        
        // Use exponential smoothing for frame-rate independent interpolation
        // Factor of 6 for remote players (slightly slower than local for smoother network jitter handling)
        const remoteSmoothingFactor = 1 - Math.exp(-6 * dt)
        
        if (rDistance > 0.3) {
          // Exponential smoothing for smooth movement
          currentPos.x += rdx * remoteSmoothingFactor
          currentPos.y += rdy * remoteSmoothingFactor
          
          // Normalize after movement
          if (hasWrapAround(currentRow)) {
            while (currentPos.x < 0) currentPos.x += mazeWidth
            while (currentPos.x >= mazeWidth) currentPos.x -= mazeWidth
          }
        } else {
          // Snap when very close
          currentPos.x = targetPos.x
          currentPos.y = targetPos.y
          
          if (hasWrapAround(currentRow)) {
            while (currentPos.x < 0) currentPos.x += mazeWidth
            while (currentPos.x >= mazeWidth) currentPos.x -= mazeWidth
          }
        }
        
        // Update state for rendering - always update for smoothest animation
        setRemotePlayerPixelPos(prev => ({
          ...prev,
          [playerId]: { x: currentPos.x, y: currentPos.y }
        }))
      })
      
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
    
    animationFrameRef.current = requestAnimationFrame(animate)
    
    // Handle window resize - recalculate ALL player positions based on grid positions
    const handleResize = () => {
      const newCellSize = calculateCellSize()
      
      // Update local player pixel position
      const newX = targetGridPosRef.current.col * newCellSize + newCellSize / 2
      const newY = targetGridPosRef.current.row * newCellSize + newCellSize / 2
      playerPixelPosRef.current = { x: newX, y: newY }
      setPlayerPixelPos({ x: newX, y: newY })
      
      // Update ALL remote player pixel positions based on their grid positions
      const remotePositions = remotePlayerPositionsRef.current
      const newRemotePixelPos = {}
      const newRemotePlayers = {}
      
      Object.entries(remotePositions).forEach(([playerId, playerPos]) => {
        if (playerPos && typeof playerPos.row === 'number' && typeof playerPos.col === 'number') {
          const remoteX = playerPos.col * newCellSize + newCellSize / 2
          const remoteY = playerPos.row * newCellSize + newCellSize / 2
          
          // Update the position ref as well
          playerPos.current = { x: remoteX, y: remoteY }
          playerPos.target = { x: remoteX, y: remoteY }
          
          newRemotePixelPos[playerId] = { x: remoteX, y: remoteY }
        }
      })
      
      // Batch update remote player pixel positions
      if (Object.keys(newRemotePixelPos).length > 0) {
        setRemotePlayerPixelPos(prev => ({
          ...prev,
          ...newRemotePixelPos
        }))
        
        // Also update remotePlayers state with new pixel positions
        setRemotePlayers(prev => {
          const updated = { ...prev }
          Object.entries(newRemotePixelPos).forEach(([playerId, pos]) => {
            if (updated[playerId]) {
              updated[playerId] = {
                ...updated[playerId],
                x: pos.x,
                y: pos.y
              }
            }
          })
          return updated
        })
      }
    }
    
    window.addEventListener('resize', handleResize)
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('resize', handleResize)
    }
  }, [playerPos, isGameFrozen])

  // Calculate maze dimensions based on cell size (same formula as CSS)
  const calculateMazeDimensions = () => {
    const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
    return {
      cellSize,
      width: cellSize * MAZE_COLS,
      height: cellSize * MAZE_ROWS
    }
  }

  // Update maze dimensions on resize for Phaser layer
  useEffect(() => {
    const updateDimensions = () => {
      const dims = calculateMazeDimensions()
      setMazeDimensions({ width: dims.width, height: dims.height })
    }
    updateDimensions() // Initial calculation
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // Callback when Phaser map is loaded
  const handleMapLoaded = (mapLoader) => {
    console.log('Phaser maze rendering ready', mapLoader)
    setPhaserMazeReady(true)
  }

  // Trigger coin collection effects (particles + floating number)
  useEffect(() => {
    if (coinCollectNotification && phaserLayerRef.current) {
      const { row, col, value } = coinCollectNotification
      if (row !== undefined && col !== undefined) {
        // Trigger particle burst
        phaserLayerRef.current.triggerCoinParticles(row, col)
        // Show floating "+value" number in gold
        phaserLayerRef.current.showCoinNumber(row, col, value || 5)
      }
    }
  }, [coinCollectNotification])

  // Trigger powerup collection particle effects
  useEffect(() => {
    if (powerupCollectNotification && phaserLayerRef.current) {
      const { row, col, type, powerupId } = powerupCollectNotification
      if (row !== undefined && col !== undefined) {
        // Remove the aura first (if it exists) - with defensive check
        if (powerupId && phaserLayerRef.current) {
          try {
            phaserLayerRef.current.removePowerupAura(powerupId)
          } catch (e) {
            console.warn('Aura already removed or not found:', powerupId)
          }
        }
        // Trigger collection burst effect
        phaserLayerRef.current.triggerPowerupCollect(row, col, type)
        // Show floating text for powerup
        const powerupText = type === 'immunity' ? '🛡️ SHIELD!' : '⚡ POWER!'
        phaserLayerRef.current.showFloatingText(row, col, powerupText, {
          color: '#00FFFF',
          strokeColor: '#006666',
          duration: 1200,
          floatDistance: 60
        })
      }
    }
  }, [powerupCollectNotification])

  // Track powerup spawns/removals and manage auras
  useEffect(() => {
    if (!phaserLayerRef.current) return
    
    const prevPowerups = previousPowerupsRef.current
    const currentPowerups = powerups || []
    
    const prevIds = new Set(prevPowerups.map(p => p.id))
    const currentIds = new Set(currentPowerups.map(p => p.id))
    
    // Add auras for new powerups
    currentPowerups.forEach(powerup => {
      if (!prevIds.has(powerup.id)) {
        phaserLayerRef.current?.addPowerupAura(
          powerup.id,
          powerup.row,
          powerup.col,
          powerup.type || 'immunity'
        )
      }
    })
    
    // Remove auras for powerups that no longer exist
    // Only remove if not already removed by collection notification
    prevPowerups.forEach(powerup => {
      if (!currentIds.has(powerup.id)) {
        try {
          phaserLayerRef.current?.removePowerupAura(powerup.id)
        } catch (e) {
          // Already removed, ignore
        }
      }
    })
    
    previousPowerupsRef.current = [...currentPowerups]
  }, [powerups])

  // Trigger hit effects (particles + floating damage number)
  useEffect(() => {
    if (hitNotification && phaserLayerRef.current) {
      // Show hit particles and damage number at the victim's position
      const victimId = hitNotification.victimId
      const damage = hitNotification.damage
      const myId = socketService.getSocket()?.id
      
      // Get the position - use local player position if it's us, otherwise use remote player position
      if (victimId === myId) {
        // Use local player grid position
        const { row, col } = playerPos
        if (row !== undefined && col !== undefined) {
          phaserLayerRef.current.triggerHitParticles(row, col)
          phaserLayerRef.current.showDamageNumber(row, col, damage || 25)
        }
      } else {
        // Use remote player position
        const remotePos = remotePlayerPositionsRef.current[victimId]
        if (remotePos && remotePos.row !== undefined && remotePos.col !== undefined) {
          phaserLayerRef.current.triggerHitParticles(remotePos.row, remotePos.col)
          phaserLayerRef.current.showDamageNumber(remotePos.row, remotePos.col, damage || 25)
        }
      }
    }
  }, [hitNotification, playerPos, socketService])

  // Manage unicorn speed trail
  useEffect(() => {
    if (!phaserLayerRef.current) return
    
    const myId = socketService.getSocket()?.id
    
    if (unicornId) {
      // Start the trail for whoever is the unicorn
      phaserLayerRef.current.startUnicornTrail(unicornId)
      
      // If local player became the unicorn, trigger a celebratory burst
      if (unicornId === myId) {
        phaserLayerRef.current.triggerUnicornBurst(playerPixelPos.x, playerPixelPos.y)
      }
    } else {
      // No unicorn, stop the trail
      phaserLayerRef.current.stopUnicornTrail()
    }
    
    // Cleanup on unmount
    return () => {
      if (phaserLayerRef.current) {
        phaserLayerRef.current.stopUnicornTrail()
      }
    }
  }, [unicornId, socketService])

  // Update unicorn trail position for local player
  useEffect(() => {
    const myId = socketService.getSocket()?.id
    
    // Only update trail if we are the unicorn and trail is active
    if (unicornId === myId && phaserLayerRef.current) {
      phaserLayerRef.current.updateUnicornTrailPosition(playerPixelPos.x, playerPixelPos.y)
    }
  }, [playerPixelPos, unicornId, socketService])

  // Calculate player position as percentage
  const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
  const mazeWidth = cellSize * MAZE_COLS
  const mazeHeight = cellSize * MAZE_ROWS
  const playerLeftPercent = (playerPixelPos.x / mazeWidth) * 100
  const playerTopPercent = (playerPixelPos.y / mazeHeight) * 100

  // Get current player's coins
  const myPlayer = roomData?.players?.find(p => p.id === socketService.getSocket()?.id)
  const myCoins = myPlayer?.coins || 100

  // Helper function to get rotation transform based on facing direction
  const getDirectionTransform = (direction) => {
    // Default facing direction is 'right' (0 degrees)
    switch (direction) {
      case 'up':
        return 'rotate(-90deg)'
      case 'down':
        return 'rotate(90deg)'
      case 'left':
        return 'rotate(180deg)'
      case 'right':
      default:
        return 'rotate(0deg)'
    }
  }

  // Format hunt time remaining
  const formatHuntTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  return (
    <div className="game-container">
      {/* Blitz Quiz Modal - Shows to ALL players during Blitz Quiz phase */}
      {blitzQuizActive && blitzQuizData && <BlitzQuizModal />}

      {/* Blitz Quiz Results - Shows to ALL players after Blitz Quiz ends */}
      {blitzQuizResults && <BlitzQuizResults results={blitzQuizResults} />}

      {/* Freeze Overlay - Shows when game is frozen but quiz not active yet (legacy) */}
      {isGameFrozen && !quizActive && !quizResults && !blitzQuizActive && !blitzQuizResults && (
        <FreezeOverlay message={freezeMessage} />
      )}

      {/* Quiz Modal - Shows only for caught player (legacy collision quiz) */}
      {quizActive && <QuizModal />}

      {/* Quiz Results - Shows to all players after quiz completes (legacy) */}
      {quizResults && <QuizResults results={quizResults} />}

      {/* Tag Notification - Shows when unicorn tags a survivor */}
      {tagNotification && (
        <div className="tag-notification">
          <span className="tag-icon">🏷️</span>
          <span className="tag-text">
            {tagNotification.unicornName} tagged {tagNotification.survivorName}!
          </span>
          <span className="tag-points">-{tagNotification.points} pts</span>
        </div>
      )}

      {/* Hit Notification - Shows when a player takes damage */}
      {/* {hitNotification && (
        <div className={`hit-notification ${hitNotification.victimId === socketService.getSocket()?.id ? 'hit-self' : ''}`}>
          <span className="hit-icon">💥</span>
          <span className="hit-text">
            {hitNotification.attackerName} hit {hitNotification.victimName}!
          </span>
          <span className="hit-damage">-{hitNotification.damage} HP</span>
        </div>
      )} */}

      {/* Coin collection now uses Phaser floating numbers at collection location */}

      {/* Immunity Indicator - Shows when you have immunity shield */}
      {/*{isImmune && (
        <div className="immunity-indicator">
          <span className="immunity-icon">🛡️</span>
          <span className="immunity-text">IMMUNITY ACTIVE</span>
        </div>
      )}*/}

      {/* Central Phase Timer - Prominent display at top */}
      {gamePhase === GAME_PHASE.HUNT && huntData && (
        <div className={`central-phase-timer ${huntTimeRemaining <= 10000 ? 'timer-ending' : ''}`}>
          <div className="phase-timer-header">
            <span className="phase-timer-icon">🏃</span>
            <span className="phase-timer-label">HUNT PHASE</span>
          </div>
          <div className={`phase-timer-countdown ${huntTimeRemaining <= 10000 ? 'countdown-urgent' : ''}`}>
            {formatHuntTime(huntTimeRemaining)}
          </div>
          <div className="phase-timer-bar">
            <div 
              className={`phase-timer-fill ${huntTimeRemaining <= 10000 ? 'fill-urgent' : ''}`}
              style={{ width: `${(huntTimeRemaining / (huntData.duration || 60000)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Game Info HUD */}
      <div className="h-[150px] w-full overflow-scroll flex flex-wrap">
        <div className="p-2 border-2 border-red-800 w-fit h-fit rounded-2xl">
          Room: {roomData?.code || 'N/A'}
        </div>
        <div className="hud-item">
          Players: {Object.keys(remotePlayers).length + 1}
        </div>
        <div className="hud-item coins-display">
          💰 {myCoins} Coins
        </div>

        {/* Health Bar */}
        <div className="hud-item health-display">
          <div className="health-label">
            ❤️ {myHealth}/{COMBAT_CONFIG.MAX_HEALTH}
          </div>
          <div className="health-bar-container">
            <div 
              className={`health-bar-fill ${myHealth <= 30 ? 'health-critical' : myHealth <= 60 ? 'health-warning' : ''}`}
              style={{ width: `${(myHealth / COMBAT_CONFIG.MAX_HEALTH) * 100}%` }}
            />
          </div>
          {inIFrames && <div className="iframe-indicator">INVINCIBLE</div>}
          {myPlayerState === PLAYER_STATE.FROZEN && <div className="frozen-indicator">FROZEN</div>}
        </div>
        
        {/* Phase Indicator */}
        {gamePhase === GAME_PHASE.HUNT && huntData && (
          <div className={`hud-item phase-indicator hunt-phase ${huntTimeRemaining <= 10000 ? 'phase-ending-soon' : ''}`}>
            <span className="phase-icon">🏃</span>
            <span className="phase-name">HUNT</span>
            <span className={`phase-timer ${huntTimeRemaining <= 10000 ? 'timer-urgent' : ''}`}>
              {formatHuntTime(huntTimeRemaining)}
            </span>
          </div>
        )}
        {gamePhase === GAME_PHASE.BLITZ_QUIZ && (
          <div className="hud-item phase-indicator blitz-phase">
            <span className="phase-icon">⚡</span>
            <span className="phase-name">BLITZ QUIZ</span>
          </div>
        )}
        
        {/* Role Indicator */}
        {unicornId === socketService.getSocket()?.id ? (
          <div className="hud-item unicorn-indicator">
            🦄 Unicorn! Tag the survivors.
          </div>
        ) : reserveUnicornId === socketService.getSocket()?.id ? (
          <div className="hud-item reserve-indicator">
            🥈 Reserved Unicorn! Still u gotta run!
          </div>
        ) : (
          <div className="hud-item survivor-indicator">
            🏃 Survivor! Run from the unicorn and collect gold ﹩!
          </div>
        )}
        
        <div className="hud-item">
          Press ESC to leave
        </div>
        <button 
          className="hud-item leaderboard-toggle"
          onClick={() => setShowLeaderboard(!showLeaderboard)}
        >
          {showLeaderboard ? '📊 Hide' : '📊 Show'} Leaderboard
        </button>
        {/* <button 
          className="hud-item coordinates-toggle"
          onClick={() => setShowCoordinates(!showCoordinates)}
        >
          {showCoordinates ? '📍 Hide' : '📍 Show'} Coords
        </button> */}
        <button 
          className="hud-item sound-toggle"
          onClick={() => setShowSoundControls(!showSoundControls)}
        >
          {muted ? '🔇' : '🔊'} Sound
        </button>
      </div>

      {/* Sound Controls Panel */}
      {showSoundControls && (
        <div className="sound-controls-container">
          <div className="sound-controls-header">
            <h3>🔊 Sound Settings</h3>
            <button className="sound-close-btn" onClick={() => setShowSoundControls(false)}>✕</button>
          </div>
          <div className="sound-controls-content">
            <div className="sound-control-row">
              <button 
                className={`mute-btn ${muted ? 'muted' : ''}`}
                onClick={toggleMute}
              >
                {muted ? '🔇 Unmute' : '🔊 Mute'}
              </button>
            </div>
            <div className="sound-control-row">
              <label className="volume-label">Volume: {Math.round(volume * 100)}%</label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={volume * 100}
                onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
                className="volume-slider"
                disabled={muted}
              />
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {showLeaderboard && (
        <div className="leaderboard-container">
          <div className="leaderboard-header">
            <h3>🏆 Leaderboard</h3>
          </div>
          <div className="leaderboard-list">
            {leaderboard.map((player, index) => (
              <div 
                key={player.id} 
                className={`leaderboard-item ${player.id === socketService.getSocket()?.id ? 'current-player' : ''} ${player.isUnicorn ? 'unicorn-player-item' : ''}`}
              >
                <span className="rank">#{index + 1}</span>
                <span className="player-info">
                  {player.isUnicorn && '🦄 '}
                  {player.name}
                  {player.id === socketService.getSocket()?.id && ' (You)'}
                </span>
                <span className="coins">💰 {player.coins}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coordinates Panel */}
      {showCoordinates && (
        <div className="coordinates-container">
          <div className="coordinates-header">
            <h3>📍 Player Coordinates</h3>
          </div>
          <div className="coordinates-list">
            {/* Local Player */}
            <div className="coordinate-item current-player-coord">
              <div className="coord-player-name">
                {unicornId === socketService.getSocket()?.id && '🦄 '}
                {myPlayer?.name || 'You'} (You)
              </div>
              <div className="coord-details">
                <div className="coord-row">
                  <span className="coord-label">Grid:</span>
                  <span className="coord-value">Row {playerPos.row}, Col {playerPos.col}</span>
                </div>
                <div className="coord-row">
                  <span className="coord-label">Pixel:</span>
                  <span className="coord-value">X {Math.round(playerPixelPos.x)}, Y {Math.round(playerPixelPos.y)}</span>
                </div>
              </div>
            </div>
            
            {/* Remote Players */}
            {Object.entries(remotePlayers).map(([playerId, player]) => {
              const pixelPos = remotePlayerPixelPos[playerId] || { x: player.x, y: player.y }
              const remotePos = remotePlayerPositionsRef.current[playerId]
              const isUnicorn = player.isUnicorn || playerId === unicornId
              
              return (
                <div key={playerId} className={`coordinate-item ${isUnicorn ? 'unicorn-player-coord' : ''}`}>
                  <div className="coord-player-name">
                    {isUnicorn && '🦄 '}
                    {player.name}
                  </div>
                  <div className="coord-details">
                    <div className="coord-row">
                      <span className="coord-label">Grid:</span>
                      <span className="coord-value">
                        Row {remotePos?.row || 'N/A'}, Col {remotePos?.col || 'N/A'}
                      </span>
                    </div>
                    <div className="coord-row">
                      <span className="coord-label">Pixel:</span>
                      <span className="coord-value">X {Math.round(pixelPos.x)}, Y {Math.round(pixelPos.y)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="maze-container" ref={mazeContainerRef}>
        {/* DOM maze rendering - only show when Phaser maze is not ready */}
        {(!usePhaserMaze || !phaserMazeReady) && mazeGrid}

        {/* Phaser Player Layer - Smooth interpolation for remote players + Tilemap maze rendering */}
        {usePhaserRendering && (
          <PhaserPlayerLayer
            ref={phaserLayerRef}
            localPlayerId={socketService.getSocket()?.id}
            remotePlayers={remotePlayers}
            remotePlayerPositions={remotePlayerPositionsRef.current}
            unicornId={unicornId}
            playersHealth={playersHealth}
            immunePlayers={immunePlayers}
            knockbackPlayers={knockbackPlayers}
            width={mazeDimensions.width}
            height={mazeDimensions.height}
            renderMaze={usePhaserMaze}
            onMapLoaded={handleMapLoaded}
          />
        )}

        {/* Coins */}
        {coins.map(coin => {
          const coinLeftPercent = ((coin.col * cellSize + cellSize / 2) / mazeWidth) * 100
          const coinTopPercent = ((coin.row * cellSize + cellSize / 2) / mazeHeight) * 100
          
          return (
            <div
              key={coin.id}
              className="coin"
              style={{
                left: `${coinLeftPercent}%`,
                top: `${coinTopPercent}%`,
              }}
            >
              <img className="w-6 md:w-8" src={coinAnimation}/>
            </div>
          )
        })}

        {/* Powerups */}
        {powerups.map(powerup => {
          const powerupLeftPercent = ((powerup.col * cellSize + cellSize / 2) / mazeWidth) * 100
          const powerupTopPercent = ((powerup.row * cellSize + cellSize / 2) / mazeHeight) * 100
          
          return (
            <div
              key={powerup.id}
              className={`powerup powerup-${powerup.type}`}
              style={{
                left: `${powerupLeftPercent}%`,
                top: `${powerupTopPercent}%`,
              }}
            >
              🛡️
            </div>
          )
        })}
        
        {/* Local Player - Always use DOM rendering (already has smooth interpolation) */}
        <div
          ref={playerRef}
          className={`player local-player ${unicornId === socketService.getSocket()?.id ? 'unicorn-player unicorn-speed' : ''} ${inIFrames ? 'player-iframes' : ''} ${myPlayerState === PLAYER_STATE.FROZEN ? 'player-frozen' : ''} ${isImmune ? 'player-immune' : ''} ${knockbackActive ? 'player-knockback' : ''}`}
          style={{
            left: `${playerLeftPercent}%`,
            top: `${playerTopPercent}%`,
            transform: `translate(-50%, -50%) ${unicornId === socketService.getSocket()?.id ? getDirectionTransform(facingDirection) : ''}`,
          }}
        >
          {/* Immunity Shield Visual */}
          {isImmune && <div className="immunity-shield">🛡️</div>}
          
          {/* Unicorn Speed Lines */}
          {unicornId === socketService.getSocket()?.id && (
            <div className="speed-lines">
              <div className="speed-line"></div>
              <div className="speed-line"></div>
              <div className="speed-line"></div>
            </div>
          )}
          {/* Local Player Health Bar */}
          {gamePhase === GAME_PHASE.HUNT && unicornId !== socketService.getSocket()?.id && (
            <div className="player-health-bar">
              <div 
                className={`player-health-fill ${myHealth <= 30 ? 'health-critical' : myHealth <= 60 ? 'health-warning' : ''}`}
                style={{ width: `${(myHealth / COMBAT_CONFIG.MAX_HEALTH) * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* Frozen Overlay for Local Player */}
        {myPlayerState === PLAYER_STATE.FROZEN && (
          <div 
            className="frozen-player-overlay"
            style={{
              left: `${playerLeftPercent}%`,
              top: `${playerTopPercent}%`,
            }}
          >
            ❄️ FROZEN
          </div>
        )}

        {/* Remote Players - DOM fallback when Phaser not used */}
        {!usePhaserRendering && Object.entries(remotePlayers).map(([playerId, player]) => {
          // Use interpolated pixel position for smooth movement
          const pixelPos = remotePlayerPixelPos[playerId] || { x: player.x, y: player.y }
          const remoteLeftPercent = (pixelPos.x / mazeWidth) * 100
          const remoteTopPercent = (pixelPos.y / mazeHeight) * 100
          const isUnicorn = player.isUnicorn || playerId === unicornId
          const playerDirection = remotePlayerDirections[playerId] || 'right'
          
          // Get combat state for this player
          const playerHealthData = playersHealth[playerId] || { health: COMBAT_CONFIG.MAX_HEALTH, maxHealth: COMBAT_CONFIG.MAX_HEALTH }
          const isInIFrames = playerHealthData.inIFrames
          const isFrozen = playerHealthData.state === PLAYER_STATE.FROZEN
          const healthPercent = (playerHealthData.health / playerHealthData.maxHealth) * 100
          const hasImmunity = immunePlayers.has(playerId)
          const isKnockedBack = knockbackPlayers.has(playerId)
          
          return (
            <div key={playerId}>
              <div
                className={`player remote-player ${isUnicorn ? 'unicorn-player unicorn-speed' : ''} ${isInIFrames ? 'player-iframes' : ''} ${isFrozen ? 'player-frozen' : ''} ${hasImmunity ? 'player-immune' : ''} ${isKnockedBack ? 'player-knockback' : ''}`}
                style={{
                  left: `${remoteLeftPercent}%`,
                  top: `${remoteTopPercent}%`,
                  transform: `translate(-50%, -50%) ${isUnicorn ? getDirectionTransform(playerDirection) : ''}`,
                }}
              >
                {/* Immunity Shield Visual */}
                {hasImmunity && <div className="immunity-shield">🛡️</div>}
                
                {/* Unicorn Speed Lines */}
                {isUnicorn && (
                  <div className="speed-lines">
                    <div className="speed-line"></div>
                    <div className="speed-line"></div>
                    <div className="speed-line"></div>
                  </div>
                )}
                
                {/* Remote Player Health Bar (only for survivors during hunt) */}
                {gamePhase === GAME_PHASE.HUNT && !isUnicorn && (
                  <div className="player-health-bar">
                    <div 
                      className={`player-health-fill ${healthPercent <= 30 ? 'health-critical' : healthPercent <= 60 ? 'health-warning' : ''}`}
                      style={{ width: `${healthPercent}%` }}
                    />
                  </div>
                )}
              </div>
              
              {/* Player Name */}
              <div
                className={`player-name ${isUnicorn ? 'unicorn-name' : ''} ${isFrozen ? 'frozen-name' : ''}`}
                style={{
                  left: `${remoteLeftPercent}%`,
                  top: `${remoteTopPercent}%`,
                  transform: 'translate(-50%, calc(-100% - 10px))',
                }}
              >
                {isFrozen && '❄️ '}
                {isUnicorn && '🦄 '}{player.name}
              </div>
              
              {/* Frozen overlay for remote player */}
              {isFrozen && (
                <div 
                  className="frozen-player-overlay remote-frozen"
                  style={{
                    left: `${remoteLeftPercent}%`,
                    top: `${remoteTopPercent}%`,
                  }}
                >
                  ❄️
                </div>
              )}
            </div>
          )
        })}

        {/* Player Names Overlay - Always visible even with Phaser rendering */}
        {usePhaserRendering && Object.entries(remotePlayers).map(([playerId, player]) => {
          const pixelPos = remotePlayerPixelPos[playerId] || { x: player.x, y: player.y }
          const remoteLeftPercent = (pixelPos.x / mazeWidth) * 100
          const remoteTopPercent = (pixelPos.y / mazeHeight) * 100
          const isUnicorn = player.isUnicorn || playerId === unicornId
          const playerHealthData = playersHealth[playerId] || { health: COMBAT_CONFIG.MAX_HEALTH, maxHealth: COMBAT_CONFIG.MAX_HEALTH }
          const isFrozen = playerHealthData.state === PLAYER_STATE.FROZEN
          
          return (
            <div key={`name-${playerId}`}>
              {/* Player Name */}
              <div
                className={`player-name ${isUnicorn ? 'unicorn-name' : ''} ${isFrozen ? 'frozen-name' : ''}`}
                style={{
                  left: `${remoteLeftPercent}%`,
                  top: `${remoteTopPercent}%`,
                  transform: 'translate(-50%, calc(-100% - 10px))',
                }}
              >
                {isFrozen && '❄️ '}
                {isUnicorn && '🦄 '}{player.name}
              </div>
              
              {/* Frozen overlay for remote player */}
              {isFrozen && (
                <div 
                  className="frozen-player-overlay remote-frozen"
                  style={{
                    left: `${remoteLeftPercent}%`,
                    top: `${remoteTopPercent}%`,
                  }}
                >
                  ❄️
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default StartGame
