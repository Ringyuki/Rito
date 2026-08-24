import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderLocator } from '../../src/reader';
import {
  browserReaderChapterLocalLocatorHasAnchorConflict,
  canonicalizeBrowserReaderChapterLocalLocator,
  createBrowserReaderChapterLocalPreviewState,
  browserReaderChapterLocalPreviewSuspendsInteractions,
  sameBrowserReaderLocator,
} from '../../src/bindings/browser/chapter-local-preview/state';
import { previewTarget } from '../../src/bindings/browser/chapter-local-preview/target';
import {
  browserReaderChapterLocalPreviewEnabled,
  browserReaderChapterLocalTransport,
} from '../../src/bindings/browser/chapter-local-preview/transport';
import { installBrowserReaderChapterLocalPresentation } from '../../src/bindings/browser/chapter-local-preview/presentation';
import {
  beginBrowserReaderChapterLocalPreview,
  supersedeBrowserReaderChapterLocalPreview,
} from '../../src/bindings/browser/chapter-local-preview/coordinator';
import type { BrowserReaderWorkerClient } from '../../src/bindings/browser/core-contracts';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import type {
  BrowserReaderChapterLocalOwner,
  BrowserReaderChapterLocalMutationResult,
  BrowserReaderChapterLocalPreviewRequest,
  BrowserReaderChapterLocalTransport,
} from '../../src/bindings/browser/chapter-local-preview/types';
import { createState, frameBuffer } from './browser-reader-reflow-state-fixtures';
import { createWorker } from './browser-reader-reflow-fixtures';

const GATE = Symbol.for('@ritojs/core/browser/chapter-local-preview');
const PRESENTATION = Symbol.for('@ritojs/core/browser/chapter-local-preview-presentation');

afterEach(() => {
  Reflect.deleteProperty(globalThis, GATE);
});

