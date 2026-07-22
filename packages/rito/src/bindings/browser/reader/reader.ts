import type {
  PackageMetadata,
  Reader,
  ReaderIncrementalPagination,
  ReaderOptions,
} from '../../../reader';
import type { CanvasRenderingTarget } from '../rendering';
import {
  applyLayoutOverrides,
  browserReaderChapterMap,
  browserReaderManifestHrefMap,
  browserReaderPages,
  browserReaderSpreads,
  makeBrowserReaderLayoutConfig,
} from '../reader-layout';
import {
  scheduleBrowserReaderReflow,
  startBrowserReaderInitialReflow,
} from './pipeline/bounded-reflow';
import { warmBrowserReaderFrameWindow } from './frame-cache';
import { createBrowserReaderResourceState, preloadCurrentReaderFonts } from '../resources';
import { buildBrowserReaderMethods } from './reader-methods';
import { disposeBrowserReaderState } from './reader-dispose';
import { completeBrowserReaderBoundedSession } from '../bounded-session-runtime';
import { trackBrowserReaderHostTask } from './host-tasks';
import { createHostFontMetrics } from '../font-metrics';
import { createBrowserReaderWorkerClientFactory } from './worker-client';
import {
  type BrowserReaderBindingModule,
  type BrowserReaderState,
  type BrowserReaderWorkerClientFactory,
} from './types';
import { createBrowserHostLogger } from '../host-runtime';
import { loadRuntimeCoreModule } from './wasm-module';
import type { BrowserReaderWorkerClient, BrowserReaderOpenResult } from '../core-contracts';
import {
  disposeBrowserReaderPinnedFonts,
  openBrowserReaderWorker,
  prepareBrowserReaderPinnedFonts,
  readerLayoutOptions,
  registerBrowserReaderPinnedFonts,
  type BrowserReaderPinnedFonts,
} from '../pinned-fonts';
import { ensureBrowserReaderBoundedSpread } from '../bounded-session-runtime';
import {
  createEmptyBrowserReaderReflowState,
  createEmptyBrowserReaderRevisionState,
} from './pipeline/initial-state';
import { createBrowserReaderChapterLocalPreviewState } from '../chapter-local-preview/state';
import { installBrowserReaderChapterLocalPresentation } from '../chapter-local-preview/presentation';

export async function createReader(
  data: ArrayBuffer,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  const module = await loadRuntimeCoreModule();
  const workerFactory = createBrowserReaderWorkerClientFactory(module);
  let pinnedFonts: BrowserReaderPinnedFonts | undefined;
  let state: BrowserReaderState | undefined;
  try {
    const worker = workerFactory();
    const ctx = canvas.getContext('2d') as CanvasRenderingTarget | null;
    if (!ctx) throw new Error('Rito reader core requires a 2D canvas context');
    const opened = await openBrowserReaderDocument(
      worker,
      data,
      options.pinnedFontPolicy,
      options.experimentalFragmentPagination === true,
    );
    pinnedFonts = opened.pinnedFonts;
    state = createInitialState(
      worker,
      workerFactory,
      module,
      opened.documentData,
      opened.openResult,
      pinnedFonts,
      canvas,
      ctx,
      options,
    );
    await startInitialReflow(state, options);
    scheduleFragmentPaginationCompletion(state);
    const reader: Partial<Reader> = buildBrowserReaderMethods(state, readerLayoutOptions(options));
    defineBrowserReaderAccessors(reader, state);
    installBrowserReaderChapterLocalPresentation(reader, state);
    return reader as Reader;
  } catch (error) {
    if (state) {
      disposeBrowserReaderState(state);
      await state.disposeTask;
    } else {
      try {
        if (pinnedFonts) disposeBrowserReaderPinnedFonts(pinnedFonts);
      } catch {
        // Preserve the primary creation error while releasing the factory below.
      }
      try {
        await workerFactory.dispose?.();
      } catch {
        // Preserve the primary creation error after all factory clients settle.
      }
    }
    throw await normalizeBrowserReaderError(error, 'createReader');
  }
}

/**
 * The fragment page table attaches when a bounded session completes, but
 * reading alone never completes one. With the lever on, finish the book
 * in the background shortly after the first layout so the takeover
 * happens while the reader is still near the front of the book.
 */
function scheduleFragmentPaginationCompletion(state: BrowserReaderState): void {
  if (!state.fragmentPagination) return;
  setTimeout(() => {
    if (state.disposed) return;
    completeBrowserReaderBoundedSession(state).catch((error: unknown) => {
      state.logger.warn('rito: background fragment-pagination completion failed', error);
    });
  }, 1_000);
}

export async function preloadReaderRuntime(): Promise<void> {
  await loadRuntimeCoreModule();
}

interface OpenedBrowserReaderDocument {
  readonly documentData: ArrayBuffer;
  readonly openResult: BrowserReaderOpenResult;
  readonly pinnedFonts: BrowserReaderPinnedFonts;
}

