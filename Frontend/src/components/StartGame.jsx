import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSocket, GAME_PHASE, PLAYER_STATE, COMBAT_CONFIG } from '../context/SocketContext'
import { useSound } from '../context/SoundContext'
import { POSITION_CONFIG } from '../config/gameConfig'
import { getCharacterImageUrls } from '../config/characters'
import log from '../utils/logger'
import '../App.css'
import { maze, MAZE_ROWS, MAZE_COLS, isWall, hasWrapAround, getWrappedCol, getWallBorders } from '../maze'
import coinAnimation from '../assets/coinAnimation.gif'

// ============ CODE-SPLIT: Lazy load heavy components ============
// These are conditionally rendered and don't need to be in the initial bundle
const FreezeOverlay = lazy(() => import('./FreezeOverlay'))
const QuizModal = lazy(() => import('./QuizModal'))
const QuizResults = lazy(() => import('./QuizResults'))
const BlitzQuizModal = lazy(() => import('./BlitzQuizModal'))
const BlitzQuizResults = lazy(() => import('./BlitzQuizResults'))
const UnfreezeQuizModal = lazy(() => import('./UnfreezeQuizModal'))
const PhaserPlayerLayer = lazy(() => import('./PhaserPlayerLayer'))

// ============ CENTRALIZED MAZE LAYOUT ============
// Calculate maze dimensions once and reuse everywhere
const calculateMazeLayout = () => {
  const cellSize = Math.min(window.innerWidth / MAZE_COLS, window.innerHeight / MAZE_ROWS)
  return {
    cellSize,
    mazeWidth: cellSize * MAZE_COLS,
    mazeHeight: cellSize * MAZE_ROWS
  }
}

// Helper to convert grid position to pixel position
const gridToPixel = (row, col, cellSize) => ({
  x: col * cellSize + cellSize / 2,
  y: row * cellSize + cellSize / 2
})

// Helper to convert pixel position to percentage
const pixelToPercent = (x, y, mazeWidth, mazeHeight) => ({
  left: (x / mazeWidth) * 100,
  top: (y / mazeHeight) * 100
})

// Helper to get grid cell from pixel position (for turn logic - "cell player is actually in")
const pixelToGrid = (pixelX, pixelY, cellSize, mazeWidth) => {
  const row = Math.max(0, Math.min(MAZE_ROWS - 1, Math.floor(pixelY / cellSize)))
  let normalizedX = pixelX
  if (hasWrapAround(row)) {
    normalizedX = ((pixelX % mazeWidth) + mazeWidth) % mazeWidth
  }
  const col = Math.max(0, Math.min(MAZE_COLS - 1, Math.floor(normalizedX / cellSize)))
  return getWrappedCol(row, col) !== undefined ? { row, col: getWrappedCol(row, col) } : { row, col }
}

// Helper to get CSS rotation transform based on facing direction
const getDirectionTransform = (direction) => {
  switch (direction) {
    case 'up': return 'rotate(-90deg)'
    case 'down': return 'rotate(90deg)'
    case 'left': return 'rotate(180deg)'
    case 'right':
    default: return 'rotate(0deg)'
  }
}