describe('Browser reader chapter-local preview contract', () => {
  it('canonicalizes legacy fragments without inventing malformed or conflicting anchors', () => {
    expect(
      canonicalizeBrowserReaderChapterLocalLocator({ href: 'Text/chapter.xhtml#target%20one' }),
    ).toEqual({ href: 'Text/chapter.xhtml', anchorId: 'target one' });
    expect(
      canonicalizeBrowserReaderChapterLocalLocator({ href: 'Text/chapter.xhtml#bad%ZZ' }),
    ).toEqual({ href: 'Text/chapter.xhtml', anchorId: 'bad%ZZ' });
    expect(
      browserReaderChapterLocalLocatorHasAnchorConflict({
        href: 'Text/chapter.xhtml#from-href',
        anchorId: 'explicit',
      }),
    ).toBe(true);
    expect(
      sameBrowserReaderLocator(
        { href: 'Text/chapter.xhtml#target%20one' },
        { href: 'Text/chapter.xhtml', anchorId: 'target one' },
      ),
    ).toBe(true);
  });

  it('consumes the initial-locator exclusion once and allows the same later intent', () => {
    const locator: ReaderLocator = { href: 'late.xhtml#target' };
    const fixture = createWorker(() => undefined, 'chapter-local-target');
    const state = createState(fixture.worker, {
      chapters: [
        {
          idref: 'late',
          href: 'late.xhtml',
          linear: true,
          textLength: 1,
          textHash: 'late',
        },
      ],
    });
    Object.assign(state.publication.package, {
      toc: [{ label: 'Target', href: 'late.xhtml#target', children: [] }],
    });
    Object.assign(state.chapterLocalPreview, createBrowserReaderChapterLocalPreviewState(locator));

    expect(previewTarget(state, locator)).toBeUndefined();
    expect(previewTarget(state, locator)).toEqual({
      chapterIndex: 0,
      chapterHref: 'late.xhtml',
      tocEntry: state.publication.package.toc[0],
    });
  });

  it('defaults on only for capable workers and honors the global false kill switch', () => {
    const capable = {
      sessionId: 'worker-session',
      dispose: vi.fn(),
      createBoundedChapterLocalRevision: vi.fn(),
      continueChapterLocalRevision: vi.fn(),
      releaseChapterLocalRevision: vi.fn(),
    } as unknown as BrowserReaderWorkerClient;

    expect(browserReaderChapterLocalPreviewEnabled()).toBe(true);
    expect(browserReaderChapterLocalTransport(capable)).toBeDefined();
    Object.defineProperty(globalThis, GATE, { configurable: true, value: false });
    expect(browserReaderChapterLocalPreviewEnabled()).toBe(false);
    expect(browserReaderChapterLocalTransport(capable)).toBeUndefined();
    expect(
      browserReaderChapterLocalTransport({ sessionId: 'legacy' } as BrowserReaderWorkerClient),
    ).toBeUndefined();
  });

  it('strictly claims one matching presentation lease and retires its isolated owner once', () => {
    const fixture = createWorker(() => undefined, 'chapter-local-presentation');
    const state = createState(fixture.worker);
    const locator: ReaderLocator = { href: 'late.xhtml', anchorId: 'target' };
    const owner = {
      revisionId: 'local',
      revisionVersion: 1,
      coordinate: { kind: 'chapterLocal' as const, chapterIndex: 1, href: 'late.xhtml' },
    };
    const release = vi.fn(() =>
      Promise.resolve({ owner, releasedRevision: true, releasedTransferCount: 0 }),
    );
    const capability = installPaintablePresentation(
      state,
      locator,
      owner,
      release,
      fixture.dispose,
    );

    expect(capability.canClaim(locator, 0)).toBe(true);
    expect(capability.canClaim({ href: 'other.xhtml' }, 0)).toBe(false);
    expect(capability.canClaim(locator, 1)).toBe(false);
    const lease = capability.claim(locator, 0);
    expect(lease).toBeDefined();
    expect(capability.claim(locator, 0)).toBeUndefined();
    expect(lease?.transitionSettled()).toBe(true);
    expect(lease?.finish()).toBe(true);
    expect(lease?.finish()).toBe(false);
    expect(state.chapterLocalPreview.active).toBeUndefined();
    expect(release).toHaveBeenCalledOnce();
  });

  it('consumes a failed fire-and-forget owner release after failing the session closed', async () => {
    const fixture = createWorker(() => undefined, 'chapter-local-release-failure');
    const state = createState(fixture.worker);
    const locator: ReaderLocator = { href: 'late.xhtml', anchorId: 'target' };
    const owner = {
      revisionId: 'local',
      revisionVersion: 1,
      coordinate: { kind: 'chapterLocal' as const, chapterIndex: 1, href: 'late.xhtml' },
    };
    const failure = new Error('release transport failed');
    const release = vi.fn(() => Promise.reject(failure));
    state.boundedSessions.current = {
      worker: fixture.worker,
    } as NonNullable<BrowserReaderState['boundedSessions']['current']>;
    state.revisionHandle = {
      workerSessionId: fixture.worker.sessionId,
      revisionId: 'main',
      revisionVersion: 1,
      publicationGeneration: 1,
      commitGeneration: 1,
    };
    const capability = installPaintablePresentation(
      state,
      locator,
      owner,
      release,
      fixture.dispose,
    );
    expect(browserReaderChapterLocalPreviewSuspendsInteractions(state)).toBe(true);

    const lease = capability.claim(locator, 0);
    expect(lease?.transitionSettled()).toBe(true);
    expect(lease?.finish()).toBe(true);
    expect(browserReaderChapterLocalPreviewSuspendsInteractions(state)).toBe(false);
    expect(state.chapterLocalPreview.active).toBeUndefined();
    expect(lease?.transitionSettled()).toBe(false);
    expect(lease?.finish()).toBe(false);

    await Promise.allSettled([...state.pendingHostTasks]);

    expect(state.pendingHostTasks.size).toBe(0);
    expect(state.boundedSessions.current).toBeUndefined();
    expect(state.revisionHandle).toBeUndefined();
    expect(fixture.dispose).toHaveBeenCalledOnce();
    expect(state.logger.error).toHaveBeenCalledOnce();
  });

  it('releases an owner once when invalidation and warning listeners both throw', async () => {
    const fixture = createWorker(() => undefined, 'chapter-local-listener-failure');
    const state = createState(fixture.worker);
    const locator: ReaderLocator = { href: 'late.xhtml', anchorId: 'target' };
    const owner = {
      revisionId: 'local',
      revisionVersion: 1,
      coordinate: { kind: 'chapterLocal' as const, chapterIndex: 1, href: 'late.xhtml' },
    };
    const release = vi.fn(() =>
      Promise.resolve({ owner, releasedRevision: true, releasedTransferCount: 0 }),
    );
    installPaintablePresentation(state, locator, owner, release, fixture.dispose);
    state.spreadContentInvalidatedListeners.add(() => {
      throw new Error('invalidation listener failed');
    });
    Object.assign(state.logger, {
      warn: vi.fn(() => {
        throw new Error('warning logger failed');
      }),
    });

    expect(() => {
      supersedeBrowserReaderChapterLocalPreview(state);
    }).not.toThrow();
    expect(state.chapterLocalPreview.active).toBeUndefined();
    expect(browserReaderChapterLocalPreviewSuspendsInteractions(state)).toBe(false);

    await Promise.allSettled([...state.pendingHostTasks]);

    expect(release).toHaveBeenCalledOnce();
    expect(state.pendingHostTasks.size).toBe(0);
  });

  it('contains a preview task rejection when warning and invalidation listeners throw', async () => {
    const fixture = createWorker(() => undefined, 'chapter-local-task-failure');
    const failure = new Error('create preview failed');
    Object.assign(fixture.worker, {
      createBoundedChapterLocalRevision: vi.fn(() => Promise.reject(failure)),
      continueChapterLocalRevision: vi.fn(() => Promise.reject(new Error('unused'))),
      releaseChapterLocalRevision: vi.fn(() => Promise.reject(new Error('unused'))),
    });
    const state = createState(fixture.worker, {
      chapters: [
        {
          idref: 'late',
          href: 'late.xhtml',
          linear: true,
          textLength: 1,
          textHash: 'late',
        },
      ],
    });
    const invalidated = vi.fn(() => {
      throw new Error('invalidation listener failed');
    });
    state.spreadContentInvalidatedListeners.add(invalidated);
    Object.assign(state.logger, {
      warn: vi.fn(() => {
        throw new Error('warning logger failed');
      }),
    });

    expect(
      beginBrowserReaderChapterLocalPreview(state, {
        href: 'late.xhtml',
        anchorId: 'target',
      }),
    ).toBeDefined();
    await Promise.allSettled([...state.pendingHostTasks]);

    expect(state.pendingHostTasks.size).toBe(0);
    expect(invalidated).toHaveBeenCalledOnce();
    expect(state.chapterLocalPreview.active).toBeUndefined();
  });

  it('attempts a missing-resource owner release only once when release rejects', async () => {
    const fixture = createWorker(() => undefined, 'chapter-local-release-once');
    const locator: ReaderLocator = { href: 'late.xhtml', anchorId: 'target' };
    const owner: BrowserReaderChapterLocalOwner = {
      revisionId: 'local',
      revisionVersion: 1,
      coordinate: { kind: 'chapterLocal', chapterIndex: 0, href: 'late.xhtml' },
    };
    const failure = new Error('release proof failed');
    const release = vi.fn(() => Promise.reject(failure));
    Object.assign(fixture.worker, {
      createBoundedChapterLocalRevision: vi.fn(() =>
        Promise.resolve(resolvedPreviewMutation(owner, locator)),
      ),
      continueChapterLocalRevision: vi.fn(() => Promise.reject(new Error('unused'))),
      releaseChapterLocalRevision: release,
    });
    const state = createState(fixture.worker, {
      chapters: [
        {
          idref: 'late',
          href: 'late.xhtml',
          linear: true,
          textLength: 1,
          textHash: 'late',
        },
      ],
    });
    const current = {
      worker: fixture.worker,
    } as NonNullable<BrowserReaderState['boundedSessions']['current']>;
    state.boundedSessions.current = current;

    expect(beginBrowserReaderChapterLocalPreview(state, locator)).toBeDefined();
    await Promise.allSettled([...state.pendingHostTasks]);

    expect(release).toHaveBeenCalledOnce();
    expect(current.terminalError).toBe(failure);
    expect(state.boundedSessions.current).toBeUndefined();
    expect(state.chapterLocalPreview.active).toBeUndefined();
    expect(fixture.dispose).toHaveBeenCalledOnce();
    expect(state.pendingHostTasks.size).toBe(0);
  });
});

