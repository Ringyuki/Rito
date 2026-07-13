import { describe, expect, it, vi } from 'vitest';
import { commitBrowserReaderBoundedSnapshot } from '../../src/bindings/browser/bounded-revision-commit';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  suspendBrowserReaderExactReads,
  type BrowserReaderBoundedSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import { isCurrentRevisionHandle } from '../../src/bindings/browser/reader/pipeline/revision-handle';
import {
  createDeferred,
  createState,
  createWorker,
  frameBuffer,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser bounded revision commit adapter', () => {
  it('atomically publishes an exact candidate without releasing controller-owned revisions', async () => {
    const previous = createWorker(() => undefined, 'previous-session');
    const candidate = createWorker(() => undefined, 'candidate-session');
    const state = createState(previous.worker);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    const previousOwner = owner(previous.worker);
    recordBrowserReaderAcceptedRevision(previousOwner, state.revisionBundle.revision);
    const snapshot = boundedSnapshot('candidate', 3, 2, 1);
    const candidateOwner = owner(candidate.worker, true);
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    state.boundedSessions.current = previousOwner;
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, snapshot);
    const committed = vi.fn();
    state.layoutCommittedListeners.add(committed);

    const result = await commitBrowserReaderBoundedSnapshot(state, {
      owner: candidateOwner,
      snapshot,
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      baseCommitGeneration: state.commitGeneration,
    });

    expect(result).toEqual({ committed: true, retiredOwner: previousOwner });
    expect(state.boundedSessions).toEqual({ current: candidateOwner, candidate: undefined });
    expect(state.revisionBundle.revision).toBe(snapshot.revision);
    expect(state.revisionBundle.footnotes.entries['note']?.text).toBe('note text');
    expect(state.revisionBundle.chapterTextIndices.entries['chapter']?.normalizedText).toBe(
      'chapter text',
    );
    expect(state.activeSpreadIndex).toBe(1);
    expect(candidateOwner.readsSuspended).toBe(false);
    expect(previous.releaseRevisionAtRevision).not.toHaveBeenCalled();
    expect(candidate.releaseRevisionAtRevision).not.toHaveBeenCalled();
    expect(committed).toHaveBeenCalledWith(1);
  });

  it('drops a stale candidate without releasing its controller-owned snapshot', async () => {
    const fixture = createWorker(() => undefined, 'candidate-session');
    const state = createState(fixture.worker);
    const snapshot = boundedSnapshot('candidate', 1, 1, 0);
    const candidate = owner(fixture.worker, true);
    recordBrowserReaderAcceptedRevision(candidate, snapshot.revision);
    state.boundedSessions.candidate = candidate;
    const footnotes =
      createDeferred<Awaited<ReturnType<BrowserReaderWorkerClient['getFootnotesAtRevision']>>>();
    Object.assign(fixture.worker, {
      getFootnotesAtRevision: vi.fn(() => footnotes.promise),
      getChapterTextIndicesAtRevision: vi.fn(() =>
        Promise.resolve({
          revision: revisionHandle(snapshot),
          value: { revisionId: snapshot.revision.revisionId, entries: {} },
        }),
      ),
    });
    const task = commitBrowserReaderBoundedSnapshot(state, {
      owner: candidate,
      snapshot,
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      baseCommitGeneration: state.commitGeneration,
    });
    state.boundedSessions.candidate = undefined;
    footnotes.resolve({
      revision: revisionHandle(snapshot),
      value: { revisionId: snapshot.revision.revisionId, entries: {} },
    });

    await expect(task).resolves.toEqual({ committed: false });
    expect(fixture.releaseRevisionAtRevision).not.toHaveBeenCalled();
    expect(state.revisionBundle.revision.revisionId).toBe('');
  });

  it('does not release a controller-owned snapshot when frame preparation fails', async () => {
    const fixture = createWorker(() => undefined, 'candidate-session');
    const state = createState(fixture.worker);
    const snapshot = boundedSnapshot('candidate', 1, 1, 0);
    const candidate = owner(fixture.worker);
    recordBrowserReaderAcceptedRevision(candidate, snapshot.revision);
    state.boundedSessions.candidate = candidate;
    mockAggregates(fixture.worker, snapshot);
    Object.assign(state, {
      decodeFrameCommandBuffer: vi.fn(() => {
        throw new Error('broken frame');
      }),
    });

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidate,
        snapshot,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).rejects.toThrow('broken frame');
    expect(fixture.releaseRevisionAtRevision).not.toHaveBeenCalled();
    expect(state.boundedSessions.candidate).toBe(candidate);
  });

  it.each([
    ['final spread miss', { kind: 'spread', spreadIndex: 4 }, 'complete'],
    ['completion', { kind: 'complete' }, 'complete'],
    [
      'locator without a page projection',
      {
        kind: 'locator',
        locator: { href: 'chapter.xhtml' },
        resolution: {
          status: 'pending',
          revisionId: 'candidate',
          locator: { href: 'chapter.xhtml' },
          spineIdref: 'chapter',
          reason: 'noPageProjection',
          matchedBy: 'href',
        },
      },
      'ready',
    ],
  ] as const)('commits %s without inventing a selected frame', async (_label, target, status) => {
    const previous = createWorker(() => undefined, 'previous-session');
    const candidate = createWorker(() => undefined, 'candidate-session');
    const state = createState(previous.worker);
    setRevisionState(state, revisionResult('old', 3, 3).bundle.revision);
    state.activeSpreadIndex = 2;
    const previousOwner = owner(previous.worker);
    recordBrowserReaderAcceptedRevision(previousOwner, state.revisionBundle.revision);
    const snapshot = retargetWithoutFrame(boundedSnapshot('candidate', 2, 2, 1), target, status);
    const candidateOwner = owner(candidate.worker, true);
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    state.boundedSessions.current = previousOwner;
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, snapshot);

    const result = await commitBrowserReaderBoundedSnapshot(state, {
      owner: candidateOwner,
      snapshot,
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      baseCommitGeneration: state.commitGeneration,
    });

    expect(result.committed).toBe(true);
    expect(state.activeSpreadIndex).toBe(1);
    expect(state.frames.size).toBe(0);
    expect(previous.releaseRevisionAtRevision).not.toHaveBeenCalled();
    expect(candidate.releaseRevisionAtRevision).not.toHaveBeenCalled();
  });

  it('reopens a suspended current session only after its accepted advance commits', async () => {
    const fixture = createWorker(() => undefined, 'current-session');
    const state = createState(fixture.worker);
    const initial = boundedSnapshot('bounded', 1, 1, 0, 0);
    setRevisionState(state, initial.revision, initial.navigation);
    const current = owner(fixture.worker);
    recordBrowserReaderAcceptedRevision(current, initial.revision);
    state.boundedSessions.current = current;
    const gate = suspendBrowserReaderExactReads(state);
    if (!gate) throw new Error('test exact-read gate is missing');
    const advanced = boundedSnapshot('bounded', 2, 2, 1, 1);
    recordBrowserReaderAcceptedRevision(current, advanced.revision);
    mockAggregates(fixture.worker, advanced);

    const result = await commitBrowserReaderBoundedSnapshot(state, {
      owner: current,
      snapshot: advanced,
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      baseCommitGeneration: state.commitGeneration,
      exactReadGate: gate,
    });

    expect(result).toEqual({ committed: true });
    expect(current.readsSuspended).toBe(false);
    expect(state.revisionHandle && isCurrentRevisionHandle(state, state.revisionHandle)).toBe(true);
    expect(fixture.releaseRevisionAtRevision).not.toHaveBeenCalled();
  });

  it('lets same-session extent growth defer full layout publication to its caller', async () => {
    const fixture = createWorker(() => undefined, 'current-session');
    const state = createState(fixture.worker);
    const initial = boundedSnapshot('bounded', 1, 1, 0, 0);
    setRevisionState(state, initial.revision, initial.navigation);
    const current = owner(fixture.worker);
    recordBrowserReaderAcceptedRevision(current, initial.revision);
    state.boundedSessions.current = current;
    const gate = suspendBrowserReaderExactReads(state);
    if (!gate) throw new Error('test exact-read gate is missing');
    const advanced = boundedSnapshot('bounded', 2, 2, 1, 1);
    recordBrowserReaderAcceptedRevision(current, advanced.revision);
    mockAggregates(fixture.worker, advanced);
    const committed = vi.fn();
    state.layoutCommittedListeners.add(committed);

    await commitBrowserReaderBoundedSnapshot(state, {
      owner: current,
      snapshot: advanced,
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      baseCommitGeneration: state.commitGeneration,
      exactReadGate: gate,
      notifyLayoutCommitted: false,
    });

    expect(committed).not.toHaveBeenCalled();
    expect(current.readsSuspended).toBe(false);
  });
});

