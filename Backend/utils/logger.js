/**
 * Backend Logger Utility
 *
 * - Development: human-readable console output with category prefixes
 * - Production: JSON structured logging to stdout (captured by Docker)
 *   + daily log files at /var/log/waymaze/server-YYYY-MM-DD.log
 */

import fs from 'fs';
import path from 'path';

const isDev = process.env.NODE_ENV !== 'production'
const LOG_DIR = '/var/log/waymaze'

// No-op function for suppressed logs
const noop = () => {}

// Game-specific logging categories (shared by base logger and child loggers)
const LOG_CATEGORIES = ['game', 'socket', 'combat', 'quiz', 'hunt', 'coin', 'powerup']

/**
 * Get or create a write stream for today's log file.
 * Returns null if the log directory doesn't exist (e.g. running outside Docker).
 */
let currentDate = ''
let currentStream = null

function getLogStream() {
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    if (today === currentDate && currentStream) return currentStream

    // Close previous stream
    if (currentStream) {
        currentStream.end()
    }

    try {
        if (!fs.existsSync(LOG_DIR)) {
            // Not in Docker / log dir not mounted — skip file logging
            currentDate = today
            currentStream = null
            return null
        }
        currentStream = fs.createWriteStream(
            path.join(LOG_DIR, `server-${today}.log`),
            { flags: 'a' }
        )
        currentDate = today
        return currentStream
    } catch {
        currentStream = null
        currentDate = today
        return null
    }
}

/**
 * Write a JSON log line to stdout and optionally to the log file.
 * @param {string} level - Log level
 * @param {string|null} category - Log category
 * @param {Array} args - Log arguments
 * @param {Object} [context] - Optional context fields (e.g. { roomCode, userId })
 */
function writeJsonLog(level, category, args, context) {
    const entry = {
        time: new Date().toISOString(),
        level,
        category: category || undefined,
        ...context,
        msg: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    }
    const line = JSON.stringify(entry)

    // Always write to stdout (Docker captures this)
    process.stdout.write(line + '\n')

    // Also write to daily log file if available
    const stream = getLogStream()
    if (stream) {
        stream.write(line + '\n')
    }
}

/**
 * Create a category logger for production (JSON output).
 * @param {string|null} category - Log category
 * @param {string} level - Log level
 * @param {Object} [context] - Optional default context fields
 */
function jsonCategoryLogger(category, level = 'info', context = undefined) {
    return (...args) => writeJsonLog(level, category, args, context)
}

// Create logger with environment-aware behavior
const logger = isDev
    ? {
        // Debug logs - only in development
        log: console.log.bind(console),
        debug: console.debug.bind(console),
        info: console.info.bind(console),

        // Warnings and errors - always log
        warn: console.warn.bind(console),
        error: console.error.bind(console),

        // Game-specific logging categories
        game: (...args) => console.log('[Game]', ...args),
        socket: (...args) => console.log('[Socket]', ...args),
        combat: (...args) => console.log('[Combat]', ...args),
        quiz: (...args) => console.log('[Quiz]', ...args),
        hunt: (...args) => console.log('[Hunt]', ...args),
        coin: (...args) => console.log('[Coin]', ...args),
        powerup: (...args) => console.log('[Powerup]', ...args),
    }
    : {
        // Production: JSON structured logging
        log: noop,
        debug: noop,
        info: jsonCategoryLogger(null, 'info'),

        // Warnings and errors always logged
        warn: jsonCategoryLogger(null, 'warn'),
        error: jsonCategoryLogger(null, 'error'),

        // Game-specific categories — logged as structured JSON in production
        game: jsonCategoryLogger('game'),
        socket: jsonCategoryLogger('socket'),
        combat: jsonCategoryLogger('combat'),
        quiz: jsonCategoryLogger('quiz'),
        hunt: jsonCategoryLogger('hunt'),
        coin: jsonCategoryLogger('coin'),
        powerup: jsonCategoryLogger('powerup'),
    }

/**
 * Create a child logger with default context fields baked in.
 * In production, context fields (e.g. roomCode, userId) are added to every JSON log entry.
 * In development, context fields are prepended as a [key=value] prefix for readability.
 *
 * Usage:
 *   const rlog = logger.withContext({ roomCode: 'MAZABCD', userId: '123' })
 *   rlog.info('Game started')  // includes roomCode + userId in output
 *
 * @param {Object} ctx - Context fields to include in every log entry
 * @returns {Object} A new logger with the same API but with context baked in
 */
logger.withContext = function withContext(ctx) {
    // Dev: readable prefix like [roomCode=MAZABCD userId=123]
    const prefix = '[' + Object.entries(ctx)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ') + ']'

    const child = isDev
        ? {
            log: (...args) => console.log(prefix, ...args),
            debug: (...args) => console.debug(prefix, ...args),
            info: (...args) => console.info(prefix, ...args),
            warn: (...args) => console.warn(prefix, ...args),
            error: (...args) => console.error(prefix, ...args),
        }
        : {
            log: noop,
            debug: noop,
            info: jsonCategoryLogger(null, 'info', ctx),
            warn: jsonCategoryLogger(null, 'warn', ctx),
            error: jsonCategoryLogger(null, 'error', ctx),
        }

    for (const cat of LOG_CATEGORIES) {
        child[cat] = isDev
            ? (...args) => console.log(`[${cat.charAt(0).toUpperCase() + cat.slice(1)}]`, prefix, ...args)
            : jsonCategoryLogger(cat, 'info', ctx)
    }

    child.withContext = (extra) => withContext({ ...ctx, ...extra })
    return child
}

export default logger
