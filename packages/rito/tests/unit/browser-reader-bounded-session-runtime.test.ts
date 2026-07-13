import { describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '../../src/reader';
import {
  completeBrowserReaderBoundedSession,
  ensureBrowserReaderBoundedLocator,
  ensureBrowserReaderBoundedSpread,
  startBrowserReaderBoundedCandidate,
} from '../../src/bindings/browser/bounded-session-runtime';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  type BrowserReaderBoundedSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import { isCurrentRevisionHandle } from '../../src/bindings/browser/reader/pipeline/revision-handle';
import { toCoreLayoutConfig } from '../../src/bindings/browser/reader/layout';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  createDeferred,
  createState,
  createWorker,
  frameBuffer,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser bounded session runtime', () => {
  it('starts a finite candidate and retires the previous owner after atomic commit', async () => {
    const previous = createWorker(() => undefined, 'previous');
    const candidate = createWorker(() => undefined, 'candidate');
    const state = createState(previous.worker);
    const initial = boundedSnapshot('old', 0, 1, 'ready');
    setRevisionState(state, initial.revision, initial.navigation);
    const previousControllerDispose = vi.fn(() => Promise.resolve());
    const previousOwner = owner(previous.worker, { dispose: previousControllerDispose });
    recordBrowserReaderAcceptedRevision(previousOwner, initial.revision);
    state.boundedSessions.current = previousOwner;
    const next = boundedSnapshot('next', 1, 2, 'ready');
    const start = vi.fn(() => Promise.resolve(next));
    const candidateOwner = owner(candidate.worker, { start });
    recordBrowserReaderAcceptedRevision(candidateOwner, next.revision);
    mockAggregates(candidate.worker, next);

    const committed = await startBrowserReaderBoundedCandidate(state, candidateOwner, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      targetSpreadIndex: 1,
    });

    expect(committed).toBe(next);
    expect(start).toHaveBeenCalledWith({
      layoutConfig: toCoreLayoutConfig(state.config, state.fontMetrics),
      lineBreaking: 'greedy',
      budget: { maxTopLevelNodes: 32 },
      targetSpreadIndex: 1,
    });
    expect(state.boundedSessions.current).toBe(candidateOwner);
    expect(previousControllerDispose).toHaveBeenCalledOnce();
    expect(previous.dispose).toHaveBeenCalledOnce();
  });

  it('does not let an older candidate overwrite a newer committed layout', async () => {
    const fixture = currentFixture();
    const staleWorker = createWorker(() => undefined, 'stale-candidate');
    const staleDrain = createDeferred<undefined>();
    const staleOwner = owner(staleWorker.worker, { dispose: vi.fn(() => staleDrain.promise) });
    fixture.state.boundedSessions.candidate = staleOwner;
    const firstWorker = createWorker(() => undefined, 'first-candidate');
    const firstStart = vi.fn<BrowserReaderBoundedSessionOwner['controller']['start']>();
    const firstOwner = owner(firstWorker.worker, { start: firstStart });
    const first = startBrowserReaderBoundedCandidate(fixture.state, firstOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
    });
    await Promise.resolve();

    const latestWorker = createWorker(() => undefined, 'latest-candidate');
    const latestSnapshot = boundedSnapshot('latest', 0, 1, 'ready');
    const latestOwner = owner(latestWorker.worker, {
      start: vi.fn(() => Promise.resolve(latestSnapshot)),
    });
    recordBrowserReaderAcceptedRevision(latestOwner, latestSnapshot.revision);
    mockAggregates(latestWorker.worker, latestSnapshot);

    await expect(
      startBrowserReaderBoundedCandidate(fixture.state, latestOwner, {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      }),
    ).resolves.toBe(latestSnapshot);
    staleDrain.resolve(undefined);

    await expect(first).resolves.toBeUndefined();
    expect(firstStart).not.toHaveBeenCalled();
    expect(fixture.state.boundedSessions.current).toBe(latestOwner);
    expect(fixture.state.revisionBundle.revision).toBe(latestSnapshot.revision);
  });

  it('aborts a candidate during commit preparation without publishing it', async () => {
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'aborted-candidate');
    const snapshot = boundedSnapshot('aborted', 0, 1, 'ready');
    const controllerDispose = vi.fn(() => Promise.resolve());
    const candidateOwner = owner(candidate.worker, {
      start: vi.fn(() => Promise.resolve(snapshot)),
      dispose: controllerDispose,
    });
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    const footnotes =
      createDeferred<Awaited<ReturnType<BrowserReaderWorkerClient['getFootnotesAtRevision']>>>();
    const revision = revisionHandle(snapshot);
    const readFootnotes = vi.fn(() => footnotes.promise);
    Object.assign(candidate.worker, {
      getFootnotesAtRevision: readFootnotes,
      getChapterTextIndicesAtRevision: vi.fn(() =>
        Promise.resolve({
          revision,
          value: { revisionId: revision.revisionId, entries: {} },
        }),
      ),
    });
    const abort = new AbortController();

    const task = startBrowserReaderBoundedCandidate(
      fixture.state,
      candidateOwner,
      {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      },
      abort.signal,
    );
    await waitForCall(readFootnotes);
    abort.abort();
    footnotes.resolve({
      revision,
      value: { revisionId: revision.revisionId, entries: {} },
    });

    await expect(task).resolves.toBeUndefined();
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('current');
    expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
    expect(controllerDispose).toHaveBeenCalled();
    expect(candidate.dispose).toHaveBeenCalled();
  });

  it('rejects a shared-worker candidate without disposing the current worker', async () => {
    const fixture = currentFixture();
    const controllerDispose = vi.fn(() => Promise.resolve());
    const duplicate = owner(fixture.worker, { dispose: controllerDispose });

    await expect(
      startBrowserReaderBoundedCandidate(fixture.state, duplicate, {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      }),
    ).rejects.toThrow('independent worker session');
    expect(controllerDispose).toHaveBeenCalledOnce();
    expect(fixture.dispose).not.toHaveBeenCalled();
    expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
  });

  it('rejects a candidate aliased to the previous candidate worker', async () => {
    const fixture = currentFixture();
    const shared = createWorker(() => undefined, 'shared-candidate');
    const previous = owner(shared.worker);
    fixture.state.boundedSessions.candidate = previous;
    const duplicateDispose = vi.fn(() => Promise.resolve());
    const duplicate = owner(shared.worker, { dispose: duplicateDispose });

    await expect(
      startBrowserReaderBoundedCandidate(fixture.state, duplicate, {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      }),
    ).rejects.toThrow('independent worker sessions');
    expect(duplicateDispose).toHaveBeenCalledOnce();
    expect(shared.dispose).not.toHaveBeenCalled();
    expect(fixture.state.boundedSessions.candidate).toBe(previous);
  });

  it('treats Reader disposal during candidate start as cancellation', async () => {
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'disposed-candidate');
    const started = createDeferred<BrowserReaderBoundedSnapshot>();
    const start = vi.fn(() => started.promise);
    const candidateOwner = owner(candidate.worker, { start });
    const task = startBrowserReaderBoundedCandidate(fixture.state, candidateOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
    });
    await waitForCall(start);

    fixture.state.disposed = true;
    started.reject(new Error('bounded reader session stopped'));

    await expect(task).resolves.toBeUndefined();
    expect(candidate.dispose).toHaveBeenCalled();
  });

  it('commits an accepted spread after abort but resolves the caller as cancelled', async () => {
    const fixture = currentFixture();
    const next = boundedSnapshot('current', 1, 2, 'ready');
    const deferred = createDeferred<BrowserReaderBoundedSnapshot>();
    const ensureSpread = vi.fn(() => deferred.promise);
    fixture.owner.controller.ensureSpread = ensureSpread;
    const abort = new AbortController();
    const committed = vi.fn();
    fixture.state.layoutCommittedListeners.add(committed);

    const task = ensureBrowserReaderBoundedSpread(fixture.state, 1, abort.signal);
    await waitForCall(ensureSpread);
    abort.abort();
    recordBrowserReaderAcceptedRevision(fixture.owner, next.revision);
    mockAggregates(fixture.worker, next);
    deferred.resolve(next);

    await expect(task).resolves.toBeUndefined();
    expect(fixture.state.revisionBundle.revision).toBe(next.revision);
    expect(fixture.owner.readsSuspended).toBe(false);
    expect(committed).not.toHaveBeenCalled();
  });

  it('commits a complete final miss before returning false', async () => {
    const fixture = currentFixture();
    const final = boundedSnapshot('current', 1, 1, 'complete', {
      target: { kind: 'spread', spreadIndex: 3 },
      withFrame: false,
    });
    fixture.owner.controller.ensureSpread = vi.fn(() => Promise.resolve(final));
    recordBrowserReaderAcceptedRevision(fixture.owner, final.revision);
    mockAggregates(fixture.worker, final);

    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 3)).resolves.toBe(false);
    expect(fixture.state.revisionBundle.revision.status).toBe('complete');
    expect(fixture.state.activeSpreadIndex).toBe(0);
  });

  it('copies a locator and returns its committed public resolution', async () => {
    const fixture = currentFixture();
    const locator: ReaderLocator = {
      href: 'chapter.xhtml',
      sourcePoint: { nodePath: [1, 2], textOffset: 3 },
    };
    const resolved = boundedSnapshot('current', 1, 2, 'ready', {
      target: {
        kind: 'locator',
        locator,
        resolution: {
          status: 'resolved',
          revisionId: 'current',
          locator,
          spineIdref: 'chapter',
          pageIndex: 1,
          spreadIndex: 1,
          matchedBy: 'sourcePoint',
        },
      },
    });
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      () => Promise.resolve(resolved),
    );
    fixture.owner.controller.ensureLocator = ensureLocator;
    recordBrowserReaderAcceptedRevision(fixture.owner, resolved.revision);
    mockAggregates(fixture.worker, resolved);

    const task = ensureBrowserReaderBoundedLocator(fixture.state, locator);
    await expect(task).resolves.toEqual({
      status: 'resolved',
      locator,
      spineIdref: 'chapter',
      pageIndex: 1,
      spreadIndex: 1,
      matchedBy: 'sourcePoint',
    });
    const request = ensureLocator.mock.calls[0]?.[0];
    expect(request).not.toBe(locator);
    expect(request?.sourcePoint?.nodePath).not.toBe(locator.sourcePoint?.nodePath);
  });

  it('completes once and publishes a full layout commit', async () => {
    const fixture = currentFixture();
    const final = boundedSnapshot('current', 0, 1, 'complete', {
      target: { kind: 'complete' },
    });
    const complete = vi.fn(() => Promise.resolve(final));
    fixture.owner.controller.complete = complete;
    recordBrowserReaderAcceptedRevision(fixture.owner, final.revision);
    mockAggregates(fixture.worker, final);
    const committed = vi.fn();
    fixture.state.layoutCommittedListeners.add(committed);

    await expect(completeBrowserReaderBoundedSession(fixture.state)).resolves.toBe(true);
    await expect(completeBrowserReaderBoundedSession(fixture.state)).resolves.toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(committed).toHaveBeenCalledOnce();
  });

  it('restores the exact read gate when growth fails before accepting an advance', async () => {
    const fixture = currentFixture();
    fixture.owner.controller.ensureSpread = vi.fn(() => Promise.reject(new Error('failed')));

    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 1)).rejects.toThrow('failed');
    expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
    expect(fixture.state.revisionHandle).toBeDefined();
    expect(
      fixture.state.revisionHandle &&
        isCurrentRevisionHandle(fixture.state, fixture.state.revisionHandle),
    ).toBe(true);
    expect(fixture.controllerDispose).not.toHaveBeenCalled();
  });

  it('detaches and drains a current owner that fails after accepting an advance', async () => {
    const fixture = currentFixture();
    fixture.owner.controller.ensureSpread = vi.fn(() => {
      recordBrowserReaderAcceptedRevision(fixture.owner, {
        ...fixture.state.revisionBundle.revision,
        revisionVersion: 1,
      });
      return Promise.reject(new Error('terminal'));
    });

    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 1)).rejects.toThrow('terminal');
    expect(fixture.state.boundedSessions.current).toBeUndefined();
    expect(fixture.state.revisionHandle).toBeUndefined();
    expect(fixture.controllerDispose).toHaveBeenCalledOnce();
    expect(fixture.dispose).toHaveBeenCalledOnce();
  });

  it('does not restore a revision released by a terminal controller failure', async () => {
    const fixture = currentFixture();
    fixture.owner.controller.ensureSpread = vi.fn(() => {
      fixture.owner.controller.currentSnapshot = vi.fn(() => undefined);
      return Promise.reject(new Error('terminal cleanup'));
    });

    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 1)).rejects.toThrow(
      'terminal cleanup',
    );
    expect(fixture.state.boundedSessions.current).toBeUndefined();
    expect(fixture.state.revisionHandle).toBeUndefined();
    expect(fixture.controllerDispose).toHaveBeenCalledOnce();
  });

  it('treats a current mutation stopped by candidate replacement as superseded', async () => {
    const fixture = currentFixture();
    const growth = createDeferred<BrowserReaderBoundedSnapshot>();
    const ensureSpread = vi.fn(() => growth.promise);
    fixture.owner.controller.ensureSpread = ensureSpread;
    const pending = ensureBrowserReaderBoundedSpread(fixture.state, 1);
    await waitForCall(ensureSpread);

    const candidate = createWorker(() => undefined, 'replacement');
    const replacement = boundedSnapshot('replacement', 0, 1, 'ready');
    const replacementOwner = owner(candidate.worker, {
      start: vi.fn(() => Promise.resolve(replacement)),
    });
    recordBrowserReaderAcceptedRevision(replacementOwner, replacement.revision);
    mockAggregates(candidate.worker, replacement);
    await startBrowserReaderBoundedCandidate(fixture.state, replacementOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
    });
    growth.reject(new Error('bounded reader session stopped'));

    await expect(pending).resolves.toBeUndefined();
    expect(fixture.state.boundedSessions.current).toBe(replacementOwner);
  });
});