function boundedSnapshot(
  revisionId: string,
  pageCount: number,
  spreadCount: number,
  spreadIndex: number,
  revisionVersion = 3,
): BrowserReaderBoundedSnapshot {
  const result = revisionResult(revisionId, pageCount, spreadCount, spreadIndex);
  const revision = { ...result.bundle.revision, revisionVersion, status: 'ready' as const };
  const navigation = result.bundle.navigation;
  const frameWindow =
    spreadCount > 0
      ? {
          plan: {
            revisionId,
            centerSpreadIndex: spreadIndex,
            displaySpreadIndex: spreadIndex,
            spreadIndexes: [spreadIndex],
          },
          frames: [frameBuffer(revisionId, spreadIndex)],
          spreads: [{ spreadIndex, resources: [] }],
        }
      : undefined;
  return {
    generation: revisionVersion + 1,
    revision,
    presentation: {
      revision,
      navigation,
      tocTargets: result.bundle.tocTargets,
      fontFamilies: result.bundle.fontFamilies,
    },
    navigation,
    target: { kind: 'spread', spreadIndex },
    presentationSpreadIndex: spreadIndex,
    ...(frameWindow ? { frameWindow } : {}),
  };
}

function owner(
  worker: BrowserReaderWorkerClient,
  readsSuspended = false,
): BrowserReaderBoundedSessionOwner {
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
    worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended,
  };
}

