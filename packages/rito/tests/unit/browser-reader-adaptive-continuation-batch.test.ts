import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderLocator } from '../../src/reader';
import {
  activateBrowserReaderContinuationBatchTarget,
  beginBrowserReaderContinuationBatchIntent,
  bindBrowserReaderContinuationBatchIntent,
  notifyBrowserReaderChapterLocalFrameComposited,
  notifyBrowserReaderChapterLocalTransitionSettled,
  resetBrowserReaderContinuationBatchIntent,
  retireBrowserReaderContinuationBatchOwner,
} from '../../src/bindings/browser/adaptive-continuation-batch';
import { createBrowserReaderBoundedSessionOwner } from '../../src/bindings/browser/bounded-session-owner';
import {
  ensureBrowserReaderBoundedLocator,
  ensureBrowserReaderBoundedSpread,
  startBrowserReaderBoundedCandidate,
} from '../../src/bindings/browser/bounded-session-runtime';
import { installBrowserReaderChapterLocalPresentation } from '../../src/bindings/browser/chapter-local-preview/presentation';
import type {
  BrowserReaderChapterLocalOwner,
  BrowserReaderChapterLocalPreviewRequest,
  BrowserReaderChapterLocalTransport,
} from '../../src/bindings/browser/chapter-local-preview/types';
import type {
  BrowserReaderBoundedSession,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { recordBrowserReaderAcceptedRevision } from '../../src/bindings/browser/reader-session-host';
import { spreadSnapshot, waitForCalls } from './browser-reader-bounded-locator-fixtures';
import { createState, setRevisionState } from './browser-reader-reflow-state-fixtures';
import { createDeferred, createWorker } from './browser-reader-reflow-fixtures';

type CreateBoundedSession =
  (typeof import('../../src/bindings/browser/core-contracts'))['createRitoCoreWasmBoundedReaderSession'];

const mocks = vi.hoisted(() => ({
  createBoundedSession: vi.fn<CreateBoundedSession>(),
}));

vi.mock('../../src/bindings/browser/core-contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/bindings/browser/core-contracts')>();
  return {
    ...actual,
    createRitoCoreWasmBoundedReaderSession: mocks.createBoundedSession,
  };
});

const PRESENTATION = Symbol.for('@ritojs/core/browser/chapter-local-preview-presentation');

