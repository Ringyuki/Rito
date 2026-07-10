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

export function createState(
  worker: BrowserReaderWorkerClient,
  publication?: Partial<BrowserReaderState['publication']>,
): BrowserReaderState {
  return {
    worker,
    foregroundWorker: worker,
    fullReflowWorker: undefined,
    fullReflowOpenPromise: undefined,
    coreModule: {
      decodeRitoFrameCommandBuffer: vi.fn(),
      initRitoCoreWasmEngine: vi.fn(),
      normalizeRitoCoreWasmError: vi.fn((error: unknown, operation?: string) => {
        const message = error instanceof Error ? error.message : String(error);
        return new Error(`${operation ?? 'browser reader'}: ${message}`);
      }),
    } as unknown as BrowserReaderState['coreModule'],
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
    canvas: {} as HTMLCanvasElement,
    ctx: {} as BrowserReaderState['ctx'],
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
      revision: { revisionId: '', layoutKey: '', pageCount: 0, spreadCount: 0 },
      navigation: {
        revisionId: '',
        pageCount: 0,
        spreadCount: 0,
        spreads: [],
        chapters: [],
        chapterMap: {},
      },
      footnotes: { revisionId: '', entries: {} },
      chapterTextIndices: { revisionId: '', entries: {} },
      tocTargets: { revisionId: '', targets: [] },
      fontFamilies: [],
    },
    visualPreview: undefined,
    frames: new Map(),
    pendingImageLoads: new Map(),
    footnotes: new Map(),
    chapterTextIndices: new Map(),
    tocTargets: [],
    activeSpreadIndex: 0,
    images: new Map(),
    imageObjectUrls: new Map(),
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
      active: false,
      token: 0,
      microtaskScheduled: false,
      queued: undefined,
      deferred: undefined,
      deferredTimer: undefined,
      lastError: undefined,
    },
    disposed: false,
  };
}

export function setRevisionState(
  state: BrowserReaderState,
  revision: CoreRevisionSummary,
  navigation: CoreRevisionNavigation = emptyNavigation(revision),
): void {
  state.revisionBundle = {
    ...state.revisionBundle,
    revision,
    navigation,
  };
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

export function revisionResult(
  revisionId: string,
  pageCount: number,
  spreadCount: number,
  displaySpreadIndex = 0,
): BrowserReaderRevisionResult {
  const initialFrameBuffer = spreadCount > 0 ? frameBuffer(revisionId, 0) : undefined;
  const result: BrowserReaderRevisionResult = {
    bundle: {
      revision: { revisionId, layoutKey: revisionId, pageCount, spreadCount },
      navigation: {
        revisionId,
        pageCount,
        spreadCount,
        spreads: spreadNavigation(spreadCount),
        chapters: [],
        chapterMap: {},
      },
      footnotes: { revisionId, entries: {} },
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
    spreads: [{ spreadIndex: 0, resources: [] }],
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
