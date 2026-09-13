import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '../../src/reader';
import { commitBrowserReaderRevisionSnapshot } from '../../src/bindings/browser/revision-commit';
import type {
  BrowserReaderRevisionSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  suspendBrowserReaderExactReads,
  type BrowserReaderRevisionSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import { isCurrentRevisionHandle } from '../../src/bindings/browser/reader/pipeline/revision-handle';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { ensureFrameLoaded } from '../../src/bindings/browser/reader/frame-cache';
import {
  createDeferred,
  createState,
  createWorker,
  flushPromises,
  frameBuffer,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser revision commit adapter', () => {
  it('atomically publishes an exact candidate without releasing controller-owned revisions', async () => {
    const previous = createWorker(() => undefined, 'previous-session');
    const candidate = createWorker(() => undefined, 'candidate-session');
    const state = createState(previous.worker);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    const previousOwner = owner(previous.worker);
    recordBrowserReaderAcceptedRevision(previousOwner, state.revisionBundle.revision);
    const snapshot = revisionSnapshot('candidate', 3, 2, 1);
    const candidateOwner = owner(candidate.worker, true);
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    state.revisionSessions.current = previousOwner;
    state.revisionSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, snapshot);
    const committed = vi.fn();
    state.layoutCommittedListeners.add(committed);

    const result = await commitBrowserReaderRevisionSnapshot(state, {
      owner: candidateOwner,
      snapshot,
      config: state.config,
      spreadMode: state.spreadMode,
      baseCommitGeneration: state.commitGeneration,
    });

    expect(result).toEqual({ committed: true, retiredOwner: previousOwner });
    expect(state.revisionSessions).toEqual({ current: candidateOwner, candidate: undefined });
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

  it('retries a suspended frame miss after replacing its exact-read owner', async () => {
    const previous = createWorker(() => undefined, 'suspended-owner');
    const candidate = createWorker(() => undefined, 'replacement-owner');
    const state = createState(previous.worker);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    const previousOwner = owner(previous.worker);
    recordBrowserReaderAcceptedRevision(previousOwner, state.revisionBundle.revision);
    state.revisionSessions.current = previousOwner;
    state.frames.clear();
    const events: string[] = [];
    state.layoutCommittedListeners.add(() => events.push('layout'));
    state.spreadContentInvalidatedListeners.add((spreadIndex) => {
      events.push(`retry:${String(spreadIndex)}`);
    });

    const gate = suspendBrowserReaderExactReads(state);
    expect(gate?.owner).toBe(previousOwner);
    await expect(ensureFrameLoaded(state, 0)).resolves.toBeUndefined();

    const snapshot = revisionSnapshot('replacement', 2, 2, 1);
    const candidateOwner = owner(candidate.worker, true);
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    state.revisionSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, snapshot);

    await expect(
      commitBrowserReaderRevisionSnapshot(state, {
        owner: candidateOwner,
        snapshot,
        config: state.config,
        spreadMode: state.spreadMode,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: true, retiredOwner: previousOwner });

    expect(state.revisionSessions.current).toBe(candidateOwner);
    expect(events).toEqual(['layout', 'retry:0']);
    await expect(ensureFrameLoaded(state, 0)).resolves.toBeDefined();
    expect(candidate.warmFrameWindow).toHaveBeenCalledWith(
      {
        revisionId: snapshot.revision.revisionId,
        revisionVersion: snapshot.revision.revisionVersion,
      },
      0,
    );
  });

  it('drops a stale candidate without releasing its controller-owned snapshot', async () => {
    const fixture = createWorker(() => undefined, 'candidate-session');
    const state = createState(fixture.worker);
    const snapshot = revisionSnapshot('candidate', 1, 1, 0);
    const candidate = owner(fixture.worker, true);
    recordBrowserReaderAcceptedRevision(candidate, snapshot.revision);
    state.revisionSessions.candidate = candidate;
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
    const task = commitBrowserReaderRevisionSnapshot(state, {
      owner: candidate,
      snapshot,
      config: state.config,
      spreadMode: state.spreadMode,
      baseCommitGeneration: state.commitGeneration,
    });
    state.revisionSessions.candidate = undefined;
    footnotes.resolve({
      revision: revisionHandle(snapshot),
      value: {
        revisionId: snapshot.revision.revisionId,
        complete: true,
        pendingKeys: [],
        entries: {},
      },
    });

    await expect(task).resolves.toEqual({ committed: false });
    expect(fixture.releaseRevisionAtRevision).not.toHaveBeenCalled();
    expect(state.revisionBundle.revision.revisionId).toBe('');
  });

  it('does not release a controller-owned snapshot when frame preparation fails', async () => {
    const fixture = createWorker(() => undefined, 'candidate-session');
    const state = createState(fixture.worker);
    const snapshot = revisionSnapshot('candidate', 1, 1, 0);
    const candidate = owner(fixture.worker);
    recordBrowserReaderAcceptedRevision(candidate, snapshot.revision);
    state.revisionSessions.candidate = candidate;
    mockAggregates(fixture.worker, snapshot);
    Object.assign(state, {
      decodeFrameCommandBuffer: vi.fn(() => {
        throw new Error('broken frame');
      }),
    });

    await expect(
      commitBrowserReaderRevisionSnapshot(state, {
        owner: candidate,
        snapshot,
        config: state.config,
        spreadMode: state.spreadMode,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).rejects.toThrow('broken frame');
    expect(fixture.releaseRevisionAtRevision).not.toHaveBeenCalled();
    expect(state.revisionSessions.candidate).toBe(candidate);
  });

  it.each([
    ['final spread miss', { kind: 'spread', spreadIndex: 4 }],
    ['completion', { kind: 'complete' }],
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
    ],
  ] as const)('commits %s without inventing a selected frame', async (_label, target) => {
    const previous = createWorker(() => undefined, 'previous-session');
    const candidate = createWorker(() => undefined, 'candidate-session');
    const state = createState(previous.worker);
    setRevisionState(state, revisionResult('old', 3, 3).bundle.revision);
    state.activeSpreadIndex = 2;
    const previousOwner = owner(previous.worker);
    recordBrowserReaderAcceptedRevision(previousOwner, state.revisionBundle.revision);
    const snapshot = retargetWithoutFrame(revisionSnapshot('candidate', 2, 2, 1), target);
    const candidateOwner = owner(candidate.worker, true);
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    state.revisionSessions.current = previousOwner;
    state.revisionSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, snapshot);

    const result = await commitBrowserReaderRevisionSnapshot(state, {
      owner: candidateOwner,
      snapshot,
      config: state.config,
      spreadMode: state.spreadMode,
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
    const initial = revisionSnapshot('revision', 1, 1, 0, 0);
    setRevisionState(state, initial.revision, initial.navigation);
    const current = owner(fixture.worker);
    recordBrowserReaderAcceptedRevision(current, initial.revision);
    state.revisionSessions.current = current;
    const gate = suspendBrowserReaderExactReads(state);
    if (!gate) throw new Error('test exact-read gate is missing');
    const advanced = revisionSnapshot('revision', 2, 2, 1, 1);
    recordBrowserReaderAcceptedRevision(current, advanced.revision);
    mockAggregates(fixture.worker, advanced);

    const result = await commitBrowserReaderRevisionSnapshot(state, {
      owner: current,
      snapshot: advanced,
      config: state.config,
      spreadMode: state.spreadMode,
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
    const initial = revisionSnapshot('revision', 1, 1, 0, 0);
    setRevisionState(state, initial.revision, initial.navigation);
    const current = owner(fixture.worker);
    recordBrowserReaderAcceptedRevision(current, initial.revision);
    state.revisionSessions.current = current;
    const gate = suspendBrowserReaderExactReads(state);
    if (!gate) throw new Error('test exact-read gate is missing');
    const advanced = revisionSnapshot('revision', 2, 2, 1, 1);
    recordBrowserReaderAcceptedRevision(current, advanced.revision);
    mockAggregates(fixture.worker, advanced);
    const committed = vi.fn();
    state.layoutCommittedListeners.add(committed);

    await commitBrowserReaderRevisionSnapshot(state, {
      owner: current,
      snapshot: advanced,
      config: state.config,
      spreadMode: state.spreadMode,
      baseCommitGeneration: state.commitGeneration,
      exactReadGate: gate,
      notifyLayoutCommitted: false,
    });

    expect(committed).not.toHaveBeenCalled();
    expect(current.readsSuspended).toBe(false);
  });

  it('waits for every required font before atomically publishing a candidate', async () => {
    const loads = new Map<string, ReturnType<typeof createDeferred<FontFace>>>();
    class DeferredFontFace {
      constructor(readonly family: string) {}
      load(): Promise<FontFace> {
        const deferred = createDeferred<FontFace>();
        loads.set(this.family, deferred);
        return deferred.promise;
      }
    }
    vi.stubGlobal('FontFace', DeferredFontFace);
    const registry = fontRegistry();
    const locator: ReaderLocator = {
      href: 'Text/Section001.xhtml',
      sourcePoint: { nodePath: [9, 2], textOffset: 98 },
      progression: 0.99,
    };
    const fixture = requiredFontCandidate(
      registry,
      [requiredFace('First', 'fonts/shared.ttf', 0), requiredFace('Second', 'fonts/shared.ttf', 1)],
      { locator, pageIndex: 6, spreadIndex: 5 },
    );
    const readResource = mockFontResources(fixture, (href) =>
      fontResource(revisionHandle(fixture.snapshot), href),
    );

    const commit = commitRequiredFontCandidate(fixture);
    await flushPromises();
    expect(readResource).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(loads.size).toBe(2);
    });
    expect(registry.add).not.toHaveBeenCalled();
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('old');
    expect(fixture.state.activeSpreadIndex).toBe(0);
    expect(fixture.state.frames.has(5)).toBe(false);

    expectDefined(loads.get('Second')).resolve({} as FontFace);
    await flushPromises();
    expect(registry.add).not.toHaveBeenCalled();
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('old');
    expect(fixture.state.frames.has(5)).toBe(false);
    expectDefined(loads.get('First')).resolve({} as FontFace);
    await expect(commit).resolves.toMatchObject({ committed: true });

    expect(registry.add.mock.calls.map(([face]) => (face as DeferredFontFace).family)).toEqual([
      'First',
      'Second',
    ]);
    expect(fixture.state.revisionSessions.current).toBe(fixture.candidateOwner);
    expect(fixture.state.activeSpreadIndex).toBe(5);
    expect([...fixture.state.frames.keys()]).toEqual([5]);
    expect(fixture.state.frames.has(0)).toBe(false);
    expect(fixture.candidate.releaseRevisionAtRevision).not.toHaveBeenCalled();
  });

  it('drops required fonts when their controller-owned candidate becomes stale while loading', async () => {
    const load = createDeferred<FontFace>();
    class DeferredFontFace {
      load(): Promise<FontFace> {
        return load.promise;
      }
    }
    vi.stubGlobal('FontFace', DeferredFontFace);
    const registry = fontRegistry();
    const fixture = requiredFontCandidate(registry, [requiredFace('Book', 'fonts/book.ttf', 0)]);
    mockFontResources(fixture, (href) => fontResource(revisionHandle(fixture.snapshot), href));

    const commit = commitRequiredFontCandidate(fixture);
    await flushPromises();
    fixture.state.revisionSessions.candidate = undefined;
    load.resolve({} as FontFace);

    await expect(commit).resolves.toEqual({ committed: false });
    expect(registry.add).not.toHaveBeenCalled();
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('old');
    expect(fixture.candidate.releaseRevisionAtRevision).not.toHaveBeenCalled();
  });

  it('rolls back registered required fonts when frame decoding makes the candidate stale', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    const fixture = requiredFontCandidate(registry, [requiredFace('Book', 'fonts/book.ttf', 0)]);
    mockFontResources(fixture, (href) => fontResource(revisionHandle(fixture.snapshot), href));
    const decode = fixture.state.decodeFrameCommandBuffer;
    Object.assign(fixture.state, {
      decodeFrameCommandBuffer: vi.fn<BrowserReaderState['decodeFrameCommandBuffer']>(
        (metadata, bytes) => {
          const frame = decode(metadata, bytes);
          fixture.state.revisionSessions.candidate = undefined;
          return frame;
        },
      ),
    });

    await expect(commitRequiredFontCandidate(fixture)).resolves.toEqual({ committed: false });

    expect(registry.add).toHaveBeenCalledOnce();
    expect(registry.delete).toHaveBeenCalledWith(registry.add.mock.calls[0]?.[0]);
    expect(fixture.state.registeredFontFaces.size).toBe(0);
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('old');
    expect(fixture.candidate.releaseRevisionAtRevision).not.toHaveBeenCalled();
  });

  it('rolls back registered required fonts when candidate frame decoding fails', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    const fixture = requiredFontCandidate(registry, [requiredFace('Book', 'fonts/book.ttf', 0)]);
    mockFontResources(fixture, (href) => fontResource(revisionHandle(fixture.snapshot), href));
    Object.assign(fixture.state, {
      decodeFrameCommandBuffer: vi.fn(() => {
        throw new Error('frame decode failed');
      }),
    });

    await expect(commitRequiredFontCandidate(fixture)).rejects.toThrow('frame decode failed');

    expect(registry.add).toHaveBeenCalledOnce();
    expect(registry.delete).toHaveBeenCalledWith(registry.add.mock.calls[0]?.[0]);
    expect(fixture.state.registeredFontFaces.size).toBe(0);
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('old');
    expect(fixture.candidate.releaseRevisionAtRevision).not.toHaveBeenCalled();
  });

  it('rolls back earlier required fonts when a later FontFaceSet add fails', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = {
      add: vi.fn((face: FontFace) => {
        if (face.family === 'Second') throw new Error('registry add failed');
      }),
      delete: vi.fn((_face: FontFace) => true),
    };
    const fixture = requiredFontCandidate(registry, [
      requiredFace('First', 'fonts/first.ttf', 0),
      requiredFace('Second', 'fonts/second.ttf', 1),
    ]);
    const existing = {} as FontFace;
    fixture.state.registeredFontFaces.set('legacy', existing);
    mockFontResources(fixture, (href) => fontResource(revisionHandle(fixture.snapshot), href));

    await expect(commitRequiredFontCandidate(fixture)).rejects.toThrow('registry add failed');

    expect(registry.delete).toHaveBeenCalledOnce();
    expect((registry.delete.mock.calls[0]?.[0] as ImmediateFontFace).family).toBe('First');
    expect(fixture.state.registeredFontFaces).toEqual(new Map([['legacy', existing]]));
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('old');
    expect(fixture.candidate.releaseRevisionAtRevision).not.toHaveBeenCalled();
  });

  it('rejects same-length required font bytes with the wrong fingerprint', async () => {
    const constructFontFace = vi.fn();
    class TrackedFontFace extends ImmediateFontFace {
      constructor(family: string) {
        super(family);
        constructFontFace();
      }
    }
    vi.stubGlobal('FontFace', TrackedFontFace);
    const registry = fontRegistry();
    const fixture = requiredFontCandidate(registry, [requiredFace('Book', 'fonts/book.ttf', 0)]);
    mockFontResources(fixture, (href) => {
      const resource = fontResource(revisionHandle(fixture.snapshot), href);
      resource.value.bytes.set([4, 3, 2, 1]);
      return resource;
    });

    await expect(commitRequiredFontCandidate(fixture)).rejects.toThrow(
      'Pinned reader required font fingerprint mismatch',
    );

    expect(constructFontFace).not.toHaveBeenCalled();
    expect(registry.add).not.toHaveBeenCalled();
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('old');
    expect(fixture.candidate.releaseRevisionAtRevision).not.toHaveBeenCalled();
  });
});

