import type { Logger } from '../../utils/logger';
import type { ReaderSession } from './session';
import type { ReaderSessionId } from './types';

type ReaderSessionRegistryEntry =
  | { readonly kind: 'pending' }
  | { readonly kind: 'open'; readonly session: ReaderSession };

export type ReserveReaderSessionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'disposed' | 'exists' };

export type CommitReaderSessionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'disposed' | 'collision' };

export type CloseReaderSessionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-found' }
  | { readonly ok: false; readonly reason: 'dispose-failed'; readonly error: unknown };

export interface ReaderSessionRegistry {
  isDisposed(): boolean;
  reserve(sessionId: ReaderSessionId): ReserveReaderSessionResult;
  releasePending(sessionId: ReaderSessionId): void;
  commit(sessionId: ReaderSessionId, session: ReaderSession): CommitReaderSessionResult;
  get(sessionId: ReaderSessionId): ReaderSession | undefined;
  close(sessionId: ReaderSessionId): CloseReaderSessionResult;
  dispose(): void;
}

export function createReaderSessionRegistry(logger?: Logger): ReaderSessionRegistry {
  const state: ReaderSessionRegistryState = {
    entries: new Map<ReaderSessionId, ReaderSessionRegistryEntry>(),
    disposed: false,
    ...(logger !== undefined ? { logger } : {}),
  };

  return {
    isDisposed() {
      return state.disposed;
    },
    reserve(sessionId) {
      return reserveReaderSession(state, sessionId);
    },
    releasePending(sessionId) {
      releasePendingReaderSession(state, sessionId);
    },
    commit(sessionId, session) {
      return commitReaderSession(state, sessionId, session);
    },
    get(sessionId) {
      return getReaderSession(state, sessionId);
    },
    close(sessionId) {
      return closeReaderSession(state, sessionId);
    },
    dispose() {
      disposeReaderSessionRegistry(state);
    },
  };
}

function reserveReaderSession(
  state: ReaderSessionRegistryState,
  sessionId: ReaderSessionId,
): ReserveReaderSessionResult {
  if (state.disposed) return { ok: false, reason: 'disposed' };
  if (state.entries.has(sessionId)) return { ok: false, reason: 'exists' };
  state.entries.set(sessionId, { kind: 'pending' });
  return { ok: true };
}

function releasePendingReaderSession(
  state: ReaderSessionRegistryState,
  sessionId: ReaderSessionId,
): void {
  const entry = state.entries.get(sessionId);
  if (entry?.kind === 'pending') {
    state.entries.delete(sessionId);
  }
}

function commitReaderSession(
  state: ReaderSessionRegistryState,
  sessionId: ReaderSessionId,
  session: ReaderSession,
): CommitReaderSessionResult {
  if (state.disposed) {
    releaseSessionBestEffort(state, session);
    return { ok: false, reason: 'disposed' };
  }
  const entry = state.entries.get(sessionId);
  if (entry?.kind !== 'pending') {
    releaseSessionBestEffort(state, session);
    return { ok: false, reason: 'collision' };
  }
  state.entries.set(sessionId, { kind: 'open', session });
  return { ok: true };
}

function getReaderSession(
  state: ReaderSessionRegistryState,
  sessionId: ReaderSessionId,
): ReaderSession | undefined {
  const entry = state.entries.get(sessionId);
  return entry?.kind === 'open' ? entry.session : undefined;
}

function closeReaderSession(
  state: ReaderSessionRegistryState,
  sessionId: ReaderSessionId,
): CloseReaderSessionResult {
  const session = getReaderSession(state, sessionId);
  if (!session) return { ok: false, reason: 'not-found' };
  state.entries.delete(sessionId);
  try {
    session.dispose();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'dispose-failed', error };
  }
}

function disposeReaderSessionRegistry(state: ReaderSessionRegistryState): void {
  if (state.disposed) return;
  state.disposed = true;
  const sessions = openSessions(state.entries);
  state.entries.clear();
  for (const session of sessions) {
    releaseSessionBestEffort(state, session);
  }
}

function openSessions(
  entries: ReadonlyMap<ReaderSessionId, ReaderSessionRegistryEntry>,
): ReaderSession[] {
  const sessions: ReaderSession[] = [];
  for (const entry of entries.values()) {
    if (entry.kind === 'open') sessions.push(entry.session);
  }
  return sessions;
}

function releaseSessionBestEffort(state: ReaderSessionRegistryState, session: ReaderSession): void {
  try {
    session.dispose();
  } catch (error) {
    warnDisposeFailure(state, error);
  }
}

function warnDisposeFailure(state: ReaderSessionRegistryState, error: unknown): void {
  try {
    state.logger?.warn('Reader runtime session disposal failed', error);
  } catch {
    // Ignore logger failures while tearing down reader runtime sessions.
  }
}

interface ReaderSessionRegistryState {
  readonly entries: Map<ReaderSessionId, ReaderSessionRegistryEntry>;
  readonly logger?: Logger;
  disposed: boolean;
}
