import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cacheFrame,
  loadFrame,
  warmBrowserReaderFrameWindow,
} from '../../src/bindings/browser/reader/frame-cache';
import { closeExactRevisionReadGate } from '../../src/bindings/browser/reader/pipeline/revision-handle';
import { applyBrowserReaderRevisionState } from '../../src/bindings/browser/reader/revision';
import { prepareBrowserReaderBoundedFrameCache } from '../../src/bindings/browser/bounded-frame-cache';
import {
  preloadFrameResourceBytes,
} from '../../src/bindings/browser/resources';
import { BrowserReaderImageResourceError } from '../../src/bindings/browser/image-resource-error';
import { createBrowserReaderChapterLocalPreviewState } from '../../src/bindings/browser/chapter-local-preview/state';
import type {
  BrowserReaderFrame,
  BrowserReaderState,
} from '../../src/bindings/browser/reader/types';
import {
  createDeferred,
  createState,
  createWorker,
  frameBuffer,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader frame window adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps cached frames paintable while the exact-read gate is closed', async () => {
    const warmed: number[] = [];
    const state = frameWindowState([0], (index) => warmed.push(index));

    closeExactRevisionReadGate(state);

    expect(loadFrame(state, 0)).toBeDefined();
    await warmBrowserReaderFrameWindow(state, 0);
    expect(warmed).toEqual([]);
  });

  it('applies the runtime-provided frame window plan for spread warming', async () => {
    const warmed: number[] = [];
    const state = frameWindowState([2, 3, 1, 4, 0], (index) => warmed.push(index));
    state.frames.clear();

    void warmBrowserReaderFrameWindow(state, 2);
    await flushPromises();

    expect(warmed).toEqual([2, 3, 1, 4, 0]);
  });

  it('uses the active spread when callers request initial warming', async () => {
    const warmed: number[] = [];
    const state = frameWindowState([4, 5, 3], (index) => warmed.push(index));
    state.activeSpreadIndex = 4;
    state.frames.clear();

    void warmBrowserReaderFrameWindow(state, state.activeSpreadIndex);
    await flushPromises();

    expect(warmed).toEqual([4, 5, 3]);
  });

  it('coalesces concurrent warm requests for the same spread window', async () => {
    let resolveWindow: ((value: ReturnType<typeof versionedFrameWindowResult>) => void) | undefined;
    const warmFrameWindow = vi.fn(
      (
        _revision: { readonly revisionId: string; readonly revisionVersion: number },
        centerSpreadIndex: number,
      ) =>
        new Promise<ReturnType<typeof versionedFrameWindowResult>>((resolve) => {
          resolveWindow = resolve;
          expect(centerSpreadIndex).toBe(2);
        }),
    );
    const state = frameWindowState([2], () => undefined, {
      worker: { warmFrameWindowAtRevision: warmFrameWindow },
    });

    const first = warmBrowserReaderFrameWindow(state, 2);
    const second = warmBrowserReaderFrameWindow(state, 2);

    expect(warmFrameWindow).toHaveBeenCalledOnce();
    expect(warmFrameWindow).toHaveBeenCalledWith({ revisionId: 'rev', revisionVersion: 0 }, 2);
    resolveWindow?.(versionedFrameWindowResult([2], 2));
    await Promise.all([first, second]);
    expect(state.pendingFrameLoads.size).toBe(0);
  });

  it('skips a queued center when the active response already covered it', async () => {
    const firstWindow = createDeferred<ReturnType<typeof versionedFrameWindowResult>>();
    const warmFrameWindow = vi.fn(
      (
        _revision: { readonly revisionId: string; readonly revisionVersion: number },
        centerSpreadIndex: number,
      ) =>
        centerSpreadIndex === 2
          ? firstWindow.promise
          : Promise.resolve(versionedFrameWindowResult([3], centerSpreadIndex)),
    );
    const state = frameWindowState([0, 1, 2, 3, 4, 5, 6, 7], () => undefined, {
      worker: { warmFrameWindowAtRevision: warmFrameWindow },
    });
    state.frames.clear();

    const first = warmBrowserReaderFrameWindow(state, 2);
    const covered = warmBrowserReaderFrameWindow(state, 3);
    expect(warmFrameWindow.mock.calls.map((call) => call[1])).toEqual([2]);

    firstWindow.resolve(versionedFrameWindowResult([2, 3, 1, 4, 0], 2));
    await Promise.all([first, covered]);

    expect(warmFrameWindow.mock.calls.map((call) => call[1])).toEqual([2]);
    expect(state.pendingFrameLoads.size).toBe(0);
  });

  it('runs only the latest queued center and settles every replaced request', async () => {
    const activeWindow = createDeferred<ReturnType<typeof versionedFrameWindowResult>>();
    const latestWindow = createDeferred<ReturnType<typeof versionedFrameWindowResult>>();
    const warmFrameWindow = vi.fn(
      (
        _revision: { readonly revisionId: string; readonly revisionVersion: number },
        centerSpreadIndex: number,
      ) => (centerSpreadIndex === 1 ? activeWindow.promise : latestWindow.promise),
    );
    const state = frameWindowState([0, 1, 2, 3, 4, 5], () => undefined, {
      worker: { warmFrameWindowAtRevision: warmFrameWindow },
    });
    state.frames.clear();

    const active = warmBrowserReaderFrameWindow(state, 1);
    const replacedTwo = warmBrowserReaderFrameWindow(state, 2);
    const replacedThree = warmBrowserReaderFrameWindow(state, 3);
    const latestFirst = warmBrowserReaderFrameWindow(state, 5);
    const latestSecond = warmBrowserReaderFrameWindow(state, 5);

    expect(warmFrameWindow.mock.calls.map((call) => call[1])).toEqual([1]);
    expect(state.pendingFrameLoads.size).toBe(2);
    await Promise.all([replacedTwo, replacedThree]);

    activeWindow.resolve(versionedFrameWindowResult([1], 1));
    await active;
    await flushPromises();

    expect(warmFrameWindow.mock.calls.map((call) => call[1])).toEqual([1, 5]);
    expect(state.pendingFrameLoads.size).toBe(1);
    latestWindow.resolve(versionedFrameWindowResult([5], 5));
    await Promise.all([latestFirst, latestSecond]);
    expect(state.pendingFrameLoads.size).toBe(0);
  });

  it('reuses a completed warm window for the same revision and center', async () => {
    const warmFrameWindow = vi.fn(
      (revision: { readonly revisionId: string; readonly revisionVersion: number }) =>
        Promise.resolve({ revision, value: frameWindowResult([0, 1], 0) }),
    );
    const state = frameWindowState([0, 1], () => undefined, {
      worker: { warmFrameWindowAtRevision: warmFrameWindow },
    });

    await warmBrowserReaderFrameWindow(state, 0);
    await warmBrowserReaderFrameWindow(state, 0);

    expect(warmFrameWindow).toHaveBeenCalledOnce();
  });

  it('keeps stable-prefix frame identities across a same-session revision advance', async () => {
    const fixture = createWorker(() => undefined, 'stable-prefix-session');
    const state = createState(fixture.worker);
    const initial = withRevisionVersion(revisionResult('rev', 3, 3), 0);
    setRevisionState(state, initial.bundle.revision, initial.bundle.navigation);
    const selectedFrame = frame([], []);
    cacheFrame(state, 0, selectedFrame);
    await warmBrowserReaderFrameWindow(state, 1);
    const adjacentFrame = state.frames.get(1);
    expect(adjacentFrame).toBeDefined();
    fixture.warmFrameWindow.mockClear();

    const oldPending = new Promise<void>(() => undefined);
    state.pendingFrameLoads.set(2, oldPending);
    const advanced = withRevisionVersion(revisionResult('rev', 4, 4), 4);
    const frameCache = prepareBrowserReaderBoundedFrameCache(state, fixture.worker, advanced, {
      ...selectedFrame,
      commandHash: 'replacement',
    });
    applyBrowserReaderRevisionState(state, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      result: advanced,
      worker: fixture.worker,
      ...frameCache,
    });

    expect(state.frames.get(0)).toBe(selectedFrame);
    expect(state.frames.get(1)).toBe(adjacentFrame);
    expect(state.pendingFrameLoads.has(2)).toBe(false);

    const completedWarm = warmBrowserReaderFrameWindow(state, 1);
    expect(fixture.warmFrameWindow).toHaveBeenNthCalledWith(
      1,
      { revisionId: 'rev', revisionVersion: 4 },
      1,
    );
    await completedWarm;

    const pendingWarm = warmBrowserReaderFrameWindow(state, 2);
    expect(fixture.warmFrameWindow).toHaveBeenNthCalledWith(
      2,
      { revisionId: 'rev', revisionVersion: 4 },
      2,
    );
    await pendingWarm;
  });

  it('clears cached frames when a new worker session publishes the same revision id', () => {
    const previous = createWorker(() => undefined, 'previous-session');
    const candidate = createWorker(() => undefined, 'candidate-session');
    const state = createState(previous.worker);
    const initial = withRevisionVersion(revisionResult('rev', 1, 1), 0);
    setRevisionState(state, initial.bundle.revision, initial.bundle.navigation);
    const previousFrame = frame([], []);
    cacheFrame(state, 0, previousFrame);

    applyBrowserReaderRevisionState(state, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      result: withRevisionVersion(revisionResult('rev', 1, 1), 1),
      worker: candidate.worker,
    });

    expect(state.frames.get(0)).not.toBe(previousFrame);
    expect(state.frames.get(0)?.revisionId).toBe('rev');
  });

  it('clears cached frames when the same worker publishes a different revision id', () => {
    const fixture = createWorker(() => undefined, 'same-session');
    const state = createState(fixture.worker);
    const initial = withRevisionVersion(revisionResult('old', 1, 1), 0);
    setRevisionState(state, initial.bundle.revision, initial.bundle.navigation);
    const previousFrame = { ...frame([], []), revisionId: 'old' };
    cacheFrame(state, 0, previousFrame);

    applyBrowserReaderRevisionState(state, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      result: withRevisionVersion(revisionResult('next', 1, 1), 1),
      worker: fixture.worker,
    });

    expect(state.frames.get(0)).not.toBe(previousFrame);
    expect(state.frames.get(0)?.revisionId).toBe('next');
  });

  it('rejects a stale frame window when two worker sessions use the same revision id', async () => {
    const staleWindow = createDeferred<ReturnType<typeof versionedFrameWindowResult>>();
    const currentWindow = createDeferred<ReturnType<typeof versionedFrameWindowResult>>();
    const invalidated: number[] = [];
    const state = frameWindowState([0], (index) => invalidated.push(index), {
      worker: {
        sessionId: 'session-a',
        warmFrameWindowAtRevision: () => staleWindow.promise,
      },
    });
    state.frames.clear();
    state.revisionBundle = {
      ...state.revisionBundle,
      revision: { ...state.revisionBundle.revision, revisionId: 'rev-1' },
    };
    state.revisionHandle = {
      workerSessionId: 'session-a',
      revisionId: 'rev-1',
      revisionVersion: 0,
      publicationGeneration: 1,
      commitGeneration: 1,
    };

    const staleWarm = warmBrowserReaderFrameWindow(state, 0);
    state.worker = {
      sessionId: 'session-b',
      warmFrameWindowAtRevision: () => currentWindow.promise,
    } as unknown as BrowserReaderState['worker'];
    state.revisionHandle = {
      workerSessionId: 'session-b',
      revisionId: 'rev-1',
      revisionVersion: 0,
      publicationGeneration: 2,
      commitGeneration: 2,
    };
    state.commitGeneration = 2;
    state.pendingFrameLoads.clear();
    const currentWarm = warmBrowserReaderFrameWindow(state, 0);

    staleWindow.resolve(versionedFrameWindowResult([0], 0, 'stale-frame', 'rev-1'));
    await staleWarm;
    expect(state.frames.has(0)).toBe(false);

    currentWindow.resolve(versionedFrameWindowResult([0], 0, 'current-frame', 'rev-1'));
    await currentWarm;
    expect(state.frames.get(0)?.commandHash).toBe('current-frame');
    expect(invalidated).toEqual([0]);
  });

  it('rejects a stale frame window after the same session advances its revision version', async () => {
    const oldWindow = createDeferred<ReturnType<typeof versionedFrameWindowResult>>();
    const currentWindow = createDeferred<ReturnType<typeof versionedFrameWindowResult>>();
    const invalidated: number[] = [];
    const state = frameWindowState([0], (index) => invalidated.push(index), {
      worker: {
        warmFrameWindowAtRevision: (revision: { readonly revisionVersion: number }) =>
          revision.revisionVersion === 0 ? oldWindow.promise : currentWindow.promise,
      },
    });
    state.frames.clear();

    const staleWarm = warmBrowserReaderFrameWindow(state, 0);
    state.revisionBundle = {
      ...state.revisionBundle,
      revision: { ...state.revisionBundle.revision, revisionVersion: 1 },
    };
    state.revisionHandle = {
      workerSessionId: state.worker.sessionId,
      revisionId: 'rev',
      revisionVersion: 1,
      publicationGeneration: 2,
      commitGeneration: 2,
    };
    state.commitGeneration = 2;
    state.pendingFrameLoads.clear();
    const currentWarm = warmBrowserReaderFrameWindow(state, 0);

    oldWindow.resolve(versionedFrameWindowResult([0], 0, 'stale-version', 'rev', 0));
    await staleWarm;
    expect(state.frames.has(0)).toBe(false);

    currentWindow.resolve(versionedFrameWindowResult([0], 0, 'current-version', 'rev', 1));
    await currentWarm;
    expect(state.frames.get(0)?.commandHash).toBe('current-version');
    expect(invalidated).toEqual([0]);
  });

  it('does not invalidate cached frames for empty or already decoded resources', async () => {
    const invalidated: number[] = [];
    const state = frameWindowState([1], (index) => invalidated.push(index), {
      images: new Map([['cover.png', { close: vi.fn() } as unknown as ImageBitmap]]),
      worker: {
        warmFrameWindowAtRevision: (revision: {
          readonly revisionId: string;
          readonly revisionVersion: number;
        }) =>
          Promise.resolve({
            revision,
            value: {
              ...frameWindowResult([1], 1),
              spreads: [
                { spreadIndex: 0, resources: [] },
                {
                  spreadIndex: 1,
                  resources: [
                    {
                      payload: {
                        revisionId: 'rev',
                        transferId: 'transfer-cached',
                        kind: 'image' as const,
                        href: 'cover.png',
                        mediaType: 'image/png',
                        byteLength: 4,
                      },
                      bytes: new Uint8Array([1, 2, 3, 4]),
                    },
                  ],
                },
              ],
            },
          }),
      },
    });

    await warmBrowserReaderFrameWindow(state, 1);

    expect(invalidated).toEqual([]);
  });

  it('bounds the frame cache at twelve entries and refreshes recency on access', () => {
    const state = frameWindowState([0], () => undefined);
    state.frames.clear();
    for (let spreadIndex = 0; spreadIndex < 12; spreadIndex += 1) {
      cacheFrame(state, spreadIndex, { ...frame([], []), spreadIndex });
    }

    expect(loadFrame(state, 0)?.spreadIndex).toBe(0);
    cacheFrame(state, 12, { ...frame([], []), spreadIndex: 12 });

    expect(state.frames.size).toBe(12);
    expect([...state.frames.keys()]).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 12]);
    expect(state.frames.has(0)).toBe(true);
    expect(state.frames.has(1)).toBe(false);
  });

  it('invalidates completed coverage only for the spread evicted by the frame LRU', async () => {
    const warmFrameWindow = vi.fn(
      (
        revision: { readonly revisionId: string; readonly revisionVersion: number },
        center: number,
      ) => Promise.resolve({ revision, value: frameWindowResult([0, 1], center) }),
    );
    const state = frameWindowState([0, 1], () => undefined, {
      worker: { warmFrameWindowAtRevision: warmFrameWindow },
    });
    state.frames.clear();

    await warmBrowserReaderFrameWindow(state, 0);
    for (let spreadIndex = 2; spreadIndex <= 12; spreadIndex += 1) {
      cacheFrame(state, spreadIndex, { ...frame([], []), spreadIndex });
    }
    expect(state.frames.has(0)).toBe(false);
    expect(state.frames.has(1)).toBe(true);

    await warmBrowserReaderFrameWindow(state, 1);
    expect(warmFrameWindow).toHaveBeenCalledOnce();

    await warmBrowserReaderFrameWindow(state, 0);
    expect(warmFrameWindow).toHaveBeenCalledTimes(2);
  });

  it('decodes worker-provided warm resource bytes without per-spread resource requests', async () => {
    const image = { close: vi.fn() } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(() => Promise.resolve(image));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const invalidated: number[] = [];
    const state = frameWindowState([1], (index) => invalidated.push(index), {
      worker: {
        warmFrameWindowAtRevision: (
          revision: {
            readonly revisionId: string;
            readonly revisionVersion: number;
          },
          centerSpreadIndex: number,
        ) =>
          Promise.resolve({
            revision,
            value: {
              plan: {
                revisionId: 'rev',
                centerSpreadIndex,
                displaySpreadIndex: centerSpreadIndex,
                spreadIndexes: [1],
              },
              frames: [frameBuffer('rev', 1)],
              spreads: [
                {
                  spreadIndex: 1,
                  resources: [
                    {
                      payload: {
                        revisionId: 'rev',
                        transferId: 'transfer-1',
                        kind: 'image',
                        href: 'cover.png',
                        mediaType: 'image/png',
                        byteLength: 4,
                      },
                      bytes: new Uint8Array([1, 2, 3, 4]),
                    },
                  ],
                },
              ],
            },
          }),
      },
    });

    void warmBrowserReaderFrameWindow(state, 1);
    await flushPromises();
    await flushPromises();

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(state.images.get('cover.png')).toBe(image);
    expect(state.frames.has(1)).toBe(true);
    expect(invalidated).toEqual([1]);
  });

  it('publishes a decode failure once and never warms that exact revision again', async () => {
    const createImageBitmap = vi.fn(() => Promise.reject(new Error('bad image')));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const invalidated: number[] = [];
    const warmFrameWindow = vi.fn(
      (revision: { readonly revisionId: string; readonly revisionVersion: number }) =>
        Promise.resolve({
          revision,
          value: imageFrameWindowResult(1, {
            resources: [imageResource('rev', 'transfer-decode', 'cover.png')],
            missingResources: [],
          }),
        }),
    );
    const state = frameWindowState([1], (index) => invalidated.push(index), {
      worker: { warmFrameWindowAtRevision: warmFrameWindow },
    });
    state.frames.set(1, { ...frame([], ['cover.png']), spreadIndex: 1 });

    await warmBrowserReaderFrameWindow(state, 1);
    await flushPromises();
    await warmBrowserReaderFrameWindow(state, 1);

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(warmFrameWindow).toHaveBeenCalledOnce();
    expect(invalidated).toEqual([1]);
    expect(state.imageResourceFailures.get('cover.png')?.error).toEqual(
      expect.objectContaining<Partial<BrowserReaderImageResourceError>>({
        name: 'BrowserReaderImageResourceError',
        code: 'image-resource-unavailable',
        reason: 'decode-failed',
        href: 'cover.png',
        revisionId: 'rev',
        revisionVersion: 0,
      }),
    );
  });

  it('turns Core missing resources into an exact-revision terminal error', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    const invalidated: number[] = [];
    const warmFrameWindow = vi.fn(
      (revision: { readonly revisionId: string; readonly revisionVersion: number }) =>
        Promise.resolve({
          revision,
          value: imageFrameWindowResult(1, {
            resources: [],
            missingResources: [
              { kind: 'image' as const, href: 'cover.png', message: 'resource is absent' },
            ],
          }),
        }),
    );
    const state = frameWindowState([1], (index) => invalidated.push(index), {
      worker: { warmFrameWindowAtRevision: warmFrameWindow },
    });
    state.frames.set(1, { ...frame([], ['cover.png']), spreadIndex: 1 });

    await warmBrowserReaderFrameWindow(state, 1);
    await flushPromises();
    await warmBrowserReaderFrameWindow(state, 1);

    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    expect(warmFrameWindow).toHaveBeenCalledOnce();
    expect(invalidated).toEqual([1]);
    expect(state.imageResourceFailures.get('cover.png')?.error).toEqual(
      expect.objectContaining<Partial<BrowserReaderImageResourceError>>({
        reason: 'resource-unavailable',
        detail: 'resource is absent',
      }),
    );
  });

  it('fails terminally when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const invalidated: number[] = [];
    const warmFrameWindow = vi.fn(
      (revision: { readonly revisionId: string; readonly revisionVersion: number }) =>
        Promise.resolve({
          revision,
          value: imageFrameWindowResult(1, {
            resources: [imageResource('rev', 'transfer-unsupported', 'cover.png')],
            missingResources: [],
          }),
        }),
    );
    const state = frameWindowState([1], (index) => invalidated.push(index), {
      worker: { warmFrameWindowAtRevision: warmFrameWindow },
    });
    state.frames.set(1, { ...frame([], ['cover.png']), spreadIndex: 1 });

    await warmBrowserReaderFrameWindow(state, 1);
    await flushPromises();

    expect(invalidated).toEqual([1]);
    expect(state.imageResourceFailures.get('cover.png')?.error).toEqual(
      expect.objectContaining<Partial<BrowserReaderImageResourceError>>({
        reason: 'unsupported-runtime',
      }),
    );
  });

  it('decodes a shared href once and invalidates every related spread once', async () => {
    const decoded = createDeferred<ImageBitmap>();
    const createImageBitmap = vi.fn(() => decoded.promise);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const invalidated: number[] = [];
    const state = frameWindowState([1, 2], (index) => invalidated.push(index), {
      worker: {
        warmFrameWindowAtRevision: (revision: {
          readonly revisionId: string;
          readonly revisionVersion: number;
        }) =>
          Promise.resolve({
            revision,
            value: {
              plan: {
                revisionId: 'rev',
                centerSpreadIndex: 1,
                displaySpreadIndex: 1,
                spreadIndexes: [1, 2],
              },
              frames: [frameBuffer('rev', 1), frameBuffer('rev', 2)],
              spreads: [1, 2].map((spreadIndex) => ({
                spreadIndex,
                resources: [imageResource('rev', `transfer-${String(spreadIndex)}`, 'shared.png')],
                missingResources: [],
              })),
            },
          }),
      },
    });
    state.frames.set(1, { ...frame([], ['shared.png']), spreadIndex: 1 });
    state.frames.set(2, { ...frame([], ['shared.png']), spreadIndex: 2 });

    const warm = warmBrowserReaderFrameWindow(state, 1);
    await flushPromises();
    expect(createImageBitmap).toHaveBeenCalledOnce();
    decoded.resolve({ close: vi.fn() } as unknown as ImageBitmap);
    await warm;
    await flushPromises();

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(invalidated.sort()).toEqual([1, 2]);
  });

  it('invalidates every related spread when a shared href fails terminally', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    const invalidated: number[] = [];
    const state = frameWindowState([1, 2], (index) => invalidated.push(index), {
      worker: {
        warmFrameWindowAtRevision: (revision: {
          readonly revisionId: string;
          readonly revisionVersion: number;
        }) =>
          Promise.resolve({
            revision,
            value: {
              plan: {
                revisionId: 'rev',
                centerSpreadIndex: 1,
                displaySpreadIndex: 1,
                spreadIndexes: [1, 2],
              },
              frames: [frameBuffer('rev', 1), frameBuffer('rev', 2)],
              spreads: [1, 2].map((spreadIndex) => ({
                spreadIndex,
                resources: [],
                missingResources: [
                  { kind: 'image' as const, href: 'shared.png', message: 'resource is absent' },
                ],
              })),
            },
          }),
      },
    });
    state.frames.set(1, { ...frame([], ['shared.png']), spreadIndex: 1 });
    state.frames.set(2, { ...frame([], ['shared.png']), spreadIndex: 2 });

    await warmBrowserReaderFrameWindow(state, 1);

    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    expect(invalidated.sort()).toEqual([1, 2]);
  });

  it('uses worker-provided initial frame resource bytes without requesting them again', async () => {
    const image = { close: vi.fn() } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(() => Promise.resolve(image));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const readResource = vi.fn();
    const state = {
      images: new Map(),
      pendingImageLoads: new Map(),
      imageResourceFailures: new Map(),
      settledImageResourceSpreads: new Set(),
      pendingHostTasks: new Set(),
      disposed: false,
    } as unknown as BrowserReaderState;

    await preloadFrameResourceBytes(state, [
      {
        payload: {
          revisionId: 'rev',
          transferId: 'transfer-1',
          kind: 'image',
          href: 'cover.jpg',
          mediaType: 'image/png',
          byteLength: 4,
        },
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ]);

    expect(readResource).not.toHaveBeenCalled();
    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(state.images.get('cover.jpg')).toBe(image);
  });

  it('skips blocking image warmup when the runtime does not mark a frame image-dominated', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    const state = {
      images: new Map(),
      pendingImageLoads: new Map(),
      imageResourceFailures: new Map(),
      settledImageResourceSpreads: new Set(),
      pendingHostTasks: new Set(),
      disposed: false,
    } as unknown as BrowserReaderState;

    if (frame(['paintImage', 'paintText'], ['cover.jpg']).imageDominated) {
      await preloadFrameResourceBytes(state, []);
    }

    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });
});

