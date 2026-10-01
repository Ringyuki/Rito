import type {
  decodeRitoFrameCommandBuffer,
  CoreRevisionBundle,
  CoreReaderPrimitive,
  CoreJsonObject,
  CoreLayoutConfig,
  CorePublicationInfo,
  CoreReaderBindingRuntimeModule,
  CoreTocTargets,
  normalizeRitoCoreWasmError,
} from '../core-contracts';
import type { BrowserReaderWorkerClient } from '../core-contracts';
import type { BrowserReaderPinnedFonts } from '../pinned-fonts';
import type { CanvasRenderingTarget } from '../rendering';
import type { FootnoteEntry, LayoutConfig, ReaderPageTargets, Spread } from '../../../reader';
import type { BrowserHostLogger } from '../host-runtime';
import type {
  BrowserReaderRevisionSessionOwner,
  BrowserReaderRevisionSessionSlots,
} from '../reader-session-host';
import type { BrowserReaderChapterLocalPreviewState } from '../chapter-local-preview/types';
import type { BrowserReaderDecodedImage } from '../decoded-image-cache';
import type {
  BrowserReaderImageLoadOutcome,
  BrowserReaderImageResourceError,
} from '../image-resource-error';

export type { BrowserReaderRevisionSessionOwner, BrowserReaderRevisionSessionSlots };

export type { CoreJsonObject, CoreLayoutConfig, CorePublicationInfo };

export interface BrowserReaderFrame {
  readonly revisionId: string;
  readonly spreadIndex: number;
  readonly width: number;
  readonly height: number;
  /** Device pixels per CSS pixel the frame's primitives are resolved at. */
  readonly ratio: number;
  readonly commands: readonly CoreReaderPrimitive[];
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

export type Logger = BrowserHostLogger;

export interface BrowserReaderQueuedReflow {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
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
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: CanvasRenderingTarget;
  readonly publication: CorePublicationInfo;
  readonly logger: Logger;
  config: LayoutConfig;
  spreadMode: 'single' | 'double';
  bgColor: string;
  fgColor: string | undefined;
  dpr: number;
  revisionBundle: CoreRevisionBundle;
  revisionHandle: BrowserReaderRevisionHandle | undefined;
  commitGeneration: number;
  readonly revisionSessions: BrowserReaderRevisionSessionSlots;
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
  tocTargets: CoreTocTargets;
  activeSpreadIndex: number;
  /** Bumped whenever rejected font faces reach the worker after open. */
  fontAvailabilityEpoch: number;
  /** The epoch the currently published revision was laid out under. */
  publishedFontAvailabilityEpoch: number;
  images: Map<string, BrowserReaderDecodedImage>;
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
