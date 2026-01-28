/**
 * Frontend Logger Utility
 * Only logs in development mode (import.meta.env.DEV)
 * In production, all log calls are no-ops for better performance
 */

const isDev = import.meta.env.DEV

// No-op function for production
const noop = () => {}

// Create logger that only works in development
const logger = {
  log: isDev ? console.log.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  error: console.error.bind(console), // Always log errors
  info: isDev ? console.info.bind(console) : noop,
  debug: isDev ? console.debug.bind(console) : noop,
  
  // Group logging (useful for socket events)
  group: isDev ? console.group.bind(console) : noop,
  groupEnd: isDev ? console.groupEnd.bind(console) : noop,
  
  // Table logging (useful for debugging objects)
  table: isDev ? console.table.bind(console) : noop,
}

export default logger
