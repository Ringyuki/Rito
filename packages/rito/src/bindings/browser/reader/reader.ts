import type {
  PackageMetadata,
  Reader,
  ReaderIncrementalPagination,
  ReaderOptions,
} from '../../../reader';
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
import {
  scheduleBrowserReaderReflow,
  startBrowserReaderInitialReflow,
} from './pipeline/bounded-reflow';
import { warmBrowserReaderFrameWindow } from './frame-cache';
import { createBrowserReaderResourceState, preloadCurrentReaderFonts } from '../resources';
import { buildBrowserReaderMethods } from './reader-methods';
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
import { disposeBrowserReaderSessionHosts } from '../reader-session-host';
import {
  createEmptyBrowserReaderReflowState,
  createEmptyBrowserReaderRevisionState,
} from './pipeline/initial-state';

export async function createReader(
  data: ArrayBuffer,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  const module = await loadRuntimeCoreModule();
  const workerFactory = createBrowserReaderWorkerClientFactory(module);
  const worker = workerFactory();
  let pinnedFonts: BrowserReaderPinnedFonts | undefined;
  let workerLifecycleTransferred = false;
  let committedState: BrowserReaderState | undefined;
  try {
    const ctx = canvas.getContext('2d') as CanvasRenderingTarget | null;
    if (!ctx) throw new Error('Rito reader core requires a 2D canvas context');
    const preparedPinnedFonts = prepareBrowserReaderPinnedFonts(options.pinnedFontPolicy);
    const documentData = data.slice(0);
    const openResult = await openBrowserReaderWorker(worker, data, preparedPinnedFonts.policy);
    pinnedFonts = await registerBrowserReaderPinnedFonts(
      preparedPinnedFonts,
      openResult.pinnedFontPolicy,
    );
    const state = createInitialState(
      worker,
      workerFactory,
      module,
      documentData,
      openResult,
      pinnedFonts,
      canvas,
      ctx,
      options,
    );
    workerLifecycleTransferred = true;
    await startInitialReflow(state, options);
    committedState = state;
    const reader: Partial<Reader> = buildBrowserReaderMethods(state, readerLayoutOptions(options));
    defineBrowserReaderAccessors(reader, state);
    return reader as Reader;
  } catch (error) {
    if (pinnedFonts) disposeBrowserReaderPinnedFonts(pinnedFonts);
    if (committedState) {
      committedState.disposed = true;
      disposeBrowserReaderSessionHosts(committedState);
      await committedState.disposeTask;
    } else if (!workerLifecycleTransferred) {
      try {
        worker.dispose();
      } catch {
        // Preserve the primary creation error when best-effort cleanup fails.
      }
    }
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
  pinnedFonts: BrowserReaderPinnedFonts,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingTarget,
  options: ReaderOptions,
): BrowserReaderState {
  const spreadMode = options.spread ?? 'single';
  const state: BrowserReaderState = {
    worker,
    foregroundWorker: worker,
    workerFactory,
    fullReflowWorker: undefined,
    fullReflowOpenPromise: undefined,
    decodeFrameCommandBuffer: module.decodeRitoFrameCommandBuffer,
    documentData,
    pinnedFonts,
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
    visualPreview: undefined,
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
  void warmInitialResources(state)
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
    });
}

async function warmInitialResources(state: BrowserReaderState): Promise<boolean> {
  const metricsChanged = await preloadCurrentReaderFonts(state);
  void warmBrowserReaderFrameWindow(state, state.activeSpreadIndex);
  return metricsChanged;
}

function defineBrowserReaderAccessors(reader: Partial<Reader>, state: BrowserReaderState): void {
  const pagination = createBrowserReaderIncrementalPagination(state);
  Object.defineProperties(reader, {
    metadata: {
      enumerable: true,
      get: () => normalizePackageMetadata(state.publication.package.metadata),
    },
    totalSpreads: { enumerable: true, get: () => state.revisionBundle.revision.spreadCount },
    pagination: { enumerable: true, value: pagination },
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
