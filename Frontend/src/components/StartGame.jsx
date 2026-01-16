import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import '../App.css'
import { maze, MAZE_ROWS, MAZE_COLS, isWall, hasWrapAround, getWrappedCol } from '../maze'
import FreezeOverlay from './FreezeOverlay'
import QuizModal from './QuizModal'
import QuizResults from './QuizResults'

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
    quizResults
  } = useSocket()
  const [showLeaderboard, setShowLeaderboard] = useState(true)
  const [showCoordinates, setShowCoordinates] = useState(true)
  
  // Player starting position (row 1, col 1 is an empty space)
  const [playerPos, setPlayerPos] = useState({ row: null, col: null })
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
  const lastGridPosRef = useRef({ row: 1, col: 1 }) // Track last grid position to detect wraps
  const remotePlayerPositionsRef = useRef({}) // { playerId: { current: {x,y}, target: {x,y}, row, col } }
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
      
      // IMPORTANT: If this is OUR position (e.g., server respawned us), update local position immediately
      if (playerId === socketService.getSocket()?.id) {
        console.log('🔄 Received position update for SELF (respawn):', position);
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
      
      // Calculate pixel position from row/col if available (more reliable than x/y from backend)
      const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
      let targetPixelX = position.x
      let targetPixelY = position.y
      
      // If row/col are provided, calculate pixel position from them (more accurate)
      if (typeof position.row === 'number' && typeof position.col === 'number') {
        targetPixelX = position.col * cellSize + cellSize / 2
        targetPixelY = position.row * cellSize + cellSize / 2
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
        const newCol = position.col || remotePlayerPos.col
        const newRow = position.row || remotePlayerPos.row
        
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
                initialized: true, // Flag to prevent gliding on first position update
                spawnInitialized: true // Flag to indicate spawn position has been set
              }
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
      // Clear all remote player data to prevent stale positions
      // This ensures we start fresh with spawn positions
      setRemotePlayers({})
      setRemotePlayerPixelPos({})
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
    // Send updates every 300ms for balance between smoothness and server load
    if (now - lastPositionUpdateTimeRef.current > 300) {
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
        
        // Handle wrap-around: normalize position after movement
        if (hasWrapAround(currentRow)) {
          // Normalize to 0-mazeWidth range
          while (current.x < 0) {
            current.x += mazeWidth
          }
          while (current.x >= mazeWidth) {
            current.x -= mazeWidth
          }
        }
      } else {
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
          setDirection(pendingDirectionRef.current)
          pendingDirectionRef.current = null
        }
      }
      
      // Update remote players at the same frame rate as local player
      // Snap directly to target positions for perfect sync, but only update at moveSpeed interval
      const now = Date.now()
      const remoteUpdateInterval = moveSpeed // Match local player's grid update interval
      
      Object.keys(remotePlayerPositionsRef.current).forEach(playerId => {
        const playerPos = remotePlayerPositionsRef.current[playerId]
        if (!playerPos) return
        
        // Track last update time for this remote player
        if (!playerPos.lastUpdateTime) {
          playerPos.lastUpdateTime = now
        }
        
        // Only update if enough time has passed (match local player's update rate)
        if (now - playerPos.lastUpdateTime < remoteUpdateInterval) {
          return
        }
        
        playerPos.lastUpdateTime = now
        
        const currentPos = playerPos.current
        const targetPos = playerPos.target
        const currentRow = playerPos.row
        
        // For perfect sync, snap directly to target position (no interpolation)
        // This ensures remote players are exactly where the other player says they are
        if (hasWrapAround(currentRow)) {
          // Normalize target position to 0-mazeWidth range
          let normalizedTargetX = targetPos.x
          while (normalizedTargetX < 0) {
            normalizedTargetX += mazeWidth
          }
          while (normalizedTargetX >= mazeWidth) {
            normalizedTargetX -= mazeWidth
          }
          
          // Snap directly to target for perfect sync
          currentPos.x = normalizedTargetX
          currentPos.y = targetPos.y
        } else {
          // Snap directly to target for perfect sync
          currentPos.x = targetPos.x
          currentPos.y = targetPos.y
        }
        
        // Update state for rendering
        setRemotePlayerPixelPos(prev => {
          const current = prev[playerId]
          if (current && current.x === currentPos.x && current.y === currentPos.y) {
            return prev // No change, skip update
          }
          return {
            ...prev,
            [playerId]: { x: currentPos.x, y: currentPos.y }
          }
        })
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
  }, [playerPos, isGameFrozen])

  // Calculate player position as percentage
  const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
  const mazeWidth = cellSize * MAZE_COLS
  const mazeHeight = cellSize * MAZE_ROWS
  const playerLeftPercent = (playerPixelPos.x / mazeWidth) * 100
  const playerTopPercent = (playerPixelPos.y / mazeHeight) * 100

  // Get current player's coins
  const myPlayer = roomData?.players?.find(p => p.id === socketService.getSocket()?.id)
  const myCoins = myPlayer?.coins || 100

  return (
    <div className="game-container">
      {/* Freeze Overlay - Shows when game is frozen but quiz not active yet */}
      {isGameFrozen && !quizActive && !quizResults && (
        <FreezeOverlay message={freezeMessage} />
      )}

      {/* Quiz Modal - Shows only for caught player */}
      {quizActive && <QuizModal />}

      {/* Quiz Results - Shows to all players after quiz completes */}
      {quizResults && <QuizResults results={quizResults} />}

      {/* Game Info HUD */}
      <div className="game-hud">
        <div className="hud-item">
          Room: {roomData?.code || 'N/A'}
        </div>
        <div className="hud-item">
          Players: {Object.keys(remotePlayers).length + 1}
        </div>
        <div className="hud-item coins-display">
          💰 {myCoins} Coins
        </div>
        {unicornId === socketService.getSocket()?.id && (
          <div className="hud-item unicorn-indicator">
            🦄 You are the Unicorn!
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
        <button 
          className="hud-item coordinates-toggle"
          onClick={() => setShowCoordinates(!showCoordinates)}
        >
          {showCoordinates ? '📍 Hide' : '📍 Show'} Coords
        </button>
      </div>

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
          className={`player local-player ${unicornId === socketService.getSocket()?.id ? 'unicorn-player' : ''}`}
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
          const isUnicorn = player.isUnicorn || playerId === unicornId
          
          return (
            <div key={playerId}>
              <div
                className={`player remote-player ${isUnicorn ? 'unicorn-player' : ''}`}
                style={{
                  left: `${remoteLeftPercent}%`,
                  top: `${remoteTopPercent}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
              <div
                className={`player-name ${isUnicorn ? 'unicorn-name' : ''}`}
                style={{
                  left: `${remoteLeftPercent}%`,
                  top: `${remoteTopPercent}%`,
                  transform: 'translate(-50%, calc(-100% - 10px))',
                }}
              >
                {isUnicorn && '🦄 '}{player.name}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default StartGame
