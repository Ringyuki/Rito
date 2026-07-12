import type { LogLevel, TextMeasurer } from '../../reader';

export interface BrowserHostLogger {
  readonly debug: (message: string, ...args: readonly unknown[]) => void;
  readonly info: (message: string, ...args: readonly unknown[]) => void;
  readonly warn: (message: string, ...args: readonly unknown[]) => void;
  readonly error: (message: string, ...args: readonly unknown[]) => void;
}

const LOG_LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const noop = (): void => {};

export function createBrowserHostLogger(level: LogLevel = 'warn'): BrowserHostLogger {
  const threshold = LOG_LEVEL_PRIORITY[level];
  return {
    debug: threshold <= LOG_LEVEL_PRIORITY.debug ? consoleMethod('debug') : noop,
    info: threshold <= LOG_LEVEL_PRIORITY.info ? consoleMethod('info') : noop,
    warn: threshold <= LOG_LEVEL_PRIORITY.warn ? consoleMethod('warn') : noop,
    error: threshold <= LOG_LEVEL_PRIORITY.error ? consoleMethod('error') : noop,
  };
}

function consoleMethod(
  method: 'debug' | 'info' | 'warn' | 'error',
): (message: string, ...args: readonly unknown[]) => void {
  return (message, ...args): void => {
    // eslint-disable-next-line no-console
    console[method](`[rito] ${message}`, ...args);
  };
}

export const fallbackBrowserTextMeasurer: TextMeasurer = {
  measureText(text) {
    return { width: text.length * 8, height: 16 };
  },
};