function frameWindowState(
  spreadIndexes: readonly number[],
  onInvalidated: (index: number) => void,
  overrides: object = {},
): BrowserReaderState {
  const spreadCount = Math.max(...spreadIndexes) + 1;
  const overrideWorker = (overrides as { readonly worker?: object }).worker;
  const worker = {
    sessionId: 'frame-window-session',
    warmFrameWindowAtRevision: (
      revision: {
        readonly revisionId: string;
        readonly revisionVersion: number;
      },
      centerSpreadIndex: number,
    ) =>
      Promise.resolve({
        revision,
        value: {
          plan: {
            revisionId: 'rev',
            centerSpreadIndex,
            displaySpreadIndex: centerSpreadIndex,
            spreadIndexes,
          },
          frames: spreadIndexes.map((spreadIndex) => frameBuffer('rev', spreadIndex)),
          spreads: spreadIndexes.map((spreadIndex) => ({ spreadIndex, resources: [] })),
        },
      }),
    ...overrideWorker,
  };
  return {
    revisionBundle: {
      revision: {
        revisionId: 'rev',
        revisionVersion: 0,
        layoutKey: 'layout',
        status: 'complete',
        knownExtent: { pageCount: spreadCount, spreadCount },
        finalExtent: { pageCount: spreadCount, spreadCount },
        pageCount: spreadCount,
        spreadCount,
      },
      navigation: {
        revisionId: 'rev',
        pageCount: spreadCount,
        spreadCount,
        spreads: [],
        chapters: [],
        chapterMap: {},
      },
      tocTargets: { revisionId: 'rev', targets: [] },
      footnotes: { revisionId: 'rev', complete: true, pendingKeys: [], entries: {} },
      chapterTextIndices: { revisionId: 'rev', entries: {} },
      fontFamilies: [],
    },
    revisionHandle: {
      workerSessionId: worker.sessionId,
      revisionId: 'rev',
      revisionVersion: 0,
      commitGeneration: 1,
    },
    commitGeneration: 1,
    boundedSessions: { current: undefined, candidate: undefined },
    chapterLocalPreview: createBrowserReaderChapterLocalPreviewState(),
    disposeTask: undefined,
    pendingHostTasks: new Set(),
    decodeFrameCommandBuffer: vi.fn(() => ({ commands: [] })),
    activeSpreadIndex: 0,
    registeredFontFaces: new Map(),
    publication: {
      fontFaces: [],
      resources: { fonts: [], images: [], stylesheets: [] },
    },
    pendingFrameLoads: new Map(),
    frames: new Map(
      Array.from({ length: spreadCount }, (_, index) => [index, frame([], [])] as const),
    ),
    spreadContentInvalidatedListeners: new Set([onInvalidated]),
    disposed: false,
    images: new Map(),
    pendingImageLoads: new Map(),
    imageResourceFailures: new Map(),
    settledImageResourceSpreads: new Set(),
    ...overrides,
    worker,
  } as unknown as BrowserReaderState;
}

