import type { BrowserReaderState } from './reader/types';

const MAX_SUSPENDED_FRAME_MISSES = 12;
const missesByOwner = new WeakMap<object, Set<number>>();

export function beginBrowserReaderSuspendedFrameMisses(state: BrowserReaderState): void {
  const owner = state.boundedSessions.current;
  if (owner && !missesByOwner.has(owner)) missesByOwner.set(owner, new Set());
}

export function recordBrowserReaderSuspendedFrameMiss(
  state: BrowserReaderState,
  spreadIndex: number,
): undefined {
  const owner = state.boundedSessions.current;
  if (!owner?.readsSuspended) return;
  const misses = missesByOwner.get(owner) ?? new Set<number>();
  misses.delete(spreadIndex);
  misses.add(spreadIndex);
  while (misses.size > MAX_SUSPENDED_FRAME_MISSES) {
    const oldest = misses.values().next().value;
    if (oldest === undefined) break;
    misses.delete(oldest);
  }
  missesByOwner.set(owner, misses);
  return undefined;
}

export function resumeBrowserReaderSuspendedFrameMisses(
  state: BrowserReaderState,
  owner: object | undefined = state.boundedSessions.current,
): void {
  if (!owner) return;
  const misses = missesByOwner.get(owner);
  missesByOwner.delete(owner);
  if (!misses) return;
  for (const spreadIndex of misses) notifyFrameRetry(state, spreadIndex);
}

function notifyFrameRetry(state: BrowserReaderState, spreadIndex: number): void {
  for (const listener of state.spreadContentInvalidatedListeners) listener(spreadIndex);
}