// Helper to format hunt time remaining
const formatHuntTime = (ms) => `${Math.floor(ms / 1000)}s`

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
    // Unfreeze Quiz state
    unfreezeQuizActive,
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
    knockbackPlayers,
    // Round info
    roundInfo
  } = useSocket()
  
  // Sound controls
  const { volume, muted, setVolume, toggleMute } = useSound()
  
  // ============ OPTIMIZED: Memoize socket ID to avoid repeated lookups ============
  // This is called 18+ times in the component; memoizing prevents repeated getSocket() calls
  const myId = useMemo(() => socketService.getSocket()?.id, [socketService])
  
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showSoundControls, setShowSoundControls] = useState(false)
  
  const [playerPos, setPlayerPos] = useState({ row: null, col: null })
  const [direction, setDirection] = useState(null) // null, 'up', 'down', 'left', 'right'
  const [facingDirection, setFacingDirection] = useState('right') // Track which way the player is facing: 'up', 'down', 'left', 'right'
  const [remotePlayers, setRemotePlayers] = useState({}) // { playerId: { x, y, name } }
  const [remotePlayerDirections, setRemotePlayerDirections] = useState({}) // { playerId: 'up' | 'down' | 'left' | 'right' }
  
  // ============ OPTIMIZED: Maze layout stored in ref for synchronous access ============
  // This replaces ~50 inline cellSize calculations with a single cached value
  const mazeLayoutRef = useRef(calculateMazeLayout())
  const [mazeDimensions, setMazeDimensions] = useState({ 
    width: mazeLayoutRef.current.mazeWidth, 
    height: mazeLayoutRef.current.mazeHeight 
  })
  
  // ============ OPTIMIZED: Position state updates throttled ============
  // Refs for per-frame updates (read by Phaser), state only updated at lower rate for UI
  const playerPixelPosRef = useRef({ x: 0, y: 0 })
  const remotePlayerPixelPosRef = useRef({}) // { playerId: { x, y } } - replaces state for per-frame updates
  const lastUIUpdateTimeRef = useRef(0) // Throttle UI state updates to ~15fps
  const UI_UPDATE_INTERVAL = 66 // ~15fps for UI updates (instead of 60fps)
  
  // State for UI elements that need React re-renders (updated at lower rate)
  const [playerPixelPos, setPlayerPixelPos] = useState({ x: 0, y: 0 })
  
  const directionRef = useRef(null)
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
  const [usePhaserMaze, setUsePhaserMaze] = useState(true) // Whether to render maze via Phaser tilemap
  const [phaserMazeReady, setPhaserMazeReady] = useState(false) // Whether Phaser maze has loaded
  
  // ============ CENTRALIZED: Update maze layout on resize ============
  const updateMazeLayout = useCallback(() => {
    const newLayout = calculateMazeLayout()
    mazeLayoutRef.current = newLayout
    setMazeDimensions({ width: newLayout.mazeWidth, height: newLayout.mazeHeight })
    return newLayout
  }, [])

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
      log.log('No room or game state, redirecting to home')
    }
  }, [roomData, gameState])

  // ============ ROOM CLEANUP: Leave room on unmount ============
  // This ensures the client always emits leave_room when leaving the game screen,
  // regardless of how the user left (Escape, browser back, refresh, link, etc.)
  useEffect(() => {
    return () => {
      log.log('StartGame unmounting - leaving room')
      socketService.leaveRoom()
    }
  }, [socketService])

  // Setup socket listeners for multiplayer
  useEffect(() => {
    // Listen for position updates from other players
    const handlePositionUpdate = (data) => {
      const { playerId, position } = data
      const { cellSize, mazeWidth } = mazeLayoutRef.current
      
      // IMPORTANT: If this is OUR position (e.g., server respawned us), update local position immediately
      if (playerId === socketService.getSocket()?.id) {
        log.log('Received position update for SELF (respawn):', position);
        if (typeof position.row === 'number' && typeof position.col === 'number') {
          const pixelPos = gridToPixel(position.row, position.col, cellSize)
          
          // Update local player position immediately
          setPlayerPos({ row: position.row, col: position.col });
          targetGridPosRef.current = { row: position.row, col: position.col };
          playerPixelPosRef.current = { x: pixelPos.x, y: pixelPos.y };
          setPlayerPixelPos({ x: pixelPos.x, y: pixelPos.y });
          lastGridPosRef.current = { row: position.row, col: position.col };
          
          log.log(`✅ Local position updated to: row=${position.row}, col=${position.col}`);
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
      
      setRemotePlayers(prev => ({
        ...prev,
        [playerId]: {
          x: position.x,
          y: position.y,
          name: playerName,
          isUnicorn: isUnicorn,
          timestamp: Date.now()
        }
      }))
      
      // Calculate target pixel position from grid position
      let targetPixelX, targetPixelY
      
      if (typeof position.row === 'number' && typeof position.col === 'number') {
        const gridCenter = gridToPixel(position.row, position.col, cellSize)
        targetPixelX = gridCenter.x
        targetPixelY = gridCenter.y
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
        remotePlayerPixelPosRef.current[playerId] = { x: targetPixelX, y: targetPixelY }
      } else {
        const remotePlayerPos = remotePlayerPositionsRef.current[playerId]
        
        // If this is the first update after initialization, snap to position immediately
        if (!remotePlayerPos.initialized || !remotePlayerPos.spawnInitialized) {
          const spawnRow = position.row || remotePlayerPos.row || 1
          const spawnCol = position.col || remotePlayerPos.col || 1
          const spawnPixel = gridToPixel(spawnRow, spawnCol, cellSize)
          
          remotePlayerPos.current = { x: spawnPixel.x, y: spawnPixel.y }
          remotePlayerPos.target = { x: spawnPixel.x, y: spawnPixel.y }
          remotePlayerPos.row = spawnRow
          remotePlayerPos.col = spawnCol
          remotePlayerPos.lastCol = spawnCol
          remotePlayerPos.lastRow = spawnRow
          remotePlayerPos.initialized = true
          remotePlayerPos.spawnInitialized = true
          
          remotePlayerPixelPosRef.current[playerId] = { x: spawnPixel.x, y: spawnPixel.y }
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
            setRemotePlayerDirections(prev => ({
              ...prev,
              [playerId]: colDiff > 0 ? 'right' : 'left'
            }))
          } else {
            setRemotePlayerDirections(prev => ({
              ...prev,
              [playerId]: colDiff > 0 ? 'left' : 'right'
            }))
          }
        } else if (newRow !== lastRow) {
          const rowDiff = newRow - lastRow
          setRemotePlayerDirections(prev => ({
            ...prev,
            [playerId]: rowDiff > 0 ? 'down' : 'up'
          }))
        }
        
        // Detect wrap-around for remote players
        let adjustedTargetX = (typeof position.row === 'number' && typeof position.col === 'number') 
          ? targetPixelX 
          : position.x
        let wrapDetected = false
        
        if (hasWrapAround(newRow) && hasWrapAround(remotePlayerPos.row)) {
          const colDiff = newCol - lastCol
          
          // Detect wrap from right to left (31 -> 0)
          if (colDiff < -MAZE_COLS / 2 || (lastCol === MAZE_COLS - 1 && newCol === 0)) {
            wrapDetected = true
            if (remotePlayerPos.current.x < mazeWidth / 2) {
              remotePlayerPos.current.x = targetPixelX + mazeWidth
              adjustedTargetX = targetPixelX + mazeWidth
            } else {
              adjustedTargetX = targetPixelX + mazeWidth
            }
          }
          // Detect wrap from left to right (0 -> 31)
          else if (colDiff > MAZE_COLS / 2 || (lastCol === 0 && newCol === MAZE_COLS - 1)) {
            wrapDetected = true
            if (remotePlayerPos.current.x > mazeWidth / 2) {
              remotePlayerPos.current.x = targetPixelX - mazeWidth
              adjustedTargetX = targetPixelX - mazeWidth
            } else {
              adjustedTargetX = targetPixelX - mazeWidth
            }
          }
        }
        
        // If no wrap detected, normalize positions to ensure they're in valid range
        if (!wrapDetected && hasWrapAround(newRow)) {
          while (adjustedTargetX < 0) adjustedTargetX += mazeWidth
          while (adjustedTargetX >= mazeWidth) adjustedTargetX -= mazeWidth
        }
        
        // Update target position
        remotePlayerPos.target = { x: adjustedTargetX, y: targetPixelY }
        remotePlayerPos.row = newRow
        remotePlayerPos.col = newCol
        remotePlayerPos.lastCol = newCol
        remotePlayerPos.lastRow = newRow
        
        // Add position to buffer for velocity-based prediction
        const newBufferEntry = { x: adjustedTargetX, y: targetPixelY, timestamp: Date.now() }
        remotePlayerPos.buffer = [...(remotePlayerPos.buffer || []), newBufferEntry].slice(-3)
        
        // If wrap was detected, immediately update the ref position
        if (wrapDetected) {
          remotePlayerPixelPosRef.current[playerId] = { x: remotePlayerPos.current.x, y: remotePlayerPos.current.y }
        }
      }
    }

    // Listen for game state sync (initial positions)
    const handleGameStateSync = (data) => {
      if (data.gameState && data.gameState.players) {
        const { cellSize } = mazeLayoutRef.current
        const currentPlayerId = socketService.getSocket()?.id
        const newRemotePlayers = {}
        const newRemotePixelPos = {}
        const newRemotePositions = {}
        const newRemoteDirections = {}
        
        data.gameState.players.forEach(player => {
          if (player.position) {
            const spawnRow = player.position.row || 1
            const spawnCol = player.position.col || 1
            const spawnPixel = gridToPixel(spawnRow, spawnCol, cellSize)
            
            if (player.id === currentPlayerId) {
              // Set local player's initial position from gameState spawn position
              setPlayerPos({ row: spawnRow, col: spawnCol })
              targetGridPosRef.current = { row: spawnRow, col: spawnCol }
              playerPixelPosRef.current = { x: spawnPixel.x, y: spawnPixel.y }
              setPlayerPixelPos({ x: spawnPixel.x, y: spawnPixel.y })
              lastGridPosRef.current = { row: spawnRow, col: spawnCol }
            } else {
              // Set remote players' initial positions immediately
              newRemotePlayers[player.id] = {
                x: spawnPixel.x,
                y: spawnPixel.y,
                name: player.name
              }
              newRemotePixelPos[player.id] = {
                x: spawnPixel.x,
                y: spawnPixel.y
              }
              newRemotePositions[player.id] = {
                current: { x: spawnPixel.x, y: spawnPixel.y },
                target: { x: spawnPixel.x, y: spawnPixel.y },
                row: spawnRow,
                col: spawnCol,
                lastCol: spawnCol,
                lastRow: spawnRow,
                initialized: true,
                spawnInitialized: true
              }
              newRemoteDirections[player.id] = 'right'
            }
          }
        })
        setRemotePlayers(newRemotePlayers)
        remotePlayerPixelPosRef.current = newRemotePixelPos
        setRemotePlayerDirections(newRemoteDirections)
        remotePlayerPositionsRef.current = newRemotePositions
      }
    }

    // Listen for game started event
    const handleGameStarted = () => {
      log.log('Game started!')
      // Clear all remote player data to prevent stale positions
      // This ensures we start fresh with spawn positions
      setRemotePlayers({})
      setRemotePlayerDirections({})
      remotePlayerPositionsRef.current = {}
      remotePlayerPixelPosRef.current = {}
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
      setRemotePlayerDirections(prev => {
        const updated = { ...prev }
        delete updated[playerId]
        return updated
      })
      delete remotePlayerPositionsRef.current[playerId]
      delete remotePlayerPixelPosRef.current[playerId]
    }

    socketService.onPlayerLeft(handlePlayerLeft)

    // Handle player respawn position updates (batched event includes position)
    const handlePlayerRespawn = (data) => {
      const { playerId, position } = data
      if (!position) return // No position in event
      
      const { cellSize, mazeWidth } = mazeLayoutRef.current
      
      // If this is OUR respawn, update local position
      if (playerId === socketService.getSocket()?.id) {
        log.log('Received respawn position for SELF:', position);
        if (typeof position.row === 'number' && typeof position.col === 'number') {
          const pixelPos = gridToPixel(position.row, position.col, cellSize)
          
          setPlayerPos({ row: position.row, col: position.col });
          targetGridPosRef.current = { row: position.row, col: position.col };
          playerPixelPosRef.current = { x: pixelPos.x, y: pixelPos.y };
          setPlayerPixelPos({ x: pixelPos.x, y: pixelPos.y });
          lastGridPosRef.current = { row: position.row, col: position.col };
          
          log.log(`✅ Respawn position updated: row=${position.row}, col=${position.col}`);
        }
        return;
      }
      
      // For remote players, update their position
      if (typeof position.row === 'number' && typeof position.col === 'number') {
        const pixelPos = gridToPixel(position.row, position.col, cellSize)
        
        // Update remote player position
        setRemotePlayers(prev => ({
          ...prev,
          [playerId]: { row: position.row, col: position.col }
        }))
        remotePlayerPixelPosRef.current[playerId] = { x: pixelPos.x, y: pixelPos.y }
        
        // Update position ref
        if (remotePlayerPositionsRef.current[playerId]) {
          remotePlayerPositionsRef.current[playerId].targetRow = position.row
          remotePlayerPositionsRef.current[playerId].targetCol = position.col
          remotePlayerPositionsRef.current[playerId].targetPixelX = pixelPos.x
          remotePlayerPositionsRef.current[playerId].targetPixelY = pixelPos.y
        }
      }
    }
    
    socketService.onPlayerRespawn(handlePlayerRespawn)

    // Cleanup
    return () => {
      socketService.off('player_position_update', handlePositionUpdate)
      socketService.off('game_state_sync', handleGameStateSync)
      socketService.off('game_started', handleGameStarted)
      socketService.off('player_left', handlePlayerLeft)
      socketService.off('player_respawn', handlePlayerRespawn)
    }
  }, [socketService, roomData])

  // Send position updates to server (more frequently for smoother remote player movement)
  const sendPositionUpdate = useCallback((pixelX, pixelY) => {
    // Don't send position updates if game is frozen
    if (isGameFrozen) return;
    
    const now = Date.now()
    // Send updates at configured interval (see config/gameConfig.js)
    // Should match server's POSITION_UPDATE_INTERVAL in Backend/config/constants.js
    if (now - lastPositionUpdateTimeRef.current > POSITION_CONFIG.UPDATE_INTERVAL) {
      const currentGridPos = targetGridPosRef.current
      const lastGridPos = lastGridPosRef.current
      const { mazeWidth } = mazeLayoutRef.current
      
      // Detect wrap-around: if column changed by more than 1, it's a wrap
      let adjustedX = pixelX
      
      if (hasWrapAround(currentGridPos.row)) {
        const colDiff = currentGridPos.col - lastGridPos.col
        
        // Detect wrap from right to left (31 -> 0)
        if (colDiff < -MAZE_COLS / 2 || (lastGridPos.col === MAZE_COLS - 1 && currentGridPos.col === 0)) {
          adjustedX = pixelX + mazeWidth
        }
        // Detect wrap from left to right (0 -> 31)
        else if (colDiff > MAZE_COLS / 2 || (lastGridPos.col === 0 && currentGridPos.col === MAZE_COLS - 1)) {
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
  }, [isGameFrozen, socketService])

  // Keep directionRef in sync with direction state
  useEffect(() => {
    directionRef.current = direction
  }, [direction])

  // Handle keyboard input
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Block all movement if game is frozen
      if (isGameFrozen) return
      
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
        socketService.leaveRoom()
        navigate('/')
        return
      }

      if (newDirection) {
        const { cellSize, mazeWidth } = mazeLayoutRef.current
        const current = playerPixelPosRef.current
        const currentMovementDir = directionRef.current
        
        // Use larger threshold (70% of cell size) for more forgiving turn registration
        const threshold = cellSize * 0.7
        
        // Get the cell the player is currently in
        const currentCell = pixelToGrid(current.x, current.y, cellSize, mazeWidth)
        
        // Also compute the NEXT cell in the current movement direction
        // This is the cell the player is approaching
        let nextCell = { row: currentCell.row, col: currentCell.col }
        if (currentMovementDir === 'up') nextCell.row = currentCell.row - 1
        else if (currentMovementDir === 'down') nextCell.row = currentCell.row + 1
        else if (currentMovementDir === 'left') nextCell.col = getWrappedCol(currentCell.row, currentCell.col - 1) ?? currentCell.col - 1
        else if (currentMovementDir === 'right') nextCell.col = getWrappedCol(currentCell.row, currentCell.col + 1) ?? currentCell.col + 1
        
        // Clamp nextCell to valid bounds
        nextCell.row = Math.max(0, Math.min(MAZE_ROWS - 1, nextCell.row))
        nextCell.col = Math.max(0, Math.min(MAZE_COLS - 1, nextCell.col))
        
        // Helper to check if turn is valid from a cell and player is close enough
        const canTurnFromCell = (cell) => {
          let checkRow = cell.row
          let checkCol = cell.col
          switch (newDirection) {
            case 'up': checkRow = cell.row - 1; break
            case 'down': checkRow = cell.row + 1; break
            case 'left': checkCol = cell.col - 1; break
            case 'right': checkCol = cell.col + 1; break
          }
          const wrappedCol = getWrappedCol(checkRow, checkCol)
          return !isWall(checkRow, wrappedCol)
        }
        
        const distanceToCell = (cell) => {
          const center = gridToPixel(cell.row, cell.col, cellSize)
          return Math.sqrt(Math.pow(current.x - center.x, 2) + Math.pow(current.y - center.y, 2))
        }
        
        // Check both current cell and next cell - use whichever is valid and closest
        const currentCellDist = distanceToCell(currentCell)
        const nextCellDist = distanceToCell(nextCell)
        const canTurnCurrent = canTurnFromCell(currentCell)
        const canTurnNext = canTurnFromCell(nextCell) && !isWall(nextCell.row, nextCell.col)
        
        let turnApplied = false
        let turnCell = null
        
        // Prefer the cell the player is closer to, if turn is valid from there
        if (canTurnCurrent && currentCellDist < threshold) {
          turnCell = currentCell
          turnApplied = true
        } else if (canTurnNext && nextCellDist < threshold) {
          turnCell = nextCell
          turnApplied = true
        }
        
        if (turnApplied && turnCell) {
          setDirection(newDirection)
          setFacingDirection(newDirection)
          pendingDirectionRef.current = null
          
          // Snap player to the turn cell to ensure clean turning
          const snapCenter = gridToPixel(turnCell.row, turnCell.col, cellSize)
          playerPixelPosRef.current = { x: snapCenter.x, y: snapCenter.y }
          targetGridPosRef.current = { row: turnCell.row, col: turnCell.col }
          setPlayerPos({ row: turnCell.row, col: turnCell.col })
        } else {
          // Store as pending - will be applied when reaching a valid intersection
          pendingDirectionRef.current = newDirection
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
        log.log('❄️ Movement loop: Game is frozen, skipping movement');
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

  // ============ OPTIMIZED: Smooth animation loop using requestAnimationFrame ============
  // Key optimization: Update refs every frame, but only update React state at ~15fps
  useEffect(() => {
    const animate = (timestamp) => {
      // Calculate delta time for frame-rate independent interpolation
      const lastTimestamp = lastAnimationTimestampRef.current || timestamp
      const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.1) // Clamp to prevent large jumps
      lastAnimationTimestampRef.current = timestamp
      
      const { cellSize, mazeWidth } = mazeLayoutRef.current
      
      // Calculate target pixel position
      const target = gridToPixel(targetGridPosRef.current.row, targetGridPosRef.current.col, cellSize)
      const targetX = target.x
      const targetY = target.y
      
      // Smooth interpolation with time-based movement
      const current = playerPixelPosRef.current
      const currentRow = targetGridPosRef.current.row
      
      // Handle wrap-around for smooth animation
      let adjustedTargetX = targetX
      if (hasWrapAround(currentRow)) {
        const dxNormal = targetX - current.x
        const dxWrappedLeft = (targetX + mazeWidth) - current.x
        const dxWrappedRight = (targetX - mazeWidth) - current.x
        
        if (Math.abs(dxWrappedLeft) < Math.abs(dxNormal) && targetX < current.x) {
          adjustedTargetX = targetX + mazeWidth
        } else if (Math.abs(dxWrappedRight) < Math.abs(dxNormal) && targetX > current.x) {
          adjustedTargetX = targetX - mazeWidth
        }
      }
      
      const dx = adjustedTargetX - current.x
      const dy = targetY - current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      // Exponential smoothing for frame-rate independent interpolation
      const smoothingFactor = 1 - Math.exp(-8 * dt)
      
      if (distance > 0.3) {
        current.x += dx * smoothingFactor
        current.y += dy * smoothingFactor
        
        // Normalize position after movement
        if (hasWrapAround(currentRow)) {
          while (current.x < 0) current.x += mazeWidth
          while (current.x >= mazeWidth) current.x -= mazeWidth
        }
      } else {
        current.x = targetX
        current.y = targetY
        
        if (hasWrapAround(currentRow)) {
          while (current.x < 0) current.x += mazeWidth
          while (current.x >= mazeWidth) current.x -= mazeWidth
        }
      }
      
      // Send position update for local player (only if game not frozen)
      if (!isGameFrozen) {
        sendPositionUpdate(current.x, current.y)
      }
      
      // Check if we have a pending direction change
      // Use same logic as key handler: check current cell AND next cell in movement direction
      if (pendingDirectionRef.current) {
        const threshold = cellSize * 0.7
        const pendingDir = pendingDirectionRef.current
        const currentMovementDir = directionRef.current
        
        // Get the cell the player is currently in
        const currentCell = pixelToGrid(current.x, current.y, cellSize, mazeWidth)
        
        // Also compute the NEXT cell in the current movement direction
        let nextCellInMovement = { row: currentCell.row, col: currentCell.col }
        if (currentMovementDir === 'up') nextCellInMovement.row = currentCell.row - 1
        else if (currentMovementDir === 'down') nextCellInMovement.row = currentCell.row + 1
        else if (currentMovementDir === 'left') nextCellInMovement.col = getWrappedCol(currentCell.row, currentCell.col - 1) ?? currentCell.col - 1
        else if (currentMovementDir === 'right') nextCellInMovement.col = getWrappedCol(currentCell.row, currentCell.col + 1) ?? currentCell.col + 1
        
        // Clamp to valid bounds
        nextCellInMovement.row = Math.max(0, Math.min(MAZE_ROWS - 1, nextCellInMovement.row))
        nextCellInMovement.col = Math.max(0, Math.min(MAZE_COLS - 1, nextCellInMovement.col))
        
        // Helper to check if pending turn is valid from a cell
        const canTurnFromCell = (cell) => {
          let checkRow = cell.row
          let checkCol = cell.col
          switch (pendingDir) {
            case 'up': checkRow = cell.row - 1; break
            case 'down': checkRow = cell.row + 1; break
            case 'left': checkCol = cell.col - 1; break
            case 'right': checkCol = cell.col + 1; break
          }
          const wrappedCol = getWrappedCol(checkRow, checkCol)
          return !isWall(checkRow, wrappedCol)
        }
        
        const distanceToCell = (cell) => {
          const center = gridToPixel(cell.row, cell.col, cellSize)
          return Math.sqrt(Math.pow(current.x - center.x, 2) + Math.pow(current.y - center.y, 2))
        }
        
        // Check both current cell and next cell in movement direction
        const currentCellDist = distanceToCell(currentCell)
        const nextCellDist = distanceToCell(nextCellInMovement)
        const canTurnCurrent = canTurnFromCell(currentCell)
        const canTurnNext = canTurnFromCell(nextCellInMovement) && !isWall(nextCellInMovement.row, nextCellInMovement.col)
        
        let turnCell = null
        
        // Prefer the cell the player is closer to, if turn is valid from there
        if (canTurnCurrent && currentCellDist < threshold) {
          turnCell = currentCell
        } else if (canTurnNext && nextCellDist < threshold) {
          turnCell = nextCellInMovement
        }
        
        if (turnCell) {
          setDirection(pendingDir)
          setFacingDirection(pendingDir)
          pendingDirectionRef.current = null
          
          // Snap player to the turn cell to ensure clean turning
          const snapCenter = gridToPixel(turnCell.row, turnCell.col, cellSize)
          current.x = snapCenter.x
          current.y = snapCenter.y
          targetGridPosRef.current = { row: turnCell.row, col: turnCell.col }
          setPlayerPos({ row: turnCell.row, col: turnCell.col })
        }
        // If turn not valid from either cell, keep pending - will be checked next frame
      }
      
      // Update remote players - interpolate positions in refs every frame
      const remoteSmoothingFactor = 1 - Math.exp(-6 * dt)
      
      Object.keys(remotePlayerPositionsRef.current).forEach(playerId => {
        const playerPos = remotePlayerPositionsRef.current[playerId]
        if (!playerPos) return
        
        const currentPos = playerPos.current
        const targetPos = playerPos.target
        const remoteRow = playerPos.row
        
        // Velocity-based prediction
        let predictedTargetX = targetPos.x
        let predictedTargetY = targetPos.y
        
        if (playerPos.buffer && playerPos.buffer.length >= 2) {
          const latest = playerPos.buffer[playerPos.buffer.length - 1]
          const previous = playerPos.buffer[playerPos.buffer.length - 2]
          const timeDelta = (latest.timestamp - previous.timestamp) / 1000
          
          if (timeDelta > 0 && timeDelta < 0.5) {
            const vx = (latest.x - previous.x) / timeDelta
            const vy = (latest.y - previous.y) / timeDelta
            playerPos.velocity = { x: vx, y: vy }
            
            const timeSinceUpdate = (Date.now() - latest.timestamp) / 1000
            if (timeSinceUpdate < 0.2) {
              predictedTargetX = targetPos.x + vx * timeSinceUpdate * 0.5
              predictedTargetY = targetPos.y + vy * timeSinceUpdate * 0.5
            }
          }
        }
        
        let finalTargetX = predictedTargetX
        let finalTargetY = predictedTargetY
        
        // Handle wrap-around
        if (hasWrapAround(remoteRow)) {
          while (finalTargetX < 0) finalTargetX += mazeWidth
          while (finalTargetX >= mazeWidth) finalTargetX -= mazeWidth
          
          const dxNormal = finalTargetX - currentPos.x
          const dxWrappedLeft = (finalTargetX + mazeWidth) - currentPos.x
          const dxWrappedRight = (finalTargetX - mazeWidth) - currentPos.x
          
          if (Math.abs(dxWrappedLeft) < Math.abs(dxNormal) && finalTargetX < currentPos.x) {
            finalTargetX += mazeWidth
          } else if (Math.abs(dxWrappedRight) < Math.abs(dxNormal) && finalTargetX > currentPos.x) {
            finalTargetX -= mazeWidth
          }
        }
        
        const rdx = finalTargetX - currentPos.x
        const rdy = finalTargetY - currentPos.y
        const rDistance = Math.sqrt(rdx * rdx + rdy * rdy)
        
        if (rDistance > 0.3) {
          currentPos.x += rdx * remoteSmoothingFactor
          currentPos.y += rdy * remoteSmoothingFactor
          
          if (hasWrapAround(remoteRow)) {
            while (currentPos.x < 0) currentPos.x += mazeWidth
            while (currentPos.x >= mazeWidth) currentPos.x -= mazeWidth
          }
        } else {
          currentPos.x = targetPos.x
          currentPos.y = targetPos.y
          
          if (hasWrapAround(remoteRow)) {
            while (currentPos.x < 0) currentPos.x += mazeWidth
            while (currentPos.x >= mazeWidth) currentPos.x -= mazeWidth
          }
        }
        
        // ============ OPTIMIZED: Update ref every frame (for Phaser), NOT React state ============
        remotePlayerPixelPosRef.current[playerId] = { x: currentPos.x, y: currentPos.y }
      })
      
      // ============ OPTIMIZED: Throttle React state updates to ~15fps ============
      // This reduces re-renders from ~60/sec to ~15/sec per player
      const now = Date.now()
      if (now - lastUIUpdateTimeRef.current > UI_UPDATE_INTERVAL) {
        lastUIUpdateTimeRef.current = now
        
        // Update local player pixel position state (for UI elements that need it)
        setPlayerPixelPos({ x: current.x, y: current.y })
      }
      
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    
    // Initialize pixel position
    const { cellSize } = mazeLayoutRef.current
    const initialPixel = gridToPixel(playerPos.row || 1, playerPos.col || 1, cellSize)
    playerPixelPosRef.current = { x: initialPixel.x, y: initialPixel.y }
    targetGridPosRef.current = { row: playerPos.row || 1, col: playerPos.col || 1 }
    setPlayerPixelPos({ x: initialPixel.x, y: initialPixel.y })
    
    animationFrameRef.current = requestAnimationFrame(animate)
    
    // Handle window resize - recalculate ALL player positions based on grid positions
    const handleResize = () => {
      const newLayout = updateMazeLayout()
      const { cellSize } = newLayout
      
      // Update local player pixel position
      const newPixel = gridToPixel(targetGridPosRef.current.row, targetGridPosRef.current.col, cellSize)
      playerPixelPosRef.current = { x: newPixel.x, y: newPixel.y }
      setPlayerPixelPos({ x: newPixel.x, y: newPixel.y })
      
      // Update ALL remote player pixel positions based on their grid positions
      const remotePositions = remotePlayerPositionsRef.current
      
      Object.entries(remotePositions).forEach(([playerId, pos]) => {
        if (pos && typeof pos.row === 'number' && typeof pos.col === 'number') {
          const remotePixel = gridToPixel(pos.row, pos.col, cellSize)
          pos.current = { x: remotePixel.x, y: remotePixel.y }
          pos.target = { x: remotePixel.x, y: remotePixel.y }
          remotePlayerPixelPosRef.current[playerId] = { x: remotePixel.x, y: remotePixel.y }
        }
      })
      
    }
    
    window.addEventListener('resize', handleResize)
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('resize', handleResize)
    }
  }, [playerPos, isGameFrozen, sendPositionUpdate, updateMazeLayout])

  // Callback when Phaser map is loaded
  const handleMapLoaded = (mapLoader) => {
    log.log('Phaser maze rendering ready', mapLoader)
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
            log.warn('Aura already removed or not found:', powerupId)
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

  // ============ CENTRALIZED: Use memoized layout values for rendering ============
  // These values are derived from mazeDimensions state which updates on resize
  const renderLayout = useMemo(() => {
    const { cellSize, mazeWidth, mazeHeight } = mazeLayoutRef.current
    return { cellSize, mazeWidth, mazeHeight }
  }, [mazeDimensions]) // Re-compute when dimensions change
  
  // Calculate player position as percentage
  const playerPercent = useMemo(() => 
    pixelToPercent(playerPixelPos.x, playerPixelPos.y, renderLayout.mazeWidth, renderLayout.mazeHeight),
    [playerPixelPos.x, playerPixelPos.y, renderLayout.mazeWidth, renderLayout.mazeHeight]
  )
  const playerLeftPercent = playerPercent.left
  const playerTopPercent = playerPercent.top

  // Get current player's coins from the central leaderboard (server-driven)
  // Only use leaderboard as source of truth for coins - no fallback to local state
  const myLeaderboardEntry = useMemo(() => leaderboard?.find(p => p.id === myId), [leaderboard, myId]);
  const myPlayer = useMemo(() => roomData?.players?.find(p => p.id === myId), [roomData?.players, myId]);
  const myCoins = myLeaderboardEntry?.coins ?? 100;

  // ============ CHARACTER SYSTEM ============
  // Build playerCharacters map: playerId -> characterId
  const playerCharacters = useMemo(() => {
    const characters = {};
    roomData?.players?.forEach(p => {
      if (p.characterId) {
        characters[p.id] = p.characterId;
      }
    });
    return characters;
  }, [roomData?.players]);

  // Get local player's character ID
  const localPlayerCharacterId = useMemo(() => {
    return myPlayer?.characterId || playerCharacters[myId] || null;
  }, [myPlayer?.characterId, playerCharacters, myId]);

  // Get character image URLs for Phaser texture loading
  const characterImageUrls = useMemo(() => getCharacterImageUrls(), []);

  // Handle leave room (used by game-end screen)
  const handleLeaveRoom = useCallback(() => {
    socketService.leaveRoom()
    navigate('/')
  }, [socketService, navigate])

  return (
    <div className="game-container">
      {/* ============ GAME END SCREEN ============ */}
      {/* Full-screen overlay when game ends (all rounds completed) */}
      {gamePhase === GAME_PHASE.GAME_END && (
        <div className="game-end-overlay">
          <div className="game-end-container">
            <div className="game-end-header">
              <h1 className="game-end-title">🏆 Game Over!</h1>
              <p className="game-end-subtitle">Final Results</p>
            </div>
            
            <div className="game-end-leaderboard">
              <h2 className="game-end-leaderboard-title">Leaderboard</h2>
              <div className="game-end-leaderboard-list">
                {leaderboard.map((player, index) => (
                  <div 
                    key={player.id} 
                    className={`game-end-player-row ${player.id === myId ? 'game-end-player-you' : ''} ${index === 0 ? 'game-end-player-winner' : ''}`}
                  >
                    <span className="game-end-rank">
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                    </span>
                    <span className="game-end-name">
                      {player.name}
                      {player.id === myId && <span className="game-end-you-badge">(You)</span>}
                    </span>
                    <span className="game-end-coins">💰 {player.coins}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="game-end-actions">
              <button 
                className="game-end-leave-btn"
                onClick={handleLeaveRoom}
              >
                Back to Lobby
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ SUSPENSE BOUNDARY FOR MODALS ============ */}
      {/* Lazy-loaded modals share a single Suspense boundary with null fallback */}
      <Suspense fallback={null}>
        {/* Blitz Quiz Modal - Shows to ALL players during Blitz Quiz phase */}
        {blitzQuizActive && blitzQuizData && <BlitzQuizModal />}

        {/* Blitz Quiz Results - Shows to ALL players after Blitz Quiz ends */}
        {blitzQuizResults && <BlitzQuizResults results={blitzQuizResults} />}

        {/* Unfreeze Quiz Modal - Shows to player when their health reaches 0 */}
        {/* Only show if not in blitz quiz (blitz cancels unfreeze quizzes) */}
        {unfreezeQuizActive && !blitzQuizActive && <UnfreezeQuizModal />}

        {/* Freeze Overlay - Shows when game is frozen but quiz not active yet */}
        {isGameFrozen && !quizActive && !quizResults && !blitzQuizActive && !blitzQuizResults && (
          <FreezeOverlay message={freezeMessage} />
        )}

        {/* Quiz Modal - Shows only for caught player */}
        {quizActive && <QuizModal />}

        {/* Quiz Results - Shows to all players after quiz completes */}
        {quizResults && <QuizResults results={quizResults} />}
      </Suspense>

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


      {/* Game Info HUD - Minimalistic Arcade Style */}
      <div className="game-hud-bar">
        {/* Left Section - Room Info */}
        <div className="hud-section hud-left">
          <span className="hud-room">#{roomData?.code || '---'}</span>
          <span className="hud-players">{Object.keys(remotePlayers).length + 1}P</span>
        </div>

        {/* Center Section - Core Stats */}
        <div className="hud-section hud-center">
          {/* Coins */}
          <span className="hud-stat hud-coins">💰 {myCoins}</span>
          
          {/* Health */}
          <div className="hud-health">
            <span className="hud-health-text">❤️ {myHealth}</span>
            <div className="hud-health-bar">
              <div 
                className={`hud-health-fill ${myHealth <= 30 ? 'health-critical' : myHealth <= 60 ? 'health-warning' : ''}`}
                style={{ width: `${(myHealth / COMBAT_CONFIG.MAX_HEALTH) * 100}%` }}
              />
            </div>
            {inIFrames && <span className="hud-status-badge hud-invincible">INV</span>}
            {myPlayerState === PLAYER_STATE.FROZEN && <span className="hud-status-badge hud-frozen">❄️</span>}
          </div>

          {/* Phase */}
          {gamePhase === GAME_PHASE.HUNT && huntData && (
            <span className={`hud-stat hud-phase ${huntTimeRemaining <= 10000 ? 'hud-phase-urgent' : ''}`}>
              🏃 {formatHuntTime(huntTimeRemaining)}
            </span>
          )}
          {gamePhase === GAME_PHASE.BLITZ_QUIZ && (
            <span className="hud-stat hud-phase hud-phase-blitz">⚡ BLITZ</span>
          )}

          {/* Round Indicator - Show during active phases */}
          {roundInfo && (gamePhase === GAME_PHASE.HUNT || gamePhase === GAME_PHASE.BLITZ_QUIZ) && (
            <span className={`hud-stat hud-round ${roundInfo.roundsRemaining === 1 ? 'hud-round-final' : ''}`}>
              🎯 R{roundInfo.currentRound}/{roundInfo.totalRounds}
              {roundInfo.roundsRemaining === 1 && <span className="hud-round-final-badge">FINAL</span>}
            </span>
          )}

          {/* Role - Short */}
          <span className={`hud-role ${
            unicornId === myId ? 'hud-role-unicorn' : 
            reserveUnicornId === myId ? 'hud-role-reserve' : 
            'hud-role-survivor'
          }`}>
            {unicornId === myId ? '🦄 TAG' : 
             reserveUnicornId === myId ? '🥈 RUN' : 
             '🏃 COLLECT'}
          </span>
        </div>

        {/* Right Section - Actions */}
        <div className="hud-section hud-right">
          <span className="hud-hint">ESC</span>
          <button 
            className={`hud-btn ${showLeaderboard ? 'hud-btn-active' : ''}`}
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            title="Leaderboard"
          >
            <span className='text-white'>Leaderboard</span>
          </button>
          <button 
            className="hud-btn"
            onClick={() => setShowSoundControls(!showSoundControls)}
            title="Sound"
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
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

      {/* Leaderboard - Compact */}
      {showLeaderboard && (
        <div className="leaderboard-panel">
          <div className="leaderboard-panel-header">
            <span>🏆 RANKS</span>
            <button className="leaderboard-close" onClick={() => setShowLeaderboard(false)}>✕</button>
          </div>
          <div className="leaderboard-panel-list">
            {leaderboard.map((player, index) => (
              <div 
                key={player.id} 
                className={`leaderboard-row ${player.id === myId ? 'leaderboard-row-you' : ''} ${player.isUnicorn ? 'leaderboard-row-unicorn' : ''}`}
              >
                <span className="leaderboard-rank">
                  {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                </span>
                <span className="leaderboard-name">
                  {player.isUnicorn && '🦄'}
                  {player.name}
                  {player.id === myId && ' •'}
                </span>
                <span className="leaderboard-coins">{player.coins}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="maze-container" ref={mazeContainerRef}>
        {/* DOM maze rendering - only show when Phaser maze is not ready */}
        {(!usePhaserMaze || !phaserMazeReady) && mazeGrid}

        {/* Phaser Player Layer - Smooth interpolation for ALL players + Tilemap maze rendering */}
        <Suspense fallback={<div className="phaser-loading" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: '14px' }}>Loading game...</div>}>
          <PhaserPlayerLayer
              ref={phaserLayerRef}
              localPlayerId={myId}
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
              // Local player rendering props - for smooth 60fps updates
              // Pass refs so Phaser can read them every frame for smooth interpolation
              localPlayerTargetGridPosRef={targetGridPosRef}
              localPlayerFacingDirection={facingDirection}
              localPlayerHealth={myHealth}
              localPlayerIsImmune={isImmune}
              localPlayerInIFrames={inIFrames}
              localPlayerState={myPlayerState}
              localPlayerKnockback={knockbackActive}
              renderLocalPlayer={true}
              // Character system props
              playerCharacters={playerCharacters}
              localPlayerCharacterId={localPlayerCharacterId}
              characterImageUrls={characterImageUrls}
              // Local player name for Phaser name rendering
              localPlayerName={myPlayer?.name}
          />
        </Suspense>

        {/* Coins */}
        {coins.map(coin => {
          const coinPixel = gridToPixel(coin.row, coin.col, renderLayout.cellSize)
          const coinPercent = pixelToPercent(coinPixel.x, coinPixel.y, renderLayout.mazeWidth, renderLayout.mazeHeight)
          
          return (
            <div
              key={coin.id}
              className="coin"
              style={{
                left: `${coinPercent.left}%`,
                top: `${coinPercent.top}%`,
              }}
            >
              <img className="w-6 md:w-8" src={coinAnimation}/>
            </div>
          )
        })}

        {/* Powerups */}
        {powerups.map(powerup => {
          const powerupPixel = gridToPixel(powerup.row, powerup.col, renderLayout.cellSize)
          const powerupPercent = pixelToPercent(powerupPixel.x, powerupPixel.y, renderLayout.mazeWidth, renderLayout.mazeHeight)
          
          return (
            <div
              key={powerup.id}
              className={`powerup powerup-${powerup.type}`}
              style={{
                left: `${powerupPercent.left}%`,
                top: `${powerupPercent.top}%`,
              }}
            >
              🛡️
            </div>
          )
        })}
        
      </div>

      {/* Role Instruction Bar - Subtle hint at bottom for new players */}
      {(gamePhase === GAME_PHASE.HUNT || gamePhase === GAME_PHASE.BLITZ_QUIZ) && (
        <div className={`role-instruction-bar ${
          unicornId === myId ? 'role-unicorn' : 
          reserveUnicornId === myId ? 'role-reserve' : 
          'role-survivor'
        }`}>
          {unicornId === myId ? (
            <span>🦄 Tag runners to steal their coins</span>
          ) : reserveUnicornId === myId ? (
            <span>🥈 You're next unicorn — run and survive for now</span>
          ) : (
            <span>🏃 Collect coins and avoid the unicorn</span>
          )}
        </div>
      )}
    </div>
  )
}

export default StartGame