function frameWindowResult(
  spreadIndexes: readonly number[],
  centerSpreadIndex: number,
  commandHash = 'frame',
  revisionId = 'rev',
) {
  return {
    plan: {
      revisionId,
      centerSpreadIndex,
      displaySpreadIndex: centerSpreadIndex,
      spreadIndexes,
    },
    frames: spreadIndexes.map((spreadIndex) => {
      const buffer = frameBuffer(revisionId, spreadIndex);
      return { ...buffer, metadata: { ...buffer.metadata, commandHash } };
    }),
    spreads: spreadIndexes.map((spreadIndex) => ({ spreadIndex, resources: [] })),
  };
}

function versionedFrameWindowResult(
  spreadIndexes: readonly number[],
  centerSpreadIndex: number,
  commandHash = 'frame',
  revisionId = 'rev',
  revisionVersion = 0,
) {
  return {
    revision: { revisionId, revisionVersion },
    value: frameWindowResult(spreadIndexes, centerSpreadIndex, commandHash, revisionId),
  };
}

function imageFrameWindowResult(
  spreadIndex: number,
  resourceResult: {
    readonly resources: readonly ReturnType<typeof imageResource>[];
    readonly missingResources: readonly {
      readonly kind: 'image';
      readonly href: string;
      readonly message: string;
    }[];
  },
) {
  return {
    plan: {
      revisionId: 'rev',
      centerSpreadIndex: spreadIndex,
      displaySpreadIndex: spreadIndex,
      spreadIndexes: [spreadIndex],
    },
    frames: [frameBuffer('rev', spreadIndex)],
    spreads: [{ spreadIndex, ...resourceResult }],
  };
}

