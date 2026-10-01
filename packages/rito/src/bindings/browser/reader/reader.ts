import type { PackageMetadata, Reader, ReaderOptions } from '../../../reader';
import type { CanvasRenderingTarget } from '../rendering';
import {
  applyLayoutOverrides,
  browserReaderChapterMap,
  browserReaderManifestHrefMap,
  browserReaderSpreads,
  makeBrowserReaderLayoutConfig,
} from '../reader-layout';
import {
  scheduleBrowserReaderReflow,
  startBrowserReaderInitialReflow,
} from './pipeline/revision-reflow';
import { warmBrowserReaderFrameWindow } from './frame-cache';
import { createBrowserReaderResourceState, preloadCurrentReaderFonts } from '../resources';
import { buildBrowserReaderMethods } from './reader-methods';
import { disposeBrowserReaderState } from './reader-dispose';
import { refreshBrowserReaderFontAvailability } from '../revision-session-runtime';
import { syncUnavailableFontFaces } from '../font-availability';
import { trackBrowserReaderHostTask } from './host-tasks';
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
import {
  createEmptyBrowserReaderReflowState,
  createEmptyBrowserReaderRevisionState,
} from './pipeline/initial-state';
import { createBrowserReaderChapterLocalPreviewState } from '../chapter-local-preview/state';
import { installBrowserReaderChapterLocalPresentation } from '../chapter-local-preview/presentation';
import { installBrowserReaderDiagnostics } from './diagnostics';

