import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserReaderBoundedSessionOwner,
  BrowserReaderState,
} from '../../src/bindings/browser/reader/types';
import {
  commitRevisionHandle,
  isCurrentRevisionHandle,
} from '../../src/bindings/browser/reader/pipeline/revision-handle';
import {
  recordBrowserReaderAcceptedRevision,
  resumeBrowserReaderExactReads,
  suspendBrowserReaderExactReads,
} from '../../src/bindings/browser/reader-session-host';
import {
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader bounded session ownership', () => {
  it('reopens exact reads only after the accepted revision is committed', () => {
    const { state, owner } = readyOwner();
    const previous = requireRevision(state);

    const gate = requireGate(suspendBrowserReaderExactReads(state));
    recordBrowserReaderAcceptedRevision(owner, { revisionId: 'rev', revisionVersion: 1 });

    expect(isCurrentRevisionHandle(state, previous)).toBe(false);
    expect(resumeBrowserReaderExactReads(state, gate)).toBe(false);

    const committed = commitRevisionHandle(state, state.worker, 'rev', 1);
    state.revisionHandle = committed;

    expect(resumeBrowserReaderExactReads(state, gate)).toBe(true);
    expect(isCurrentRevisionHandle(state, committed)).toBe(true);
  });

  it('does not let an older suspend token reopen a newer growth attempt', () => {
    const { state, owner } = readyOwner();
    const first = requireGate(suspendBrowserReaderExactReads(state));
    const second = requireGate(suspendBrowserReaderExactReads(state));
    recordBrowserReaderAcceptedRevision(owner, { revisionId: 'rev', revisionVersion: 0 });
    const recommitted = commitRevisionHandle(state, state.worker, 'rev', 0);
    state.revisionHandle = recommitted;

    expect(resumeBrowserReaderExactReads(state, first)).toBe(false);
    expect(resumeBrowserReaderExactReads(state, second)).toBe(true);
  });

  it('keeps committed reads open while an independent candidate advances', () => {
    const { state } = readyOwner();
    const committedOwner = state.boundedSessions.current;
    state.boundedSessions.current = undefined;
    const candidate = owner(state, 'candidate');
    candidate.readsSuspended = true;
    recordBrowserReaderAcceptedRevision(candidate, {
      revisionId: 'candidate-revision',
      revisionVersion: 4,
    });
    state.boundedSessions.candidate = candidate;
    const committed = requireRevision(state);

    expect(isCurrentRevisionHandle(state, committed)).toBe(true);

    state.boundedSessions.current = committedOwner;
  });
});

function readyOwner(): {
  readonly state: BrowserReaderState;
  readonly owner: BrowserReaderBoundedSessionOwner;
} {
  const fixture = createWorker(() => undefined, 'bounded-owner-session');
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 1, 1));
  const currentOwner = owner(state, 'rev');
  recordBrowserReaderAcceptedRevision(currentOwner, { revisionId: 'rev', revisionVersion: 0 });
  state.boundedSessions.current = currentOwner;
  return { state, owner: currentOwner };
}

function owner(state: BrowserReaderState, _label: string): BrowserReaderBoundedSessionOwner {
  return {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      currentSnapshot: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    },
    worker: state.worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
}

function requireRevision(state: BrowserReaderState) {
  if (!state.revisionHandle) throw new Error('test revision is missing');
  return state.revisionHandle;
}

function requireGate<T>(gate: T | undefined): T {
  if (!gate) throw new Error('test exact-read gate is missing');
  return gate;
}
