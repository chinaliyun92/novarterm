import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface AppLogger {
  info: (scope: string, message: string) => void
  warn: (scope: string, message: string) => void
  error: (scope: string, message: string) => void
  getLogFilePath: () => string
}

function toSingleLine(message: string): string {
  return message.replace(/\r?\n+/g, ' | ').trim()
}

function createWriteLine(logFilePath: string): (level: LogLevel, scope: string, message: string) => void {
  return (level: LogLevel, scope: string, message: string) => {
    const timestamp = new Date().toISOString()
    const normalizedScope = scope.trim() || 'app'
    const normalizedMessage = toSingleLine(message || '')
    const line = `${timestamp} [${level}] [${normalizedScope}] ${normalizedMessage}\n`

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
  const logFilePath = join(logsDir, 'main.log')
  const writeLine = createWriteLine(logFilePath)

  return {
    info: (scope, message) => writeLine('INFO', scope, message),
    warn: (scope, message) => writeLine('WARN', scope, message),
    error: (scope, message) => writeLine('ERROR', scope, message),
    getLogFilePath: () => logFilePath,
  }
}