function currentFixture(): {
  readonly state: BrowserReaderState;
  readonly worker: BrowserReaderWorkerClient;
  readonly owner: BrowserReaderBoundedSessionOwner;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly controllerDispose: ReturnType<typeof vi.fn>;
} {
  const fixture = createWorker(() => undefined, 'current');
  const state = createState(fixture.worker);
  const initial = boundedSnapshot('current', 0, 1, 'ready', { revisionVersion: 0 });
  setRevisionState(state, initial.revision, initial.navigation);
  const controllerDispose = vi.fn(() => Promise.resolve());
  const currentOwner = owner(fixture.worker, {
    dispose: controllerDispose,
    currentSnapshot: vi.fn(() => initial),
  });
  recordBrowserReaderAcceptedRevision(currentOwner, initial.revision);
  state.boundedSessions.current = currentOwner;
  return {
    state,
    worker: fixture.worker,
    owner: currentOwner,
    dispose: fixture.dispose,
    controllerDispose,
  };
}

function owner(
  worker: BrowserReaderWorkerClient,
  overrides: Partial<BrowserReaderBoundedSessionOwner['controller']> = {},
): BrowserReaderBoundedSessionOwner {
  return {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      currentSnapshot: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(() => Promise.resolve()),
      ...overrides,
    },
    worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
}

