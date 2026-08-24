import { describe, expect, it, vi } from 'vitest';
import type { BrowserReaderBoundedSnapshot } from '../../src/bindings/browser/core-contracts';
import type {
  BrowserReaderBoundedSessionOwner,
  BrowserReaderState,
} from '../../src/bindings/browser/reader/types';
import {
  commitRevisionHandle,
  isCurrentRevisionHandle,
} from '../../src/bindings/browser/reader/pipeline/revision-handle';
import {
  ensureFrameLoaded,
  warmBrowserReaderFrameWindow,
} from '../../src/bindings/browser/reader/frame-cache';
import {
  recordBrowserReaderAcceptedRevision,
  restoreBrowserReaderExactReads,
  resumeBrowserReaderExactReads,
  suspendBrowserReaderExactReads,
} from '../../src/bindings/browser/reader-session-host';
import {
  createDeferred,
  createState,
  createWorker,
  frameBuffer,
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

  it('restores the committed handle only when no other commit event crossed the gate', () => {
    const { state } = readyOwner();
    const gate = requireGate(suspendBrowserReaderExactReads(state));

    expect(restoreBrowserReaderExactReads(state, gate)).toBe(true);
    expect(state.revisionHandle && isCurrentRevisionHandle(state, state.revisionHandle)).toBe(true);

    const stale = requireGate(suspendBrowserReaderExactReads(state));
    state.commitGeneration += 1;
    expect(restoreBrowserReaderExactReads(state, stale)).toBe(false);
    expect(state.revisionHandle).toBeUndefined();
  });

  it('does not reuse an in-flight frame window after restoring an exact-read gate', async () => {
    const { state } = readyOwner();
    const worker = vi.mocked(state.worker);
    const staleWindow =
      createDeferred<Awaited<ReturnType<typeof state.worker.warmFrameWindowAtRevision>>>();
    worker.warmFrameWindowAtRevision.mockImplementationOnce(() => staleWindow.promise);
    state.frames.clear();

    const staleWarm = warmBrowserReaderFrameWindow(state, 0);
    expect(worker.warmFrameWindowAtRevision.mock.calls).toHaveLength(1);
    expect(state.pendingFrameLoads.has(0)).toBe(true);

    const gate = requireGate(suspendBrowserReaderExactReads(state));
    expect(state.pendingFrameLoads.has(0)).toBe(false);
    expect(restoreBrowserReaderExactReads(state, gate)).toBe(true);

    const currentWarm = warmBrowserReaderFrameWindow(state, 0);
    expect(worker.warmFrameWindowAtRevision.mock.calls).toHaveLength(1);

    staleWindow.resolve({
      revision: { revisionId: 'rev', revisionVersion: 0 },
      value: {
        plan: {
          revisionId: 'rev',
          centerSpreadIndex: 0,
          displaySpreadIndex: 0,
          spreadIndexes: [0],
        },
        frames: [frameBuffer('rev', 0)],
        spreads: [{ spreadIndex: 0, resources: [], missingResources: [] }],
      },
    });
    await staleWarm;

    expect(worker.warmFrameWindowAtRevision.mock.calls).toHaveLength(2);
    await currentWarm;
    const currentFrame = state.frames.get(0);
    expect(currentFrame).toBeDefined();

    expect(state.frames.get(0)).toBe(currentFrame);
  });

  it('retries a frame missed while exact reads were suspended', async () => {
    const { state } = readyOwner();
    const worker = vi.mocked(state.worker);
    const invalidated = vi.fn();
    state.frames.clear();
    state.spreadContentInvalidatedListeners.add(invalidated);

    const gate = requireGate(suspendBrowserReaderExactReads(state));
    await expect(ensureFrameLoaded(state, 0)).resolves.toBeUndefined();
    expect(worker.warmFrameWindowAtRevision.mock.calls).toHaveLength(0);

    expect(restoreBrowserReaderExactReads(state, gate)).toBe(true);
    expect(invalidated).toHaveBeenCalledOnce();
    expect(invalidated).toHaveBeenCalledWith(0);

    await expect(ensureFrameLoaded(state, 0)).resolves.toBeDefined();
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
      calibrateFontVerticalMetrics: vi.fn(),
      currentSnapshot: vi.fn(
        () => ({ revision: state.revisionBundle.revision }) as BrowserReaderBoundedSnapshot,
      ),
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
