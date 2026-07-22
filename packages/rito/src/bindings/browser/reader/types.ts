import type {
  decodeRitoFrameCommandBuffer,
  CoreRevisionBundle,
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
  ReaderPageTargets,
  Spread,
  TocEntry,
} from '../../../reader';
import type { BrowserHostLogger } from '../host-runtime';
import type {
  BrowserReaderBoundedSessionOwner,
  BrowserReaderBoundedSessionSlots,
} from '../reader-session-host';
import type { BrowserReaderChapterLocalPreviewState } from '../chapter-local-preview/types';
import type {
  BrowserReaderImageLoadOutcome,
  BrowserReaderImageResourceError,
} from '../image-resource-error';

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
  /** Identifies the published layout; unlike commitGeneration it survives a pure read-gate restore. */
  readonly publicationGeneration: number;
  /** Identifies the current exact-read lease and changes whenever its gate closes or reopens. */
  readonly commitGeneration: number;
}

export interface BrowserReaderPendingImageLoad {
  readonly task: Promise<BrowserReaderImageLoadOutcome>;
}

export interface BrowserReaderImageResourceFailure {
  readonly revision: BrowserReaderWorkerRevisionHandle;
  readonly error: BrowserReaderImageResourceError;
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

export interface BrowserReaderQueuedReflow {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: CoreLineBreaking;
  readonly token: number;
  readonly onCommitted?: (() => void) | undefined;
}

export interface BrowserReaderReflowState {
  active: BrowserReaderQueuedReflow | undefined;
  token: number;
  microtaskScheduled: boolean;
  queued: BrowserReaderQueuedReflow | undefined;
  lastError: Error | undefined;
}

export interface BrowserReaderWorkerClientFactory {
  (): BrowserReaderWorkerClient;
  dispose?: (() => Promise<void>) | undefined;
}

export interface BrowserReaderState {
  worker: BrowserReaderWorkerClient;
  readonly workerFactory: BrowserReaderWorkerClientFactory;
  readonly decodeFrameCommandBuffer: typeof decodeRitoFrameCommandBuffer;
  documentData: ArrayBuffer;
  readonly pinnedFonts: BrowserReaderPinnedFonts;
  /** Whether reopened worker sessions re-arm the fragment page table. */
  readonly fragmentPagination: boolean;
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
  readonly chapterLocalPreview: BrowserReaderChapterLocalPreviewState;
  disposeTask: Promise<void> | undefined;
  readonly interaction: BrowserReaderInteractionState;
  readonly pendingHostTasks: Set<Promise<unknown>>;
  frames: Map<number, BrowserReaderFrame>;
  pendingImageLoads: Map<string, BrowserReaderPendingImageLoad>;
  imageResourceFailures: Map<string, BrowserReaderImageResourceFailure>;
  /** Exact-revision spread settlements already published to render listeners. */
  settledImageResourceSpreads: Set<string>;
  footnotes: BrowserReaderFootnoteMap;
  chapterTextIndices: BrowserReaderChapterTextIndexMap;
  tocTargets: readonly TocTarget[];
  activeSpreadIndex: number;
  images: Map<string, ImageBitmap>;
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
