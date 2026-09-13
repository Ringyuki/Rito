import type { BrowserReaderState } from './reader/types';

export function clampBrowserReaderSpreadIndex(spreadIndex: number, spreadCount: number): number {
  return Math.max(0, Math.min(spreadIndex, spreadCount - 1));
}

export function notifyBrowserReaderCommitCallback(
  state: BrowserReaderState,
  callback: (() => void) | undefined,
): void {
  if (!callback) return;
  try {
    callback();
  } catch (error) {
    state.logger.warn('reader layout commit callback failed', error);
  }
}

export function notifyBrowserReaderLayoutCommitted(state: BrowserReaderState): void {
  for (const listener of state.layoutCommittedListeners) {
    try {
      listener(state.activeSpreadIndex);
    } catch (error) {
      state.logger.warn('reader layout committed listener failed', error);
    }
  }
}