interface TestPresentationCapability {
  canClaim(target: ReaderLocator, spreadIndex: number): boolean;
  claim(
    target: ReaderLocator,
    spreadIndex: number,
  ):
    | {
        transitionSettled(): boolean;
        finish(): boolean;
      }
    | undefined;
}

function installPaintablePresentation(
  state: BrowserReaderState,
  locator: ReaderLocator,
  owner: BrowserReaderChapterLocalOwner,
  release: BrowserReaderChapterLocalTransport['releaseChapterLocalRevision'],
  disposeSession: () => void,
): TestPresentationCapability {
  const transport: BrowserReaderChapterLocalTransport = {
    workerSessionId: state.worker.sessionId,
    disposeSession,
    createBoundedChapterLocalRevision: vi.fn(() => Promise.reject(new Error('unused'))),
    continueChapterLocalRevision: vi.fn(() => Promise.reject(new Error('unused'))),
    releaseChapterLocalRevision: release,
  };
  const request: BrowserReaderChapterLocalPreviewRequest = {
    id: 1,
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
    transport,
    mainSettled: false,
  };
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
  const reader = {} as Partial<Reader> & Record<PropertyKey, unknown>;
  installBrowserReaderChapterLocalPresentation(reader, state);
  return reader[PRESENTATION] as TestPresentationCapability;
}

function resolvedPreviewMutation(
  owner: BrowserReaderChapterLocalOwner,
  locator: ReaderLocator,
): BrowserReaderChapterLocalMutationResult {
  const buffer = frameBuffer(owner.revisionId, 0);
  return {
    advance: {
      revision: {
        ...owner,
        layoutKey: 'local-layout',
        status: 'ready',
        localPageCap: 16,
        knownExtent: { localPageCount: 1, localSpreadCount: 1 },
        finalExtent: { localPageCount: 1, localSpreadCount: 1 },
        pageCapReached: false,
      },
      previousKnownExtent: { localPageCount: 0, localSpreadCount: 0 },
      newlyKnownLocalPages: { startLocalPage: 0, endLocalPageExclusive: 1 },
      processedTopLevelNodes: 1,
      target: {
        status: 'resolved',
        owner,
        locator,
        spineIdref: 'late',
        localPageIndex: 0,
        localSpreadIndex: 0,
        matchedBy: 'anchor',
      },
    },
    frame: {
      owner,
      localSpreadIndex: 0,
      metadata: {
        ...buffer.metadata,
        owner,
        localSpreadIndex: 0,
      },
      bytes: buffer.bytes,
      resources: [],
      missingResources: [
        { kind: 'image', href: 'missing.png', message: 'missing preview resource' },
      ],
    },
  };
}
