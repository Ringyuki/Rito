import { vi } from 'vitest';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import type {
  CoreRevisionNavigation,
  CoreRevisionSummary,
} from '../../src/bindings/browser/core-contracts';
import type {
  BrowserReaderFrameBuffer,
  BrowserReaderRevisionResult,
} from '../../src/bindings/browser/core-contracts';
import type { BrowserReaderWorkerClient } from '../../src/bindings/browser/core-contracts';
import { createBrowserReaderChapterLocalPreviewState } from '../../src/bindings/browser/chapter-local-preview/state';

export function createState(
  worker: BrowserReaderWorkerClient,
  publication?: Partial<BrowserReaderState['publication']>,
): BrowserReaderState {
  return {
    worker,
    workerFactory: () => worker,
    decodeFrameCommandBuffer: vi.fn(() => ({
      protocolVersion: 2,
      commandCount: 0,
      commandCounts: {},
      recordStats: recordStats(),
      commands: [],
      commandHash: 'frame',
      resourceRefCount: 0,
      resourceTable: [],
      records: [],
    })),
    documentData: new ArrayBuffer(0),
    fragmentPagination: false,
    pinnedFonts: {
      policy: undefined,
      summary: emptyPinnedFontPolicySummary(),
      registry: undefined,
      faces: new Map(),
    },
    canvas: {} as HTMLCanvasElement,
    ctx: {} as BrowserReaderState['ctx'],
    fontMetrics: {
      genericSerif: { advances: {}, pairAdjustments: {} },
      fontFamilies: {},
      verticalMetrics: {},
    },
    publication: {
      package: {
        metadata: { title: '', language: '', identifier: '' },
        manifest: [],
        spine: [],
        toc: [],
      },
      resources: { stylesheets: [], fonts: [], images: [] },
      chapters: [],
      fontFaces: [],
      ...publication,
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    config: {
      viewportWidth: 800,
      viewportHeight: 600,
      pageWidth: 720,
      pageHeight: 520,
      marginTop: 40,
      marginRight: 40,
      marginBottom: 40,
      marginLeft: 40,
      spreadMode: 'single',
      firstPageAlone: true,
      spreadGap: 20,
      rootFontSize: 16,
    },
    spreadMode: 'single',
    lineBreaking: 'greedy',
    bgColor: '#fff',
    fgColor: undefined,
    dpr: 1,
    revisionBundle: {
      revision: {
        revisionId: '',
        revisionVersion: 0,
        layoutKey: '',
        status: 'complete',
        knownExtent: { pageCount: 0, spreadCount: 0 },
        finalExtent: { pageCount: 0, spreadCount: 0 },
        pageCount: 0,
        spreadCount: 0,
      },
      navigation: {
        revisionId: '',
        pageCount: 0,
        spreadCount: 0,
        spreads: [],
        chapters: [],
        chapterMap: {},
      },
      footnotes: { revisionId: '', complete: false, pendingKeys: [], entries: {} },
      chapterTextIndices: { revisionId: '', entries: {} },
      tocTargets: { revisionId: '', targets: [] },
      fontFamilies: [],
    },
    revisionHandle: undefined,
    commitGeneration: 0,
    boundedSessions: { current: undefined, candidate: undefined },
    chapterLocalPreview: createBrowserReaderChapterLocalPreviewState(),
    disposeTask: undefined,
    pendingHostTasks: new Set(),
    interaction: { pageTargets: new Map(), pendingPageTargets: new Map() },
    frames: new Map(),
    pendingImageLoads: new Map(),
    imageResourceFailures: new Map(),
    settledImageResourceSpreads: new Set(),
    footnotes: new Map(),
    chapterTextIndices: new Map(),
    tocTargets: [],
    activeSpreadIndex: 0,
    images: new Map(),
    registeredFontFaces: new Map(),
    spreadRenderedListeners: new Set(),
    spreadContentInvalidatedListeners: new Set(),
    fontSizeOverride: undefined,
    lineHeightOverride: undefined,
    lineHeightForce: false,
    fontFamilyOverride: undefined,
    fontFamilyForce: false,
    pendingFrameLoads: new Map(),
    layoutCommittedListeners: new Set(),
    reflow: {
      active: undefined,
      token: 0,
      microtaskScheduled: false,
      queued: undefined,
      lastError: undefined,
    },
    disposed: false,
    hostLineMetricsEpoch: 0,
    publishedHostLineMetricsEpoch: 0,
  };
}

function emptyPinnedFontPolicySummary(): BrowserReaderState['pinnedFonts']['summary'] {
  return {
    schemaVersion: 1,
    policyId: '01'.repeat(32),
    faces: [],
  };
}

export function setRevisionState(
  state: BrowserReaderState,
  revision: CoreRevisionSummary,
  navigation: CoreRevisionNavigation = emptyNavigation(revision),
): void {
  state.commitGeneration += 1;
  state.revisionHandle = {
    workerSessionId: state.worker.sessionId,
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
    publicationGeneration: state.commitGeneration,
    commitGeneration: state.commitGeneration,
  };
  state.revisionBundle = {
    ...state.revisionBundle,
    revision,
    navigation,
  };
  vi.spyOn(state.worker, 'getPageReadingAnchorAtRevision').mockImplementation(
    (handle, pageIndex) => {
      const spreadIndex =
        navigation.spreads.find((spread) => spread.pageIndexes.includes(pageIndex))?.spreadIndex ??
        0;
      return Promise.resolve({
        revision: handle,
        value: {
          status: 'unavailable',
          revisionId: handle.revisionId,
          pageIndex,
          spreadIndex,
          reason: 'noSourceContent',
        },
      });
    },
  );
}

function emptyNavigation(revision: CoreRevisionSummary): CoreRevisionNavigation {
  return {
    revisionId: revision.revisionId,
    pageCount: revision.pageCount,
    spreadCount: revision.spreadCount,
    spreads: spreadNavigation(revision.spreadCount),
    chapters: [],
    chapterMap: {},
  };
}

export function frameBuffer(revisionId = 'rev', spreadIndex = 0): BrowserReaderFrameBuffer {
  return {
    metadata: {
      revisionId,
      spreadIndex,
      width: 800,
      height: 600,
      protocolVersion: 2,
      commandCount: 0,
      commandCounts: {},
      recordStats: recordStats(),
      byteLength: 0,
      commandHash: 'frame',
      resourceRefCount: 0,
      resourceTable: [],
      fontFamilies: [],
      imageDominated: false,
      stringTable: [],
      payloadTable: [],
    },
    bytes: new Uint8Array(),
  };
}

export function spreadNavigation(count: number) {
  return Array.from({ length: count }, (_, index) => spreadNavigationSlot(index, index));
}

export function spreadNavigationSlot(
  spreadIndex: number,
  leftPageIndex: number,
  rightPageIndex?: number,
) {
  return {
    spreadIndex,
    pageIndexes: rightPageIndex !== undefined ? [leftPageIndex, rightPageIndex] : [leftPageIndex],
    leftPageIndex,
    ...(rightPageIndex !== undefined ? { rightPageIndex } : {}),
  };
}

export function chapterNavigation(idref: string, startPage: number, endPage: number) {
  return {
    idref,
    href: `${idref}.xhtml`,
    linear: true,
    startPage,
    endPage,
    pageCount: endPage - startPage + 1,
  };
}

export function revisionSummary(
  revisionId: string,
  pageCount: number,
  spreadCount: number,
  layoutKey = revisionId,
): CoreRevisionSummary {
  return {
    revisionId,
    revisionVersion: 0,
    layoutKey,
    status: 'complete',
    knownExtent: { pageCount, spreadCount },
    finalExtent: { pageCount, spreadCount },
    pageCount,
    spreadCount,
  };
}

export function revisionResult(
  revisionId: string,
  pageCount: number,
  spreadCount: number,
  displaySpreadIndex = 0,
): BrowserReaderRevisionResult {
  const initialFrameBuffer = spreadCount > 0 ? frameBuffer(revisionId, 0) : undefined;
  const result: BrowserReaderRevisionResult = {
    bundle: {
      revision: revisionSummary(revisionId, pageCount, spreadCount),
      navigation: {
        revisionId,
        pageCount,
        spreadCount,
        spreads: spreadNavigation(spreadCount),
        chapters: [],
        chapterMap: {},
      },
      footnotes: { revisionId, complete: true, pendingKeys: [], entries: {} },
      chapterTextIndices: { revisionId, entries: {} },
      tocTargets: { revisionId, targets: [] },
      fontFamilies: [],
    },
    preview: false,
  };
  if (initialFrameBuffer === undefined) return result;
  const frameWindow = {
    plan: { revisionId, centerSpreadIndex: 0, displaySpreadIndex, spreadIndexes: [0] },
    frames: [initialFrameBuffer],
    spreads: [{ spreadIndex: 0, resources: [], missingResources: [] }],
  };
  return {
    ...result,
    frameSelection: { spreadIndex: 0, displaySpreadIndex },
    selectedFrame: {
      spreadIndex: 0,
      displaySpreadIndex,
      frame: initialFrameBuffer,
    },
    frameWindow,
  };
}

function recordStats() {
  return {
    geometryRecords: 0,
    paintRecords: 0,
    payloadRecords: 0,
    primaryStringRecords: 0,
    secondaryStringRecords: 0,
  };
}