async function openBrowserReaderDocument(
  worker: BrowserReaderWorkerClient,
  data: ArrayBuffer,
  policy: ReaderOptions['pinnedFontPolicy'],
  fragmentPagination: boolean,
): Promise<OpenedBrowserReaderDocument> {
  const prepared = prepareBrowserReaderPinnedFonts(policy);
  const documentData = data.slice(0);
  const openResult = await openBrowserReaderWorker(
    worker,
    data,
    prepared.policy,
    undefined,
    fragmentPagination,
  );
  const pinnedFonts = await registerBrowserReaderPinnedFonts(prepared, openResult.pinnedFontPolicy);
  return { documentData, openResult, pinnedFonts };
}

function createInitialState(
  worker: BrowserReaderWorkerClient,
  workerFactory: BrowserReaderWorkerClientFactory,
  module: BrowserReaderBindingModule,
  documentData: ArrayBuffer,
  openResult: BrowserReaderOpenResult,
  pinnedFonts: BrowserReaderPinnedFonts,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingTarget,
  options: ReaderOptions,
): BrowserReaderState {
  const spreadMode = options.spread ?? 'single';
  const state: BrowserReaderState = {
    worker,
    workerFactory,
    decodeFrameCommandBuffer: module.decodeRitoFrameCommandBuffer,
    documentData,
    pinnedFonts,
    fragmentPagination: options.experimentalFragmentPagination === true,
    canvas,
    ctx,
    fontMetrics: createHostFontMetrics(),
    publication: openResult.publication,
    logger: createBrowserHostLogger(options.logLevel ?? 'warn'),
    config: makeBrowserReaderLayoutConfig(options, spreadMode),
    spreadMode,
    lineBreaking: options.lineBreaking ?? 'greedy',
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor ?? undefined,
    dpr: options.devicePixelRatio ?? fallbackDevicePixelRatio(),
    ...createEmptyBrowserReaderRevisionState(),
    chapterLocalPreview: createBrowserReaderChapterLocalPreviewState(options.initialLocator),
    frames: new Map(),
    ...createBrowserReaderResourceState(),
    footnotes: new Map(),
    chapterTextIndices: new Map(),
    tocTargets: [],
    activeSpreadIndex: 0,
    ...emptyListenerSets(),
    ...initialTypographyOverrides(options),
    pendingFrameLoads: new Map(),
    reflow: createEmptyBrowserReaderReflowState(),
    disposed: false,
  };
  state.config = applyLayoutOverrides(state, state.config);
  return state;
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

async function startInitialReflow(
  state: BrowserReaderState,
  options: ReaderOptions,
): Promise<void> {
  await startBrowserReaderInitialReflow(
    state,
    options,
    options.spread ?? 'single',
    options.lineBreaking ?? 'greedy',
  );
  void trackBrowserReaderHostTask(
    state,
    warmInitialResources(state)
      .then((metricsChanged) => {
        if (metricsChanged) {
          scheduleBrowserReaderReflow(
            state,
            options,
            options.spread ?? 'single',
            options.lineBreaking ?? 'greedy',
            undefined,
            true,
          );
        }
      })
      .catch((error: unknown) => {
        state.logger.warn('initial reader resource warm failed', error);
      }),
  );
}

async function warmInitialResources(state: BrowserReaderState): Promise<boolean> {
  const metricsChanged = await preloadCurrentReaderFonts(state);
  void warmBrowserReaderFrameWindow(state, state.activeSpreadIndex);
  return metricsChanged;
}

export function defineBrowserReaderAccessors(
  reader: Partial<Reader>,
  state: BrowserReaderState,
): void {
  const pagination = createBrowserReaderIncrementalPagination(state);
  Object.defineProperties(reader, {
    metadata: {
      enumerable: true,
      get: () => normalizePackageMetadata(state.publication.package.metadata),
    },
    totalSpreads: { enumerable: true, get: () => state.revisionBundle.revision.spreadCount },
    activeSpreadIndex: { enumerable: true, get: () => state.activeSpreadIndex },
    pagination: { enumerable: true, value: pagination },
    toc: { enumerable: true, get: () => state.publication.package.toc },
    chapterMap: {
      enumerable: true,
      get: () => browserReaderChapterMap(state),
    },
    manifestHrefMap: {
      enumerable: true,
      get: () => browserReaderManifestHrefMap(state),
    },
    pages: { enumerable: true, get: () => browserReaderPages(state) },
    spreads: { enumerable: true, get: () => browserReaderSpreads(state) },
    dpr: { enumerable: true, get: () => state.dpr },
  });
}

export function createBrowserReaderIncrementalPagination(
  state: BrowserReaderState,
): ReaderIncrementalPagination {
  return {
    get complete() {
      return state.revisionBundle.revision.status === 'complete';
    },
    ensureSpread(spreadIndex, signal) {
      return ensureBrowserReaderBoundedSpread(state, spreadIndex, signal);
    },
  };
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
