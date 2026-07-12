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
import type { BrowserReaderPinnedFonts } from '../pinned-fonts';
import type { HostFontMetrics } from '../font-metrics';
import type { CanvasRenderingTarget } from '../rendering';
import type {
  ChapterTextIndex,
  FootnoteEntry,
  LayoutConfig,
  ReaderLocator,
  ReaderLocatorResolution,
  ReaderPageTargets,
  Spread,
  TocEntry,
} from '../../../reader';
import type { BrowserHostLogger } from '../host-runtime';
import type {
  BrowserReaderBoundedSessionOwner,
  BrowserReaderBoundedSessionSlots,
} from '../reader-session-host';

export type { BrowserReaderBoundedSessionOwner, BrowserReaderBoundedSessionSlots };

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

export interface BrowserReaderWorkerRevisionHandle {
  readonly workerSessionId: string;
  readonly revisionId: string;
  readonly revisionVersion: number;
}

export interface BrowserReaderRevisionHandle extends BrowserReaderWorkerRevisionHandle {
  readonly commitGeneration: number;
}

export interface BrowserReaderCachedPageTargets {
  readonly revision: BrowserReaderRevisionHandle;
  readonly value: ReaderPageTargets;
}

export interface BrowserReaderPendingPageTargets {
  readonly revision: BrowserReaderRevisionHandle;
  readonly task: Promise<ReaderPageTargets | undefined>;
}

export interface BrowserReaderInteractionState {
  readonly pageTargets: Map<number, BrowserReaderCachedPageTargets>;
  readonly pendingPageTargets: Map<number, BrowserReaderPendingPageTargets>;
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

export type Logger = BrowserHostLogger;

export interface BrowserReaderVisualPreview {
  readonly revision: BrowserReaderWorkerRevisionHandle;
  readonly baseCommitGeneration: number;
  readonly interactionPolicy: 'disabled';
  readonly spreadIndex: number;
  readonly frame: BrowserReaderFrame;
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: CoreLineBreaking;
  readonly worker: BrowserReaderWorkerClient;
}
export interface BrowserReaderLocatorNavigation {
  readonly locator: ReaderLocator;
  phase: 'probing' | 'full' | 'settling';
  readonly promise: Promise<ReaderLocatorResolution | undefined>;
  readonly complete: (value: ReaderLocatorResolution | undefined) => void;
  readonly fail: (error: unknown) => void;
}
export interface BrowserReaderQueuedReflow {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: CoreLineBreaking;
  readonly token: number;
  readonly onCommitted?: (() => void) | undefined;
  readonly locatorNavigation?: BrowserReaderLocatorNavigation | undefined;
}

export interface BrowserReaderDeferredFullReflow {
  readonly request: BrowserReaderQueuedReflow;
  readonly followUp: NonNullable<CoreReaderViewRevisionResult['followUp']>;
}

export interface BrowserReaderReflowState {
  active: BrowserReaderQueuedReflow | undefined;
  token: number;
  microtaskScheduled: boolean;
  queued: BrowserReaderQueuedReflow | undefined;
  deferred: BrowserReaderDeferredFullReflow | undefined;
  deferredTimer: ReturnType<typeof setTimeout> | undefined;
  locatorNavigation: BrowserReaderLocatorNavigation | undefined;
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
  readonly pinnedFonts: BrowserReaderPinnedFonts;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingTarget;
  readonly fontMetrics: HostFontMetrics;
  readonly publication: CorePublicationInfo;
  readonly logger: Logger;
  config: LayoutConfig;
  spreadMode: 'single' | 'double';
  lineBreaking: CoreLineBreaking;
  bgColor: string;
  fgColor: string | undefined;
  dpr: number;
  revisionBundle: CoreRevisionBundle;
  revisionHandle: BrowserReaderRevisionHandle | undefined;
  commitGeneration: number;
  readonly boundedSessions: BrowserReaderBoundedSessionSlots;
  disposeTask: Promise<void> | undefined;
  visualPreview: BrowserReaderVisualPreview | undefined;
  readonly interaction: BrowserReaderInteractionState;
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
  layoutCommittedListeners: Set<(activeSpreadIndex: number) => void>;
  reflow: BrowserReaderReflowState;
  disposed: boolean;
}

export type BrowserReaderFootnoteMap = ReadonlyMap<string, FootnoteEntry>;
export type BrowserReaderChapterTextIndexMap = ReadonlyMap<string, ChapterTextIndex>;
