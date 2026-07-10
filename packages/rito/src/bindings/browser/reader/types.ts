import type {
  decodeRitoFrameCommandBuffer,
  CoreRevisionBundle,
  CoreReaderViewRevisionResult,
  CoreFrameCommand,
  CoreJsonObject,
  CoreLayoutConfig,
  CoreLineBreaking,
  CorePublicationInfo,
  CoreReaderBindingRuntimeModule,
  normalizeRitoCoreWasmError,
} from '../core-contracts';
import type { BrowserReaderWorkerClient } from '../core-contracts';
import type { CanvasRenderingTarget } from '../rendering';
import type {
  ChapterTextIndex,
  FootnoteEntry,
  LayoutConfig,
  LogLevel,
  Spread,
  TextMeasurer,
  TocEntry,
} from '../../../reader';

export type { CoreJsonObject, CoreLayoutConfig, CoreLineBreaking, CorePublicationInfo };

export interface BrowserReaderFrame {
  readonly revisionId: string;
  readonly spreadIndex: number;
  readonly width: number;
  readonly height: number;
  readonly commands: readonly CoreFrameCommand[];
  readonly commandHash: string;
  readonly resourceRefs: {
    readonly images: readonly string[];
  };
  readonly fontFamilies: readonly string[];
  readonly imageDominated: boolean;
}

export interface BrowserReaderBindingModule extends CoreReaderBindingRuntimeModule {
  readonly decodeRitoFrameCommandBuffer: typeof decodeRitoFrameCommandBuffer;
  readonly normalizeRitoCoreWasmError: typeof normalizeRitoCoreWasmError;
}

export interface TocTarget {
  readonly entry: TocEntry;
  readonly pageIndex: number;
  readonly spreadIndex: number;
}

export interface Logger {
  readonly debug: (message: string, ...args: readonly unknown[]) => void;
  readonly info: (message: string, ...args: readonly unknown[]) => void;
  readonly warn: (message: string, ...args: readonly unknown[]) => void;
  readonly error: (message: string, ...args: readonly unknown[]) => void;
}

const LOG_LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const noop = (): void => {};

export function createLogger(level: LogLevel = 'warn'): Logger {
  const threshold = LOG_LEVEL_PRIORITY[level];
  return {
    debug: threshold <= LOG_LEVEL_PRIORITY.debug ? consoleMethod('debug') : noop,
    info: threshold <= LOG_LEVEL_PRIORITY.info ? consoleMethod('info') : noop,
    warn: threshold <= LOG_LEVEL_PRIORITY.warn ? consoleMethod('warn') : noop,
    error: threshold <= LOG_LEVEL_PRIORITY.error ? consoleMethod('error') : noop,
  };
}

function consoleMethod(
  method: 'debug' | 'info' | 'warn' | 'error',
): (message: string, ...args: readonly unknown[]) => void {
  return (message, ...args): void => {
    // eslint-disable-next-line no-console
    console[method](`[rito] ${message}`, ...args);
  };
}

export interface BrowserReaderVisualPreview {
  readonly revisionId: string;
  readonly spreadIndex: number;
  readonly frame: BrowserReaderFrame;
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: CoreLineBreaking;
  readonly worker: BrowserReaderWorkerClient;
}

export interface BrowserReaderQueuedReflow {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: CoreLineBreaking;
  readonly token: number;
  readonly onCommitted?: (() => void) | undefined;
}

export interface BrowserReaderDeferredFullReflow {
  readonly request: BrowserReaderQueuedReflow;
  readonly followUp: NonNullable<CoreReaderViewRevisionResult['followUp']>;
}

export interface BrowserReaderReflowState {
  active: boolean;
  token: number;
  microtaskScheduled: boolean;
  queued: BrowserReaderQueuedReflow | undefined;
  deferred: BrowserReaderDeferredFullReflow | undefined;
  deferredTimer: ReturnType<typeof setTimeout> | undefined;
  lastError: Error | undefined;
}

export type BrowserReaderWorkerClientFactory = () => BrowserReaderWorkerClient;

export interface BrowserReaderState {
  worker: BrowserReaderWorkerClient;
  foregroundWorker: BrowserReaderWorkerClient;
  readonly workerFactory: BrowserReaderWorkerClientFactory;
  fullReflowWorker: BrowserReaderWorkerClient | undefined;
  fullReflowOpenPromise: Promise<void> | undefined;
  readonly decodeFrameCommandBuffer: typeof decodeRitoFrameCommandBuffer;
  readonly documentData: ArrayBuffer;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingTarget;
  readonly publication: CorePublicationInfo;
  readonly logger: Logger;
  config: LayoutConfig;
  spreadMode: 'single' | 'double';
  lineBreaking: CoreLineBreaking;
  bgColor: string;
  fgColor: string | undefined;
  dpr: number;
  revisionBundle: CoreRevisionBundle;
  visualPreview: BrowserReaderVisualPreview | undefined;
  frames: Map<number, BrowserReaderFrame>;
  pendingImageLoads: Map<string, Promise<void>>;
  footnotes: BrowserReaderFootnoteMap;
  chapterTextIndices: BrowserReaderChapterTextIndexMap;
  tocTargets: readonly TocTarget[];
  activeSpreadIndex: number;
  images: Map<string, ImageBitmap>;
  imageObjectUrls: Map<string, string>;
  registeredFontFaces: Map<string, FontFace>;
  spreadRenderedListeners: Set<(spreadIndex: number, spread: Spread) => void>;
  spreadContentInvalidatedListeners: Set<(spreadIndex: number) => void>;
  fontSizeOverride: number | undefined;
  lineHeightOverride: number | undefined;
  lineHeightForce: boolean;
  fontFamilyOverride: string | undefined;
  fontFamilyForce: boolean;
  pendingFrameLoads: Map<number, Promise<void>>;
  layoutCommittedListeners: Set<() => void>;
  reflow: BrowserReaderReflowState;
  disposed: boolean;
}

export const fallbackTextMeasurer: TextMeasurer = {
  measureText(text) {
    return { width: text.length * 8, height: 16 };
  },
};

export type BrowserReaderFootnoteMap = ReadonlyMap<string, FootnoteEntry>;
export type BrowserReaderChapterTextIndexMap = ReadonlyMap<string, ChapterTextIndex>;