function retargetWithoutFrame(
  snapshot: BrowserReaderBoundedSnapshot,
  target: BrowserReaderBoundedSnapshot['target'],
  status: 'ready' | 'complete',
): BrowserReaderBoundedSnapshot {
  const { frameWindow: _frameWindow, ...rest } = snapshot;
  const revision = { ...snapshot.revision, status };
  return {
    ...rest,
    revision,
    presentation: { ...snapshot.presentation, revision },
    target,
  };
}

function mockAggregates(
  worker: BrowserReaderWorkerClient,
  snapshot: BrowserReaderBoundedSnapshot,
): void {
  const revision = revisionHandle(snapshot);
  Object.assign(worker, {
    getFootnotesAtRevision: vi.fn(() =>
      Promise.resolve({
        revision,
        value: {
          revisionId: revision.revisionId,
          entries: { note: { kind: 'note', text: 'note text', html: '<p>note text</p>' } },
        },
      }),
    ),
    getChapterTextIndicesAtRevision: vi.fn(() =>
      Promise.resolve({
        revision,
        value: {
          revisionId: revision.revisionId,
          entries: {
            chapter: { href: 'chapter.xhtml', normalizedText: 'chapter text', spans: [] },
          },
        },
      }),
    ),
  });
}

function revisionHandle(snapshot: BrowserReaderBoundedSnapshot) {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}
