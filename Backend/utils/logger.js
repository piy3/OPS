/**
 * Backend Logger (pino)
 *
 * JSON to stdout in all environments (Docker / dev both capture it).
 * Use pino-pretty externally if you want human-readable dev output:
 *   node server.js | npx pino-pretty
 *
 * Usage:
 *   log.info({ roomCode, userId }, 'Room created')
 *   log.warn({ quizId }, 'No questions found')
 *
 *   const rlog = log.child({ roomCode, userId })
 *   rlog.info('Game started')   // roomCode + userId in every entry
 */

import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

const log = pino({
    level: isDev ? 'debug' : 'info',
})

export default log
