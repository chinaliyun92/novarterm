import { appendFileSync, mkdirSync } from 'node:fs'
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

type LogLevel = 'INFO' | 'WARN' | 'ERROR'
const MAIN_LOG_FILE_PREFIX = 'main-'
const MAIN_LOG_FILE_SUFFIX = '.log'
const MAIN_LOG_FILE_PATTERN = /^main-(\d{4}-\d{2}-\d{2})\.log$/
const LEGACY_MAIN_LOG_FILE_NAME = 'main.log'
const MAIN_LOG_RETENTION_DAYS = 7

export interface AppLogger {
  info: (scope: string, message: string) => void
  warn: (scope: string, message: string) => void
  error: (scope: string, message: string) => void
  getLogFilePath: () => string
}

function toSingleLine(message: string): string {
  return message.replace(/\r?\n+/g, ' | ').trim()
}

function formatLocalDateForLogFile(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function resolveMainLogFilePath(logsDir: string, date: Date): string {
  return join(logsDir, `${MAIN_LOG_FILE_PREFIX}${formatLocalDateForLogFile(date)}${MAIN_LOG_FILE_SUFFIX}`)
}

function resolveEarliestKeptDateString(retentionDays: number): string {
  const now = new Date()
  // Keep recent natural days including today: retention=7 => today + previous 6 days.
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() - (retentionDays - 1))
  return formatLocalDateForLogFile(now)
}

async function cleanupExpiredMainLogs(logsDir: string, retentionDays: number): Promise<void> {
  const earliestKept = resolveEarliestKeptDateString(retentionDays)
  const entries = await readdir(logsDir, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) {
      return
    }
    if (entry.name === LEGACY_MAIN_LOG_FILE_NAME) {
      // One-time migration cleanup: remove legacy single-file logs.
      await unlink(join(logsDir, entry.name))
      return
    }
    const matched = MAIN_LOG_FILE_PATTERN.exec(entry.name)
    if (!matched) {
      return
    }
    const datePart = matched[1]
    if (datePart >= earliestKept) {
      return
    }
    await unlink(join(logsDir, entry.name))
  }))
}

function createWriteLine(logsDir: string): (level: LogLevel, scope: string, message: string) => void {
  return (level: LogLevel, scope: string, message: string) => {
    const timestamp = new Date().toISOString()
    const normalizedScope = scope.trim() || 'app'
    const normalizedMessage = toSingleLine(message || '')
    const line = `${timestamp} [${level}] [${normalizedScope}] ${normalizedMessage}\n`
    const logFilePath = resolveMainLogFilePath(logsDir, new Date())

    try {
      appendFileSync(logFilePath, line, 'utf8')
    } catch (error) {
      // Keep logging failures visible without throwing from the caller.
      console.error('Failed to append main log line:', error)
    }
  }
}

export function createMainLogger(logsDir: string): AppLogger {
  mkdirSync(logsDir, { recursive: true })
  const writeLine = createWriteLine(logsDir)
  void cleanupExpiredMainLogs(logsDir, MAIN_LOG_RETENTION_DAYS).catch((error: unknown) => {
    console.error('Failed to cleanup expired main logs:', error)
  })

  return {
    info: (scope, message) => writeLine('INFO', scope, message),
    warn: (scope, message) => writeLine('WARN', scope, message),
    error: (scope, message) => writeLine('ERROR', scope, message),
    getLogFilePath: () => resolveMainLogFilePath(logsDir, new Date()),
  }
}
