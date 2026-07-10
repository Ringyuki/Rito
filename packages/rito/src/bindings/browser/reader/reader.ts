import type { PackageMetadata, Reader, ReaderOptions } from '../../../reader';
import type { CanvasRenderingTarget } from '../rendering';
import {
  applyLayoutOverrides,
  browserReaderPages,
  browserReaderSpreads,
  makeBrowserReaderLayoutConfig,
} from './layout';
import {
  createRitoCoreWasmReaderChapterMap,
  createRitoCoreWasmReaderManifestHrefMap,
} from '../core-contracts';
import { startBrowserReaderInitialReflow } from './pipeline/reflow';
import { warmBrowserReaderFrameWindow } from './frame-cache';
import { preloadReaderFonts } from '../resources';
import { buildBrowserReaderMethods } from './reader-methods';
import { createBrowserReaderWorkerClientFactory } from './worker-client';
import {
  createLogger,
  type BrowserReaderBindingModule,
  type BrowserReaderState,
  type BrowserReaderWorkerClientFactory,
} from './types';
import { loadRuntimeCoreModule } from './wasm-module';
import type { BrowserReaderWorkerClient, BrowserReaderOpenResult } from '../core-contracts';

export async function createReader(
  data: ArrayBuffer,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  const module = await loadRuntimeCoreModule();
  const workerFactory = createBrowserReaderWorkerClientFactory(module);
  const worker = workerFactory();
  try {
    const ctx = canvas.getContext('2d') as CanvasRenderingTarget | null;
    if (!ctx) throw new Error('Rito reader core requires a 2D canvas context');
    const spreadMode = options.spread ?? 'single';
    const lineBreaking = options.lineBreaking ?? 'greedy';
    const documentData = data.slice(0);
    const openResult = await worker.open(data);
    const state = createInitialState(
      worker,
      workerFactory,
      module,
      documentData,
      openResult,
      canvas,
      ctx,
      options,
    );
    await startBrowserReaderInitialReflow(
      state,
      options,
      spreadMode,
      lineBreaking,
      () => {
        warmInitialResources(state);
      },
      () => {
        warmInitialResources(state);
      },
    );
    const reader: Partial<Reader> = buildBrowserReaderMethods(state, options);
    defineBrowserReaderAccessors(reader, state);
    return reader as Reader;
  } catch (error) {
    worker.dispose();
    throw await normalizeBrowserReaderError(error, 'createReader');
  }
}

export async function preloadReaderRuntime(): Promise<void> {
  await loadRuntimeCoreModule();
}

function createInitialState(
  worker: BrowserReaderWorkerClient,
  workerFactory: BrowserReaderWorkerClientFactory,
  module: BrowserReaderBindingModule,
  documentData: ArrayBuffer,
  openResult: BrowserReaderOpenResult,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingTarget,
  options: ReaderOptions,
): BrowserReaderState {
  const spreadMode = options.spread ?? 'single';
  const lineBreaking = options.lineBreaking ?? 'greedy';
  const state: BrowserReaderState = {
    worker,
    foregroundWorker: worker,
    workerFactory,
    fullReflowWorker: undefined,
    fullReflowOpenPromise: undefined,
    decodeFrameCommandBuffer: module.decodeRitoFrameCommandBuffer,
    documentData,
    canvas,
    ctx,
    publication: openResult.publication,
    logger: createLogger(options.logLevel ?? 'warn'),
    config: makeBrowserReaderLayoutConfig(options, spreadMode),
    spreadMode,
    lineBreaking,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor ?? undefined,
    dpr: options.devicePixelRatio ?? fallbackDevicePixelRatio(),
    revisionBundle: emptyRevisionBundle(),
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
    ...emptyListenerSets(),
    ...initialTypographyOverrides(options),
    pendingFrameLoads: new Map(),
    reflow: emptyReflowState(),
    disposed: false,
  };
  state.config = applyLayoutOverrides(state, state.config);
  return state;
}

function emptyRevisionBundle(): BrowserReaderState['revisionBundle'] {
  return {
    revision: { revisionId: '', layoutKey: '', pageCount: 0, spreadCount: 0 },
    navigation: {
      revisionId: '',
      pageCount: 0,
      spreadCount: 0,
      spreads: [],
      chapters: [],
      chapterMap: {},
    },
    tocTargets: { revisionId: '', targets: [] },
    footnotes: { revisionId: '', entries: {} },
    chapterTextIndices: { revisionId: '', entries: {} },
    fontFamilies: [],
  };
}

function emptyReflowState(): BrowserReaderState['reflow'] {
  return {
    active: false,
    token: 0,
    microtaskScheduled: false,
    queued: undefined,
    deferred: undefined,
    deferredTimer: undefined,
    lastError: undefined,
  };
}

function emptyListenerSets(): Pick<
  BrowserReaderState,
  'spreadRenderedListeners' | 'spreadContentInvalidatedListeners' | 'layoutCommittedListeners'
> {
  return {
    spreadRenderedListeners: new Set(),
    spreadContentInvalidatedListeners: new Set(),
    layoutCommittedListeners: new Set(),
  };
}

function initialTypographyOverrides(
  options: ReaderOptions,
): Pick<
  BrowserReaderState,
  | 'fontSizeOverride'
  | 'lineHeightOverride'
  | 'lineHeightForce'
  | 'fontFamilyOverride'
  | 'fontFamilyForce'
> {
  return {
    fontSizeOverride: options.fontSize,
    lineHeightOverride: options.lineHeight,
    lineHeightForce: options.lineHeightForce ?? false,
    fontFamilyOverride: options.fontFamily,
    fontFamilyForce: options.fontFamilyForce ?? false,
  };
}

function fallbackDevicePixelRatio(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio : 1;
}

function warmInitialResources(state: BrowserReaderState): void {
  void preloadReaderFonts(state);
  void warmBrowserReaderFrameWindow(state, state.activeSpreadIndex);
}

function defineBrowserReaderAccessors(reader: Partial<Reader>, state: BrowserReaderState): void {
  Object.defineProperties(reader, {
    metadata: {
      enumerable: true,
      get: () => normalizePackageMetadata(state.publication.package.metadata),
    },
    totalSpreads: { enumerable: true, get: () => state.revisionBundle.revision.spreadCount },
    toc: { enumerable: true, get: () => state.publication.package.toc },
    chapterMap: {
      enumerable: true,
      get: () => createRitoCoreWasmReaderChapterMap(state.revisionBundle.navigation),
    },
    manifestHrefMap: {
      enumerable: true,
      get: () => createRitoCoreWasmReaderManifestHrefMap(state.publication),
    },
    pages: { enumerable: true, get: () => browserReaderPages(state) },
    spreads: { enumerable: true, get: () => browserReaderSpreads(state) },
    dpr: { enumerable: true, get: () => state.dpr },
  });
}

function normalizePackageMetadata(metadata: {
  readonly title: string;
  readonly language: string;
  readonly identifier: string;
  readonly creator?: string | undefined;
}): PackageMetadata {
  return {
    title: metadata.title,
    language: metadata.language,
    identifier: metadata.identifier,
    ...(metadata.creator !== undefined ? { creator: metadata.creator } : {}),
  };
}

async function normalizeBrowserReaderError(error: unknown, operation: string): Promise<Error> {
  const module = await loadRuntimeCoreModule();
  return module.normalizeRitoCoreWasmError(error, operation);
}
