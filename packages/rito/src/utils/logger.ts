/**
 * Lightweight logger with configurable log levels.
 * Disabled levels are assigned a shared noop — zero-cost at call sites.
 */

/** Supported log levels, ordered from most to least verbose. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Numeric priority for each log level. Higher = less verbose. */
const LOG_LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/** Logger interface with one method per level. */
export interface Logger {
  readonly debug: (message: string, ...args: readonly unknown[]) => void;
  readonly info: (message: string, ...args: readonly unknown[]) => void;
  readonly warn: (message: string, ...args: readonly unknown[]) => void;
  readonly error: (message: string, ...args: readonly unknown[]) => void;
}

// Shared noop — JIT will inline calls to this.
const noop = (): void => {};

/* eslint-disable no-console */

/**
 * Create a logger that only emits messages at or above the given level.
 * Methods below the threshold are assigned `noop` for zero overhead.
 */
export function createLogger(level: LogLevel = 'warn'): Logger {
  const threshold = LOG_LEVEL_PRIORITY[level];
  return {
    debug:
      threshold <= LOG_LEVEL_PRIORITY.debug
        ? (msg: string, ...args: readonly unknown[]): void => {
            console.debug(`[rito] ${msg}`, ...args);
          }
        : noop,
    info:
      threshold <= LOG_LEVEL_PRIORITY.info
        ? (msg: string, ...args: readonly unknown[]): void => {
            console.info(`[rito] ${msg}`, ...args);
          }
        : noop,
    warn:
      threshold <= LOG_LEVEL_PRIORITY.warn
        ? (msg: string, ...args: readonly unknown[]): void => {
            console.warn(`[rito] ${msg}`, ...args);
          }
        : noop,
    error:
      threshold <= LOG_LEVEL_PRIORITY.error
        ? (msg: string, ...args: readonly unknown[]): void => {
            console.error(`[rito] ${msg}`, ...args);
          }
        : noop,
  };
}

/* eslint-enable no-console */
