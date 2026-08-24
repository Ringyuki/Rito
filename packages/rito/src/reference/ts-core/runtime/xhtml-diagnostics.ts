import type { Logger } from '../utils/logger';

export function logXhtmlWarnings(
  warnings: readonly string[],
  logger: Logger,
  chapterId: string,
): void {
  for (const warning of warnings) {
    logger.warn('XHTML parse warning in %s: %s', chapterId, warning);
  }
}
