/**
 * Frontend Logger Utility
 * Respects VITE_ENV to control logging verbosity
 * In production, only errors and warnings are logged
 */

const isDev = import.meta.env.VITE_ENV !== 'prod';

// No-op function for production
const noop = (..._args: unknown[]) => {};

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
  socket: isDev ? (...args: unknown[]) => console.log('🔌 [Socket]', ...args) : noop,
  game: isDev ? (...args: unknown[]) => console.log('🎮 [Game]', ...args) : noop,
  quiz: isDev ? (...args: unknown[]) => console.log('❓ [Quiz]', ...args) : noop,
  player: isDev ? (...args: unknown[]) => console.log('👤 [Player]', ...args) : noop,
  network: isDev ? (...args: unknown[]) => console.log('📡 [Network]', ...args) : noop,
};

export default logger;