describe('Browser adaptive continuation batching', () => {
  beforeEach(() => {
    mocks.createBoundedSession.mockReset();
    mocks.createBoundedSession.mockReturnValue(controller());
  });

  it('advances 1 -> 4 -> 16 only for the active target after display composite and settle', () => {
    const fixture = createAdaptiveFixture('adaptive-lifecycle');
    const intent = beginBrowserReaderContinuationBatchIntent(fixture.state);
    if (!intent) throw new Error('Adaptive fixture did not accept its locator intent');
    const request = installActivePreview(fixture.state, intent);
    const lease = presentationLease(fixture.state, request.locator);
    const resolve = continuationResolver();

    expect(resolve()).toBe(1);
    expect(activateBrowserReaderContinuationBatchTarget(fixture.state, request)).toBe(true);
    expect(lease.render(context())).toBe(true);
    expect(resolve()).toBe(1);
    expect(lease.composited()).toBe(true);
    expect(resolve()).toBe(4);
    expect(lease.transitionSettled()).toBe(true);
    expect(resolve()).toBe(16);

    expect(resetBrowserReaderContinuationBatchIntent(fixture.state, intent)).toBe(true);
    expect(resolve()).toBe(1);
    expect(notifyBrowserReaderChapterLocalFrameComposited(fixture.state, request)).toBe(false);
    expect(notifyBrowserReaderChapterLocalTransitionSettled(fixture.state, request)).toBe(false);
    expect(resolve()).toBe(1);
  });

  it('records an early visible preview without accelerating an older queued mutation', () => {
    const fixture = createAdaptiveFixture('adaptive-queued-target');
    const intent = beginBrowserReaderContinuationBatchIntent(fixture.state);
    if (!intent) throw new Error('Adaptive fixture did not accept its locator intent');
    const request = installActivePreview(fixture.state, intent);
    const lease = presentationLease(fixture.state, request.locator);
    const resolve = continuationResolver();

    expect(lease.render(context())).toBe(true);
    expect(lease.composited()).toBe(true);
    expect(lease.transitionSettled()).toBe(true);
    expect(resolve()).toBe(1);

    expect(activateBrowserReaderContinuationBatchTarget(fixture.state, request)).toBe(true);
    expect(resolve()).toBe(16);
  });

  it('does not advance when finish precedes paint or callbacks are stale', () => {
    const fixture = createAdaptiveFixture('adaptive-stale');
    const intent = beginBrowserReaderContinuationBatchIntent(fixture.state);
    if (!intent) throw new Error('Adaptive fixture did not accept its locator intent');
    const request = installActivePreview(fixture.state, intent);
    const lease = presentationLease(fixture.state, request.locator);
    const resolve = continuationResolver();

    expect(activateBrowserReaderContinuationBatchTarget(fixture.state, request)).toBe(true);
    expect(lease.transitionSettled()).toBe(true);
    expect(resolve()).toBe(1);
    expect(lease.finish()).toBe(true);
    expect(resolve()).toBe(1);

    const nextIntent = beginBrowserReaderContinuationBatchIntent(fixture.state);
    if (!nextIntent) throw new Error('Adaptive fixture did not accept its next intent');
    const staleRequest = installActivePreview(fixture.state, nextIntent, 2);
    const staleLease = presentationLease(fixture.state, staleRequest.locator);
    fixture.state.chapterLocalPreview.latestRequestId += 1;

    expect(staleLease.render(context())).toBe(true);
    expect(staleLease.composited()).toBe(true);
    expect(staleLease.transitionSettled()).toBe(true);
    expect(resolve()).toBe(1);

    const replacementWorker = createWorker(() => undefined, 'adaptive-replacement').worker;
    const replacementOwner = createBrowserReaderBoundedSessionOwner(replacementWorker);
    fixture.state.worker = replacementWorker;
    fixture.state.boundedSessions.current = replacementOwner;
    expect(continuationResolver()()).toBe(1);
    expect(notifyBrowserReaderChapterLocalFrameComposited(fixture.state, staleRequest)).toBe(false);

    retireBrowserReaderContinuationBatchOwner(fixture.owner);
    expect(staleLease.render(context())).toBe(true);
    expect(resolve()).toBe(1);
  });

  it('promotes an initial locator candidate that intentionally has no local preview', async () => {
    const failure = new Error('stop after observing initial target quanta');
    let quantaAtTarget: number | undefined;
    mocks.createBoundedSession.mockImplementation((_worker, options) => {
      const resolve = requiredResolver(options?.continuationBatchQuanta);
      return controller({
        start: vi.fn(() => {
          quantaAtTarget = resolve();
          return Promise.reject(failure);
        }),
      });
    });
    const worker = createWorker(() => undefined, 'adaptive-initial-locator').worker;
    const state = createState(worker);
    const owner = createBrowserReaderBoundedSessionOwner(worker);

    await expect(
      startBrowserReaderBoundedCandidate(state, owner, {
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        targetSpreadIndex: 0,
        preserveLocator: { href: 'initial.xhtml', anchorId: 'resume' },
      }),
    ).rejects.toBe(failure);

    expect(quantaAtTarget).toBe(16);
    expect(state.chapterLocalPreview.active).toBeUndefined();
  });

  it('promotes an ordinary exact-only spread target after its queued intent becomes active', async () => {
    const initial = spreadSnapshot('adaptive-spread', 0);
    const failure = new Error('stop after observing spread target quanta');
    const pending = createDeferred<ReturnType<typeof spreadSnapshot>>();
    let quantaAtTarget: number | undefined;
    let resolve = (): number => 1;
    const ensureSpread = vi.fn(() => {
      quantaAtTarget = resolve();
      return pending.promise;
    });
    mocks.createBoundedSession.mockImplementation((_worker, options) => {
      resolve = requiredResolver(options?.continuationBatchQuanta);
      return controller({
        currentSnapshot: vi.fn(() => initial),
        ensureSpread,
      });
    });
    const fixture = installCurrentAdaptiveOwner('adaptive-spread', initial);

    const task = ensureBrowserReaderBoundedSpread(fixture.state, 1);
    await waitForCalls(ensureSpread, 1);
    expect(quantaAtTarget).toBe(16);
    const nextIntent = beginBrowserReaderContinuationBatchIntent(fixture.state);
    expect(nextIntent).toBeDefined();
    expect(resolve()).toBe(1);
    pending.reject(failure);
    await expect(task).rejects.toBe(failure);
  });

  it('promotes a locator in an already-known chapter when no preview can be created', async () => {
    const initial = spreadSnapshot('adaptive-known-chapter', 0);
    const failure = new Error('stop after observing known-chapter target quanta');
    let quantaAtTarget: number | undefined;
    mocks.createBoundedSession.mockImplementation((_worker, options) => {
      const resolve = requiredResolver(options?.continuationBatchQuanta);
      return controller({
        currentSnapshot: vi.fn(() => initial),
        ensureLocator: vi.fn(() => {
          quantaAtTarget = resolve();
          return Promise.reject(failure);
        }),
      });
    });
    const fixture = installCurrentAdaptiveOwner('adaptive-known-chapter', initial, true);

    await expect(
      ensureBrowserReaderBoundedLocator(fixture.state, { href: 'known.xhtml' }),
    ).rejects.toBe(failure);

    expect(quantaAtTarget).toBe(16);
    expect(fixture.state.chapterLocalPreview.active).toBeUndefined();
  });
});

interface AdaptiveFixture {
  readonly state: BrowserReaderState;
  readonly owner: ReturnType<typeof createBrowserReaderBoundedSessionOwner>;
}

interface PresentationLease {
  render(context: BrowserReaderState['ctx']): boolean;
  composited(): boolean;
  transitionSettled(): boolean;
  finish(): boolean;
}