function boundedSnapshot(
  revisionId: string,
  spreadIndex: number,
  spreadCount: number,
  status: 'ready' | 'complete',
  options: {
    readonly revisionVersion?: number;
    readonly target?: BrowserReaderBoundedSnapshot['target'];
    readonly withFrame?: boolean;
  } = {},
): BrowserReaderBoundedSnapshot {
  const result = revisionResult(revisionId, spreadCount, spreadCount, spreadIndex);
  const revisionVersion = options.revisionVersion ?? 1;
  const revision = {
    ...result.bundle.revision,
    revisionVersion,
    status,
    ...(status === 'complete'
      ? { finalExtent: { pageCount: spreadCount, spreadCount } }
      : { finalExtent: undefined }),
  };
  const navigation = result.bundle.navigation;
  const withFrame = options.withFrame ?? true;
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
    target: options.target ?? { kind: 'spread', spreadIndex },
    presentationSpreadIndex: spreadIndex,
    ...(withFrame && spreadCount > 0
      ? {
          frameWindow: {
            plan: {
              revisionId,
              centerSpreadIndex: spreadIndex,
              displaySpreadIndex: spreadIndex,
              spreadIndexes: [spreadIndex],
            },
            frames: [frameBuffer(revisionId, spreadIndex)],
            spreads: [{ spreadIndex, resources: [] }],
          },
        }
      : {}),
  };
}

function mockAggregates(
  worker: BrowserReaderWorkerClient,
  snapshot: BrowserReaderBoundedSnapshot,
): void {
  const revision = {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
  Object.assign(worker, {
    getFootnotesAtRevision: vi.fn(() =>
      Promise.resolve({ revision, value: { revisionId: revision.revisionId, entries: {} } }),
    ),
    getChapterTextIndicesAtRevision: vi.fn(() =>
      Promise.resolve({ revision, value: { revisionId: revision.revisionId, entries: {} } }),
    ),
  });
}

function revisionHandle(snapshot: BrowserReaderBoundedSnapshot) {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}

async function waitForCall(mock: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 8 && mock.mock.calls.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledOnce();
}
