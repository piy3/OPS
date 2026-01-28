/**
 * Backend Logger Utility
 * Respects NODE_ENV to control logging verbosity
 * In production, only errors and warnings are logged
 */

const isDev = process.env.NODE_ENV !== 'production'

// No-op function for production
const noop = () => {}

// Create logger with environment-aware behavior
const logger = {
  // Debug logs - only in development
  log: isDev ? console.log.bind(console) : noop,
  debug: isDev ? console.debug.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  
  // Warnings and errors - always log
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  
  // Game-specific logging categories (can be selectively disabled)
  game: isDev ? (...args) => console.log('[Game]', ...args) : noop,
  socket: isDev ? (...args) => console.log('[Socket]', ...args) : noop,
  combat: isDev ? (...args) => console.log('[Combat]', ...args) : noop,
  quiz: isDev ? (...args) => console.log('[Quiz]', ...args) : noop,
  hunt: isDev ? (...args) => console.log('[Hunt]', ...args) : noop,
  coin: isDev ? (...args) => console.log('[Coin]', ...args) : noop,
  powerup: isDev ? (...args) => console.log('[Powerup]', ...args) : noop,
}

// Support both CommonJS and ES modules
export default logger
