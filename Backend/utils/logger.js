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
 */
function writeJsonLog(level, category, args) {
    const entry = {
        time: new Date().toISOString(),
        level,
        category: category || undefined,
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
 */
function jsonCategoryLogger(category, level = 'info') {
    return (...args) => writeJsonLog(level, category, args)
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

export default logger
