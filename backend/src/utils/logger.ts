type Level = 'info' | 'warn' | 'error'

function ts(): string {
  return new Date().toISOString()
}

function log(level: Level, args: unknown[]): void {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(`[${ts()}] [${level.toUpperCase()}]`, ...args)
}

export const logger = {
  info: (...args: unknown[]) => log('info', args),
  warn: (...args: unknown[]) => log('warn', args),
  error: (...args: unknown[]) => log('error', args),
}

export default logger