function imageResource(revisionId: string, transferId: string, href: string) {
  return {
    payload: {
      revisionId,
      transferId,
      kind: 'image' as const,
      href,
      mediaType: 'image/png',
      byteLength: 4,
    },
    bytes: new Uint8Array([1, 2, 3, 4]),
  };
}

function withRevisionVersion(
  result: ReturnType<typeof revisionResult>,
  revisionVersion: number,
): ReturnType<typeof revisionResult> {
  return {
    ...result,
    bundle: {
      ...result.bundle,
      revision: { ...result.bundle.revision, revisionVersion },
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function frame(
  commandKinds: readonly ('paintImage' | 'paintRuby' | 'paintText')[],
  imageRefs: readonly string[],
): BrowserReaderFrame {
  return {
    revisionId: 'rev',
    spreadIndex: 0,
    width: 800,
    height: 600,
    commandHash: 'hash',
    commands: commandKinds.map(frameCommand),
    resourceRefs: { images: imageRefs },
    fontFamilies: [],
    imageDominated:
      imageRefs.length > 0 &&
      !commandKinds.some((kind) => kind === 'paintText' || kind === 'paintRuby'),
  };
}

function frameCommand(
  kind: 'paintImage' | 'paintRuby' | 'paintText',
): BrowserReaderFrame['commands'][number] {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  if (kind === 'paintImage') return { kind, src: 'cover.jpg', rect };
  const paint = {
    color: '#000',
    font: { style: 'normal' as const, weight: 400, sizePx: 16, family: 'serif' },
  };
  if (kind === 'paintRuby') return { kind, text: 'ruby', rect, paint };
  return {
    kind,
    text: 'text',
    rect,
    paint,
  };
}
