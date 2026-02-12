/**
 * Backend Logger
 *
 * Every log method supports an optional leading context object:
 *   log.info('simple message')
 *   log.info({ roomCode, userId }, 'message with structured fields')
 *
 * Use log.withContext({ roomCode, userId }) to bake fields into every call:
 *   const rlog = log.withContext({ roomCode: 'MAZABCD', userId: '123' })
 *   rlog.info('Room created')  // roomCode + userId in every entry
 *
 * Dev:  human-readable console output
 * Prod: JSON to stdout + daily file at /var/log/waymaze/server-YYYY-MM-DD.log
 */

import fs from 'fs'
import path from 'path'

const isDev = process.env.NODE_ENV !== 'production'
const LOG_DIR = '/var/log/waymaze'
const CATEGORIES = ['game', 'socket', 'combat', 'quiz', 'hunt', 'coin', 'powerup']
const noop = () => {}

// ── Daily log file (production) ──────────────────────────────────────

let _logDate = ''
let _logStream = null

function getLogStream() {
    const today = new Date().toISOString().slice(0, 10)
    if (today === _logDate && _logStream) return _logStream
    if (_logStream) _logStream.end()
    try {
        if (!fs.existsSync(LOG_DIR)) { _logDate = today; _logStream = null; return null }
        _logStream = fs.createWriteStream(path.join(LOG_DIR, `server-${today}.log`), { flags: 'a' })
        _logDate = today
        return _logStream
    } catch {
        _logStream = null; _logDate = today; return null
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** True for plain objects (not strings, arrays, Errors, null) */
function isCtx(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Error)
}

/** If first arg is a plain object, split it out as context fields. */
function splitArgs(args) {
    return args.length > 0 && isCtx(args[0])
        ? [args[0], args.slice(1)]
        : [null, args]
}

/** Format { roomCode: 'X', userId: '1' } → '[roomCode=X userId=1]' */
function fmtCtx(ctx) {
    if (!ctx) return ''
    const s = Object.entries(ctx).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(' ')
    return s ? `[${s}]` : ''
}

/** Write JSON log line to stdout and daily log file. */
function writeJson(level, category, msgArgs, ctx) {
    const entry = {
        time: new Date().toISOString(),
        level,
        category: category || undefined,
        ...ctx,
        msg: msgArgs.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
    }
    const line = JSON.stringify(entry)
    process.stdout.write(line + '\n')
    const s = getLogStream()
    if (s) s.write(line + '\n')
}

// ── Log function factory ─────────────────────────────────────────────

function makeLogFn(level, category, baseCtx) {
    if (isDev) {
        const consoleMethod = { warn: 'warn', error: 'error', debug: 'debug' }[level] || 'log'
        const catTag = category ? `[${category.charAt(0).toUpperCase() + category.slice(1)}]` : ''
        const baseTag = fmtCtx(baseCtx)
        return (...args) => {
            const [inline, rest] = splitArgs(args)
            console[consoleMethod](...[catTag, baseTag, fmtCtx(inline)].filter(Boolean), ...rest)
        }
    }
    // Production: suppress log/debug
    if (level === 'log' || level === 'debug') return noop
    return (...args) => {
        const [inline, rest] = splitArgs(args)
        writeJson(level, category, rest, { ...baseCtx, ...inline })
    }
}

// ── Build a logger instance ──────────────────────────────────────────

function buildLogger(baseCtx) {
    const l = {}
    for (const m of ['log', 'debug', 'info', 'warn', 'error']) {
        l[m] = makeLogFn(m, null, baseCtx)
    }
    for (const cat of CATEGORIES) {
        l[cat] = makeLogFn('info', cat, baseCtx)
    }
    l.withContext = (ctx) => buildLogger({ ...baseCtx, ...ctx })
    return l
}

export default buildLogger()
