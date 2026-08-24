import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '../../src/reader';
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
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { preloadReaderFonts } from '../../src/bindings/browser/resources';
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

describe('Browser bounded revision commit adapter', () => {
  it('captures non-pinned initial font geometry before publishing the candidate', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    vi.stubGlobal('fonts', registry);
    const candidate = createWorker(() => undefined, 'initial-font-geometry');
    const state = createState(candidate.worker, {
      fontFaces: [],
      resources: {
        stylesheets: [],
        fonts: [{ href: 'fonts/book.ttf', byteLength: 4 }],
        images: [],
      },
    });
    state.fontMetrics.genericSerif = undefined;
    const snapshot = withFontMetricDemand(boundedSnapshot('initial', 1, 1, 0), 'Book');
    const candidateOwner = owner(candidate.worker);
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, snapshot);
    Object.assign(candidate.worker, {
      readResourceAtRevision: vi.fn<BrowserReaderWorkerClient['readResourceAtRevision']>(
        (_revision, _kind, href) => Promise.resolve(fontResource(revisionHandle(snapshot), href)),
      ),
    });
    const measureText = installVerticalMetricContext(state);

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidateOwner,
        snapshot,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: false, requiresFontGeometryReflow: true });

    expect(state.revisionBundle.revision.revisionId).toBe('');
    expect(state.registeredFontFaces.size).toBe(1);
    expect(registry.add).toHaveBeenCalledOnce();
    expect(measureText.mock.calls.length).toBeGreaterThan(1);
    expect(registry.add.mock.invocationCallOrder[0]).toBeLessThan(
      measureText.mock.invocationCallOrder[0] ?? 0,
    );
    const measurementCount = measureText.mock.calls.length;
    state.boundedSessions.current = candidateOwner;
    state.boundedSessions.candidate = undefined;
    setRevisionState(state, snapshot.revision, snapshot.navigation);
    state.revisionBundle = {
      ...state.revisionBundle,
      fontFamilies: snapshot.presentation.fontFamilies,
      fontVerticalMetricDemands: snapshot.presentation.fontVerticalMetricDemands,
    };

    await expect(preloadReaderFonts(state)).resolves.toBe(false);
    expect(measureText).toHaveBeenCalledTimes(measurementCount);
  });

  it('calibrates a pinned alias without waiting for unrelated publication fonts', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    const candidate = createWorker(() => undefined, 'pinned-font-geometry');
    const state = pinnedState(candidate.worker, registry);
    Object.assign(state.publication, {
      fontFaces: [{ family: 'Unrelated', href: 'fonts/missing.ttf' }],
    });
    const demanded = withFontMetricDemand(
      withRequiredFonts(boundedSnapshot('initial-pinned', 1, 1, 0), []),
      '__RitoPinned_test',
    );
    const candidateOwner = owner(candidate.worker);
    recordBrowserReaderAcceptedRevision(candidateOwner, demanded.revision);
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, demanded);
    const calibrated = withoutFontMetricDemands(demanded);
    candidateOwner.controller.calibrateFontVerticalMetrics = vi.fn((samples) => {
      expect(samples).toHaveLength(1);
      recordBrowserReaderAcceptedRevision(candidateOwner, calibrated.revision);
      mockAggregates(candidate.worker, calibrated);
      return Promise.resolve(calibrated);
    });
    const workerFactory = vi.fn(() => {
      throw new Error('vertical-only calibration must not create a replacement worker');
    });
    Object.assign(state, { workerFactory });
    const readResource = vi.fn<BrowserReaderWorkerClient['readResourceAtRevision']>(() =>
      Promise.reject(new Error('unrelated font missing')),
    );
    Object.assign(candidate.worker, { readResourceAtRevision: readResource });
    installVerticalMetricContext(state);

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidateOwner,
        snapshot: demanded,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: true, committedSnapshot: calibrated });

    expect(readResource).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
    expect(state.boundedSessions.current).toBe(candidateOwner);
    expect(state.revisionBundle.revision).toBe(calibrated.revision);
  });

  it('keeps calibrating the same owner until its current presentation has no demand', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    const candidate = createWorker(() => undefined, 'pinned-font-calibration-loop');
    const state = pinnedState(candidate.worker, registry);
    const initial = withFontMetricDemand(
      withRequiredFonts(boundedSnapshot('calibration-loop', 1, 1, 0), []),
      '__RitoPinned_test',
    );
    const secondDemand = withFontMetricDemand(
      withoutFontMetricDemands(initial),
      '__RitoPinned_test',
      18,
    );
    const calibrated = withoutFontMetricDemands(secondDemand);
    const candidateOwner = owner(candidate.worker);
    recordBrowserReaderAcceptedRevision(candidateOwner, initial.revision);
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, initial);
    installVerticalMetricContext(state);
    const calibrateFontVerticalMetrics = vi
      .fn<BrowserReaderBoundedSessionOwner['controller']['calibrateFontVerticalMetrics']>()
      .mockImplementationOnce(() => {
        recordBrowserReaderAcceptedRevision(candidateOwner, secondDemand.revision);
        mockAggregates(candidate.worker, secondDemand);
        return Promise.resolve(secondDemand);
      })
      .mockImplementationOnce(() => {
        recordBrowserReaderAcceptedRevision(candidateOwner, calibrated.revision);
        mockAggregates(candidate.worker, calibrated);
        return Promise.resolve(calibrated);
      });
    candidateOwner.controller.calibrateFontVerticalMetrics = calibrateFontVerticalMetrics;

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidateOwner,
        snapshot: initial,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: true, committedSnapshot: calibrated });

    expect(calibrateFontVerticalMetrics).toHaveBeenCalledTimes(2);
    expect(state.revisionBundle.fontVerticalMetricDemands).toEqual([]);
  });

  it('recalibrates the same descriptor after the known page extent grows', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    const candidate = createWorker(() => undefined, 'vertical-calibration-growth');
    const state = pinnedState(candidate.worker, registry);
    const initial = withFontMetricDemand(
      withRequiredFonts(boundedSnapshot('vertical-calibration-growth', 1, 1, 0), []),
      '__RitoPinned_test',
    );
    const grown = withFontMetricDemand(
      withRequiredFonts(boundedSnapshot('vertical-calibration-growth', 2, 2, 0, 4), []),
      '__RitoPinned_test',
    );
    const calibrated = withoutFontMetricDemands(grown);
    const candidateOwner = owner(candidate.worker);
    recordBrowserReaderAcceptedRevision(candidateOwner, initial.revision);
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, initial);
    installVerticalMetricContext(state);
    const calibrateFontVerticalMetrics = vi
      .fn<BrowserReaderBoundedSessionOwner['controller']['calibrateFontVerticalMetrics']>()
      .mockImplementationOnce(() => {
        recordBrowserReaderAcceptedRevision(candidateOwner, grown.revision);
        mockAggregates(candidate.worker, grown);
        return Promise.resolve(grown);
      })
      .mockImplementationOnce(() => {
        recordBrowserReaderAcceptedRevision(candidateOwner, calibrated.revision);
        mockAggregates(candidate.worker, calibrated);
        return Promise.resolve(calibrated);
      });
    candidateOwner.controller.calibrateFontVerticalMetrics = calibrateFontVerticalMetrics;

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidateOwner,
        snapshot: initial,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: true, committedSnapshot: calibrated });

    expect(calibrateFontVerticalMetrics).toHaveBeenCalledTimes(2);
    expect(state.revisionBundle.revision.knownExtent.pageCount).toBe(2);
  });

  it('replaces the candidate when vertical calibration repeats the same descriptor', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    const candidate = createWorker(() => undefined, 'repeated-vertical-calibration');
    const state = pinnedState(candidate.worker, registry);
    const initial = withFontMetricDemand(
      withRequiredFonts(boundedSnapshot('repeated-vertical-calibration', 1, 1, 0), []),
      '__RitoPinned_test',
    );
    const repeated = withFontMetricDemand(withoutFontMetricDemands(initial), '__RitoPinned_test');
    const candidateOwner = owner(candidate.worker);
    recordBrowserReaderAcceptedRevision(candidateOwner, initial.revision);
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, initial);
    installVerticalMetricContext(state);
    const calibrateFontVerticalMetrics = vi
      .fn<BrowserReaderBoundedSessionOwner['controller']['calibrateFontVerticalMetrics']>()
      .mockImplementation(() => {
        recordBrowserReaderAcceptedRevision(candidateOwner, repeated.revision);
        mockAggregates(candidate.worker, repeated);
        return Promise.resolve(repeated);
      });
    candidateOwner.controller.calibrateFontVerticalMetrics = calibrateFontVerticalMetrics;

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidateOwner,
        snapshot: initial,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: false, requiresFontGeometryReflow: true });

    expect(calibrateFontVerticalMetrics).toHaveBeenCalledOnce();
    expect(state.revisionBundle.revision.revisionId).toBe('');
    expect(state.boundedSessions.current).toBeUndefined();
    expect(state.boundedSessions.candidate).toBe(candidateOwner);
  });

  it('publishes when the host cannot measure optional vertical interaction geometry', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    const candidate = createWorker(() => undefined, 'unmeasurable-vertical-geometry');
    const state = pinnedState(candidate.worker, registry);
    const locator: ReaderLocator = {
      href: 'Text/Section001.xhtml',
      sourcePoint: { nodePath: [3, 1], textOffset: 17 },
      progression: 0.5,
    };
    const snapshot = withFontMetricDemand(
      withRequiredFonts(
        withResolvedLocator(
          boundedSnapshot('unmeasurable-vertical-geometry', 4, 4, 3),
          locator,
          3,
          3,
        ),
        [],
      ),
      '__RitoPinned_test',
    );
    const candidateOwner = owner(candidate.worker);
    const calibrateFontVerticalMetrics =
      vi.fn<BrowserReaderBoundedSessionOwner['controller']['calibrateFontVerticalMetrics']>();
    candidateOwner.controller.calibrateFontVerticalMetrics = calibrateFontVerticalMetrics;
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, snapshot);
    Object.assign(state.ctx, {
      save: vi.fn(),
      restore: vi.fn(),
      measureText: vi.fn(() => ({
        width: 16,
        fontBoundingBoxAscent: Number.NaN,
        fontBoundingBoxDescent: Number.NaN,
      })),
      font: '',
      textBaseline: 'alphabetic',
    });
    const workerFactory = vi.fn(() => {
      throw new Error('optional interaction geometry must not create a replacement worker');
    });
    Object.assign(state, { workerFactory });

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidateOwner,
        snapshot,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: true });

    expect(calibrateFontVerticalMetrics).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
    expect(state.boundedSessions.current).toBe(candidateOwner);
    expect(state.revisionBundle.revision).toBe(snapshot.revision);
    expect(state.activeSpreadIndex).toBe(3);
    expect([...state.frames.keys()]).toEqual([3]);
    expect(state.frames.has(0)).toBe(false);
  });

  it('does not publish a calibrated snapshot while its owner still accepts the old version', async () => {
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = fontRegistry();
    const candidate = createWorker(() => undefined, 'stale-calibration-owner');
    const state = pinnedState(candidate.worker, registry);
    const initial = withFontMetricDemand(
      withRequiredFonts(boundedSnapshot('stale-calibration', 1, 1, 0), []),
      '__RitoPinned_test',
    );
    const calibrated = withoutFontMetricDemands(initial);
    const candidateOwner = owner(candidate.worker);
    recordBrowserReaderAcceptedRevision(candidateOwner, initial.revision);
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, initial);
    installVerticalMetricContext(state);
    candidateOwner.controller.calibrateFontVerticalMetrics = vi.fn(() =>
      Promise.resolve(calibrated),
    );

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidateOwner,
        snapshot: initial,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: false });

    expect(candidateOwner.acceptedRevision?.revisionVersion).toBe(initial.revision.revisionVersion);
    expect(state.revisionBundle.revision.revisionId).toBe('');
  });

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

  it('retries a suspended frame miss after replacing its exact-read owner', async () => {
    const previous = createWorker(() => undefined, 'suspended-owner');
    const candidate = createWorker(() => undefined, 'replacement-owner');
    const state = createState(previous.worker);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    const previousOwner = owner(previous.worker);
    recordBrowserReaderAcceptedRevision(previousOwner, state.revisionBundle.revision);
    state.boundedSessions.current = previousOwner;
    state.frames.clear();
    const events: string[] = [];
    state.layoutCommittedListeners.add(() => events.push('layout'));
    state.spreadContentInvalidatedListeners.add((spreadIndex) => {
      events.push(`retry:${String(spreadIndex)}`);
    });

    const gate = suspendBrowserReaderExactReads(state);
    expect(gate?.owner).toBe(previousOwner);
    await expect(ensureFrameLoaded(state, 0)).resolves.toBeUndefined();

    const snapshot = boundedSnapshot('replacement', 2, 2, 1);
    const candidateOwner = owner(candidate.worker, true);
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    state.boundedSessions.candidate = candidateOwner;
    mockAggregates(candidate.worker, snapshot);

    await expect(
      commitBrowserReaderBoundedSnapshot(state, {
        owner: candidateOwner,
        snapshot,
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        baseCommitGeneration: state.commitGeneration,
      }),
    ).resolves.toEqual({ committed: true, retiredOwner: previousOwner });

    expect(state.boundedSessions.current).toBe(candidateOwner);
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
    expect(fixture.state.boundedSessions.current).toBe(fixture.candidateOwner);
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
    fixture.state.boundedSessions.candidate = undefined;
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
          fixture.state.boundedSessions.candidate = undefined;
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
): BrowserReaderBoundedSessionOwner {
  return {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      calibrateFontVerticalMetrics: vi.fn(),
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

function revisionHandle(snapshot: BrowserReaderBoundedSnapshot) {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}

interface RequiredFontCandidateFixture {
  readonly state: BrowserReaderState;
  readonly candidate: ReturnType<typeof createWorker>;
  readonly candidateOwner: BrowserReaderBoundedSessionOwner;
  readonly snapshot: BrowserReaderBoundedSnapshot;
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
  const baseSnapshot = boundedSnapshot(
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
  state.boundedSessions.current = previousOwner;
  state.boundedSessions.candidate = candidateOwner;
  mockAggregates(candidate.worker, snapshot);
  return { state, candidate, candidateOwner, snapshot };
}

function commitRequiredFontCandidate(fixture: RequiredFontCandidateFixture) {
  return commitBrowserReaderBoundedSnapshot(fixture.state, {
    owner: fixture.candidateOwner,
    snapshot: fixture.snapshot,
    config: fixture.state.config,
    spreadMode: fixture.state.spreadMode,
    lineBreaking: fixture.state.lineBreaking,
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
  snapshot: BrowserReaderBoundedSnapshot,
  faces: readonly ReturnType<typeof requiredFace>[],
): BrowserReaderBoundedSnapshot {
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
  snapshot: BrowserReaderBoundedSnapshot,
  locator: ReaderLocator,
  pageIndex: number,
  spreadIndex: number,
): BrowserReaderBoundedSnapshot {
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

function withFontMetricDemand(
  snapshot: BrowserReaderBoundedSnapshot,
  fontFamily: string,
  fontSizePx = 16,
): BrowserReaderBoundedSnapshot {
  return {
    ...snapshot,
    presentation: {
      ...snapshot.presentation,
      fontFamilies: [fontFamily],
      fontVerticalMetricDemands: [{ fontFamily, fontStyle: 'normal', fontWeight: 400, fontSizePx }],
    },
  };
}

function withoutFontMetricDemands(
  snapshot: BrowserReaderBoundedSnapshot,
): BrowserReaderBoundedSnapshot {
  const revision = {
    ...snapshot.revision,
    revisionVersion: snapshot.revision.revisionVersion + 1,
  };
  return {
    ...snapshot,
    generation: snapshot.generation + 1,
    revision,
    presentation: {
      ...snapshot.presentation,
      revision,
      fontVerticalMetricDemands: [],
    },
  };
}

function installVerticalMetricContext(state: BrowserReaderState) {
  const measureText = vi.fn(() => ({
    width: 16,
    fontBoundingBoxAscent: 3,
    fontBoundingBoxDescent: 14,
  }));
  Object.assign(state.ctx, {
    save: vi.fn(),
    restore: vi.fn(),
    measureText,
    font: '',
    textBaseline: 'alphabetic',
  });
  return measureText;
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