function revisionSnapshot(
  revisionId: string,
  pageCount: number,
  spreadCount: number,
  spreadIndex: number,
  revisionVersion = 3,
): BrowserReaderRevisionSnapshot {
  const result = revisionResult(revisionId, pageCount, spreadCount, spreadIndex);
  const revision = { ...result.bundle.revision, revisionVersion };
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
          spreads: [{ spreadIndex, resources: [], missingResources: [] }],
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
): BrowserReaderRevisionSessionOwner {
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
  snapshot: BrowserReaderRevisionSnapshot,
  target: BrowserReaderRevisionSnapshot['target'],
): BrowserReaderRevisionSnapshot {
  const { frameWindow: _frameWindow, ...rest } = snapshot;
  return {
    ...rest,
    target,
  };
}

function mockAggregates(
  worker: BrowserReaderWorkerClient,
  snapshot: BrowserReaderRevisionSnapshot,
): void {
  const revision = revisionHandle(snapshot);
  Object.assign(worker, {
    getFootnotesAtRevision: vi.fn(() =>
      Promise.resolve({
        revision,
        value: {
          revisionId: revision.revisionId,
          complete: true,
          pendingKeys: [],
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

function revisionHandle(snapshot: BrowserReaderRevisionSnapshot) {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}

interface RequiredFontCandidateFixture {
  readonly state: BrowserReaderState;
  readonly candidate: ReturnType<typeof createWorker>;
  readonly candidateOwner: BrowserReaderRevisionSessionOwner;
  readonly snapshot: BrowserReaderRevisionSnapshot;
}

interface ResolvedLocatorTarget {
  readonly locator: ReaderLocator;
  readonly pageIndex: number;
  readonly spreadIndex: number;
}

function requiredFontCandidate(
  registry: {
    readonly add: (face: FontFace) => void;
    readonly delete: (face: FontFace) => boolean;
  },
  faces: readonly ReturnType<typeof requiredFace>[],
  target?: ResolvedLocatorTarget,
): RequiredFontCandidateFixture {
  const previous = createWorker(() => undefined, 'required-font-previous');
  const candidate = createWorker(() => undefined, 'required-font-candidate');
  const state = pinnedState(previous.worker, registry);
  setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
  const previousOwner = owner(previous.worker);
  recordBrowserReaderAcceptedRevision(previousOwner, state.revisionBundle.revision);
  const targetSpreadIndex = target?.spreadIndex ?? 0;
  const targetPageIndex = target?.pageIndex ?? targetSpreadIndex;
  const baseSnapshot = revisionSnapshot(
    'candidate',
    targetPageIndex + 1,
    targetSpreadIndex + 1,
    targetSpreadIndex,
  );
  const snapshot = withRequiredFonts(
    target
      ? withResolvedLocator(baseSnapshot, target.locator, target.pageIndex, target.spreadIndex)
      : baseSnapshot,
    faces,
  );
  const candidateOwner = owner(candidate.worker, true);
  recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
  state.revisionSessions.current = previousOwner;
  state.revisionSessions.candidate = candidateOwner;
  mockAggregates(candidate.worker, snapshot);
  return { state, candidate, candidateOwner, snapshot };
}

function commitRequiredFontCandidate(fixture: RequiredFontCandidateFixture) {
  return commitBrowserReaderRevisionSnapshot(fixture.state, {
    owner: fixture.candidateOwner,
    snapshot: fixture.snapshot,
    config: fixture.state.config,
    spreadMode: fixture.state.spreadMode,
    baseCommitGeneration: fixture.state.commitGeneration,
  });
}

function pinnedState(
  worker: BrowserReaderWorkerClient,
  registry: {
    readonly add: (face: FontFace) => void;
    readonly delete: (face: FontFace) => boolean;
  },
): BrowserReaderState {
  const state = createState(worker);
  Object.assign(state.pinnedFonts, {
    registry,
    summary: {
      schemaVersion: 1,
      policyId: '1'.repeat(64),
      faces: [{ familyAlias: '__RitoPinned_test' }],
    },
  });
  return state;
}

function withRequiredFonts(
  snapshot: BrowserReaderRevisionSnapshot,
  faces: readonly ReturnType<typeof requiredFace>[],
): BrowserReaderRevisionSnapshot {
  return {
    ...snapshot,
    presentation: {
      ...snapshot.presentation,
      requiredFontFaces: {
        schemaVersion: 1,
        revisionId: snapshot.revision.revisionId,
        faces,
      },
    },
  };
}

function withResolvedLocator(
  snapshot: BrowserReaderRevisionSnapshot,
  locator: ReaderLocator,
  pageIndex: number,
  spreadIndex: number,
): BrowserReaderRevisionSnapshot {
  return {
    ...snapshot,
    target: {
      kind: 'locator',
      locator,
      resolution: {
        status: 'resolved',
        revisionId: snapshot.revision.revisionId,
        locator,
        spineIdref: 'section-001',
        pageIndex,
        spreadIndex,
        matchedBy: 'sourcePoint',
      },
    },
  };
}

function requiredFace(family: string, href: string, sourceOrder: number) {
  return {
    family,
    href,
    style: 'normal' as const,
    weight: 400,
    shapeFingerprint: '9f64a747e1b97f13',
    byteLength: 4,
    sourceOrder,
  };
}

function mockFontResources(
  fixture: RequiredFontCandidateFixture,
  resource: (
    href: string,
  ) => Awaited<ReturnType<BrowserReaderWorkerClient['readResourceAtRevision']>>,
) {
  const readResource = vi.fn<BrowserReaderWorkerClient['readResourceAtRevision']>(
    (_revision, _kind, href) => Promise.resolve(resource(href)),
  );
  Object.assign(fixture.candidate.worker, { readResourceAtRevision: readResource });
  return readResource;
}

function fontResource(
  revision: { readonly revisionId: string; readonly revisionVersion: number },
  href: string,
): Awaited<ReturnType<BrowserReaderWorkerClient['readResourceAtRevision']>> {
  return {
    revision,
    value: {
      payload: {
        revisionId: revision.revisionId,
        transferId: `transfer-${href}`,
        kind: 'font',
        href,
        mediaType: 'font/ttf',
        byteLength: 4,
      },
      bytes: new Uint8Array([1, 2, 3, 4]),
    },
  };
}

function fontRegistry() {
  return {
    add: vi.fn((_face: FontFace) => undefined),
    delete: vi.fn((_face: FontFace) => true),
  };
}

class ImmediateFontFace {
  constructor(readonly family: string) {}
  load(): Promise<FontFace> {
    return Promise.resolve(this as unknown as FontFace);
  }
}

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}