function createAdaptiveFixture(sessionId: string): AdaptiveFixture {
  const worker = createWorker(() => undefined, sessionId).worker;
  const state = createState(worker);
  const owner = createBrowserReaderBoundedSessionOwner(worker);
  state.boundedSessions.current = owner;
  return { state, owner };
}

function installCurrentAdaptiveOwner(
  sessionId: string,
  initial: ReturnType<typeof spreadSnapshot>,
  knownChapter = false,
): AdaptiveFixture {
  const worker = createWorker(() => undefined, sessionId).worker;
  const state = createState(
    worker,
    knownChapter
      ? {
          chapters: [
            {
              idref: 'known',
              href: 'known.xhtml',
              linear: true,
              textLength: 1,
              textHash: 'known',
            },
          ],
        }
      : undefined,
  );
  const navigation = knownChapter
    ? {
        ...initial.navigation,
        chapters: [
          {
            idref: 'known',
            href: 'known.xhtml',
            linear: true,
            startPage: 0,
            endPage: 1,
            pageCount: 1,
          },
        ],
      }
    : initial.navigation;
  setRevisionState(state, initial.revision, navigation);
  const owner = createBrowserReaderBoundedSessionOwner(worker);
  recordBrowserReaderAcceptedRevision(owner, initial.revision);
  state.boundedSessions.current = owner;
  return { state, owner };
}

function installActivePreview(
  state: BrowserReaderState,
  intent: NonNullable<ReturnType<typeof beginBrowserReaderContinuationBatchIntent>>,
  requestId = 1,
): BrowserReaderChapterLocalPreviewRequest {
  const locator: ReaderLocator = { href: 'late.xhtml', anchorId: `target-${String(requestId)}` };
  const owner: BrowserReaderChapterLocalOwner = {
    revisionId: `local-${String(requestId)}`,
    revisionVersion: requestId,
    coordinate: { kind: 'chapterLocal', chapterIndex: 1, href: 'late.xhtml' },
  };
  const request: BrowserReaderChapterLocalPreviewRequest = {
    id: requestId,
    locator,
    targetChapterIndex: 1,
    targetChapterHref: 'late.xhtml',
    mountSpreadIndex: 0,
    direction: 'forward',
    layoutConfig: state.config,
    spreadMode: state.spreadMode,
    lineBreaking: state.lineBreaking,
    workerSessionId: state.worker.sessionId,
    tocEntry: undefined,
    transport: transport(state.worker),
    mainSettled: false,
  };
  bindBrowserReaderContinuationBatchIntent(request, intent);
  state.chapterLocalPreview.latestRequestId = request.id;
  state.chapterLocalPreview.active = {
    request,
    owner,
    localSpreadIndex: 0,
    frame: {
      revisionId: owner.revisionId,
      spreadIndex: 0,
      width: 800,
      height: 600,
      commands: [],
      commandHash: 'preview',
      resourceRefs: { images: [] },
      fontFamilies: [],
      imageDominated: false,
    },
    images: new Map(),
    phase: 'paintable',
    exactSpreadIndex: undefined,
    presentationStarted: false,
  };
  return request;
}

function presentationLease(state: BrowserReaderState, locator: ReaderLocator): PresentationLease {
  const reader = {} as Partial<Reader> & Record<PropertyKey, unknown>;
  installBrowserReaderChapterLocalPresentation(reader, state);
  const capability = reader[PRESENTATION] as {
    claim(target: ReaderLocator, spreadIndex: number): PresentationLease | undefined;
  };
  const lease = capability.claim(locator, 0);
  if (!lease) throw new Error('Adaptive fixture could not claim its presentation');
  return lease;
}

function continuationResolver(): () => number {
  const options = mocks.createBoundedSession.mock.calls.at(-1)?.[1];
  const resolver = options?.continuationBatchQuanta;
  if (typeof resolver !== 'function') {
    throw new Error('Bounded owner did not install a dynamic continuation resolver');
  }
  return resolver;
}

function controller(
  overrides: Partial<BrowserReaderBoundedSession> = {},
): BrowserReaderBoundedSession {
  return {
    start: vi.fn(),
    ensureSpread: vi.fn(),
    ensureLocator: vi.fn(),
    complete: vi.fn(),
    calibrateFontVerticalMetrics: vi.fn(),
    currentSnapshot: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function requiredResolver(value: number | (() => number) | undefined): () => number {
  if (typeof value !== 'function') {
    throw new Error('Bounded owner did not install a dynamic continuation resolver');
  }
  return value;
}

function transport(worker: BrowserReaderWorkerClient): BrowserReaderChapterLocalTransport {
  return {
    workerSessionId: worker.sessionId,
    disposeSession: vi.fn(),
    createBoundedChapterLocalRevision: vi.fn(),
    continueChapterLocalRevision: vi.fn(),
    releaseChapterLocalRevision: vi.fn((owner: BrowserReaderChapterLocalOwner) =>
      Promise.resolve({ owner, releasedRevision: true, releasedTransferCount: 0 }),
    ),
  };
}

function context(): BrowserReaderState['ctx'] {
  return {
    canvas: { width: 800, height: 600 },
    clearRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    restore: vi.fn(),
  } as unknown as BrowserReaderState['ctx'];
}
