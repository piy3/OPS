import { useState, useEffect, useRef } from 'react'
import '../App.css'
import { maze, MAZE_ROWS, MAZE_COLS, isWall } from '../maze'

function StartGame() {
  // Player starting position (row 1, col 1 is an empty space)
  const [playerPos, setPlayerPos] = useState({ row: 1, col: 1 })
  const [playerPixelPos, setPlayerPixelPos] = useState({ x: 0, y: 0 })
  const [direction, setDirection] = useState(null) // null, 'up', 'down', 'left', 'right'
  const directionRef = useRef(null)
  const playerPixelPosRef = useRef({ x: 0, y: 0 })
  const targetGridPosRef = useRef({ row: 1, col: 1 })
  const animationFrameRef = useRef(null)
  const moveSpeed = 150 // milliseconds per cell
  const playerRef = useRef(null)
  const mazeContainerRef = useRef(null)
  const pendingDirectionRef = useRef(null) // Store pending direction change
  const lastFrameTimeRef = useRef(null) // Track time for smooth animation

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
  }, [])

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
      // Calculate velocity needed to reach target smoothly
      if (distance > 0.1) {
        // Calculate the speed (pixels per millisecond) needed to reach target
        // We want to move at a rate that completes the cell movement in moveSpeed ms
        const pixelsPerMs = cellSize / moveSpeed
        
        // Calculate how much to move this frame based on time delta
        const moveAmount = pixelsPerMs * deltaTime
        
        // Move towards target, but don't overshoot
        if (moveAmount >= distance) {
          // Close enough, snap to target
          current.x = targetX
          current.y = targetY
        } else {
          // Move proportionally towards target
          const ratio = moveAmount / distance
          current.x += dx * ratio
          current.y += dy * ratio
        }
      } else {
        // Snap to target when very close
        current.x = targetX
        current.y = targetY
      }
      
      // Check if we have a pending direction change and player is now aligned
      if (pendingDirectionRef.current) {
        const threshold = cellSize * 0.3
        const dx = Math.abs(current.x - targetX)
        const dy = Math.abs(current.y - targetY)
        const isAligned = dx < threshold && dy < threshold
        
        if (isAligned) {
          // Apply the pending direction change
          setDirection(pendingDirectionRef.current)
          pendingDirectionRef.current = null
        }
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
    lastFrameTimeRef.current = null // Reset frame time
    
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
        <div
          ref={playerRef}
          className="player"
          style={{
            left: `${playerLeftPercent}%`,
            top: `${playerTopPercent}%`,
            transform: 'translate(-50%, -50%)', // Center the player on the position
          }}
        />
      </div>
    </div>
  )
}

export default StartGame