export async function createReader(
  data: ArrayBuffer,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  // The fragment engine constructs its shaping context FROM the pinned
  // font bytes; without them the wasm side silently falls back to the
  // legacy pagination path and renders something else entirely. Refuse
  // the contradictory configuration loudly instead.
  if (options.pinnedFontPolicy === undefined || options.pinnedFontPolicy.faces.length === 0) {
    throw new Error(
      'createReader requires a pinnedFontPolicy with at least one face: the engine ' +
        'shapes text with those exact font bytes and cannot start without them',
    );
  }
  const module = await loadRuntimeCoreModule();
  const workerFactory = createBrowserReaderWorkerClientFactory(module);
  let pinnedFonts: BrowserReaderPinnedFonts | undefined;
  let state: BrowserReaderState | undefined;
  try {
    const worker = workerFactory();
    const ctx = canvas.getContext('2d') as CanvasRenderingTarget | null;
    if (!ctx) throw new Error('Rito reader core requires a 2D canvas context');
    const dpr = options.devicePixelRatio ?? fallbackDevicePixelRatio();
    const opened = await openBrowserReaderDocument(worker, data, options.pinnedFontPolicy, dpr);
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
    installBrowserReaderDiagnostics(state);
    await startInitialReflow(state, options);
    scheduleFontAvailabilityConvergence(state, readerLayoutOptions(options));
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
 * Publication faces load after the first layout, and the browser can
 * reject one then. Deliver late rejections in the background shortly
 * after the reader appears.
 */
function scheduleFontAvailabilityConvergence(
  state: BrowserReaderState,
  options: ReaderOptions,
): void {
  setTimeout(() => {
    if (state.disposed) return;
    convergeFontAvailabilityUntilQuiet(state, options).catch((error: unknown) => {
      state.logger.warn('rito: background font availability convergence failed', error);
    });
  }, 1_000);
}

/**
 * Delivers rejected faces and reflows round after round until a round
 * changes nothing. From the second round on, the rejections are first
 * pushed into the committed revision's worker (which does not re-lay it);
 * each round that changed something then waits out a forced reflow, so the
 * final page table is built without the rejected faces.
 */
async function convergeFontAvailabilityUntilQuiet(
  state: BrowserReaderState,
  options: ReaderOptions,
): Promise<void> {
  // A face can only be rejected once, so the loop ends on the first quiet
  // round; the bound only caps pathological churn.
  for (let round = 0; round < 12; round += 1) {
    if (round > 0 && (await refreshBrowserReaderFontAvailability(state)) === undefined) return;
    const spreadMode = options.spread ?? state.spreadMode;
    if (!(await convergeFontAvailability(state, options, spreadMode))) return;
  }
}

/**
 * Delivers the faces rejected since the last layout and waits out one
 * forced reflow so the committed layout no longer shapes with them.
 * Reports whether anything changed.
 */
async function convergeFontAvailability(
  state: BrowserReaderState,
  options: ReaderOptions,
  spreadMode: BrowserReaderState['spreadMode'],
): Promise<boolean> {
  const changed = await syncUnavailableFontFaces(state.worker).catch((error: unknown) => {
    state.logger.warn('rito: font availability sync failed', error);
    return false;
  });
  if (!changed || state.disposed) return false;
  state.fontAvailabilityEpoch += 1;
  await new Promise<void>((resolve) => {
    const scheduled = scheduleBrowserReaderReflow(state, options, spreadMode, resolve, true);
    if (!scheduled) resolve();
  });
  return true;
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
  renderRatio: number,
): Promise<OpenedBrowserReaderDocument> {
  const prepared = prepareBrowserReaderPinnedFonts(policy);
  // A reflow or a replacement opens a second worker and has to open the
  // book in it again, so the reader keeps this copy and spends the
  // caller's buffer on the first worker. One copy, not two: the transfer
  // moves the bytes rather than cloning them on top of this one.
  const documentData = data.slice(0);
  const openResult = await openBrowserReaderWorker(worker, data, prepared.policy, renderRatio);
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
    canvas,
    ctx,
    publication: openResult.publication,
    logger: createBrowserHostLogger(options.logLevel ?? 'warn'),
    config: makeBrowserReaderLayoutConfig(options, spreadMode),
    spreadMode,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor ?? undefined,
    dpr: options.devicePixelRatio ?? fallbackDevicePixelRatio(),
    ...createEmptyBrowserReaderRevisionState(),
    chapterLocalPreview: createBrowserReaderChapterLocalPreviewState(options.initialLocator),
    frames: new Map(),
    ...createBrowserReaderResourceState(),
    footnotes: new Map(),
    chapterTextIndices: new Map(),
    tocTargets: { revisionId: '', targets: [], activeEntryByPage: [] },
    activeSpreadIndex: 0,
    fontAvailabilityEpoch: 0,
    publishedFontAvailabilityEpoch: 0,
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
  const spreadMode = options.spread ?? 'single';
  await startBrowserReaderInitialReflow(state, options, spreadMode);
  // Faces rejected while the first layout ran are delivered before
  // returning: createReader has not resolved yet and the host is still
  // showing its loading state, so the corrected layout is the first one the
  // reader ever sees.
  await convergeFontAvailability(state, options, spreadMode);
  void trackBrowserReaderHostTask(
    state,
    warmInitialResources(state).catch((error: unknown) => {
      state.logger.warn('initial reader resource warm failed', error);
    }),
  );
}

async function warmInitialResources(state: BrowserReaderState): Promise<void> {
  await preloadCurrentReaderFonts(state);
  void warmBrowserReaderFrameWindow(state, state.activeSpreadIndex);
}

export function defineBrowserReaderAccessors(
  reader: Partial<Reader>,
  state: BrowserReaderState,
): void {
  Object.defineProperties(reader, {
    metadata: {
      enumerable: true,
      get: () => normalizePackageMetadata(state.publication.package.metadata),
    },
    totalSpreads: { enumerable: true, get: () => state.revisionBundle.revision.spreadCount },
    pageCount: { enumerable: true, get: () => state.revisionBundle.navigation.pageCount },
    activeSpreadIndex: { enumerable: true, get: () => state.activeSpreadIndex },
    toc: { enumerable: true, get: () => state.publication.package.toc },
    chapterMap: {
      enumerable: true,
      get: () => browserReaderChapterMap(state),
    },
    manifestHrefMap: {
      enumerable: true,
      get: () => browserReaderManifestHrefMap(state),
    },
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
