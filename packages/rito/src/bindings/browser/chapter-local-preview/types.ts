import type { ReaderLocator, TocEntry } from '../../../reader';
import type {
  BrowserReaderWorkerClient,
  CoreChapterLocalRevisionRequest,
  CoreChapterLocalOwner,
  CoreChapterLocalRevisionRelease,
  CoreCreatedChapterLocalRevision,
  CoreLayoutConfig,
  CoreReaderChapterLocalFrame,
  CoreReaderChapterLocalMutationResult,
} from '../core-contracts';
import type { BrowserReaderFrame } from '../reader/types';

// Keep browser preview ownership on the canonical core-wasm protocol. These
// aliases deliberately do not recreate a second wire contract in `rito`.
export type BrowserReaderChapterLocalOwner = CoreChapterLocalOwner;
export type BrowserReaderChapterLocalCreateRequest = CoreChapterLocalRevisionRequest;
export type BrowserReaderChapterLocalCreated = CoreCreatedChapterLocalRevision;
export type BrowserReaderChapterLocalFrameBuffer = Pick<
  CoreReaderChapterLocalFrame,
  'owner' | 'localSpreadIndex' | 'metadata' | 'bytes'
>;
export type BrowserReaderChapterLocalResolvedFrame = CoreReaderChapterLocalFrame;
export type BrowserReaderChapterLocalResourceBytes =
  CoreReaderChapterLocalFrame['resources'][number];
export type BrowserReaderChapterLocalMutationResult<
  Created extends CoreCreatedChapterLocalRevision = CoreCreatedChapterLocalRevision,
> = CoreReaderChapterLocalMutationResult<Created>;
export type BrowserReaderChapterLocalRelease = CoreChapterLocalRevisionRelease;

/** Optional Worker capability; absent clients take the ordinary absolute path only. */
export interface BrowserReaderChapterLocalTransport {
  readonly workerSessionId: string;
  disposeSession(): void;
  createChapterLocalRevision(
    request: BrowserReaderChapterLocalCreateRequest,
  ): Promise<BrowserReaderChapterLocalMutationResult>;
  releaseChapterLocalRevision(
    owner: BrowserReaderChapterLocalOwner,
  ): Promise<BrowserReaderChapterLocalRelease>;
}

export interface BrowserReaderChapterLocalPreviewRequest {
  readonly id: number;
  /** Canonical chapter href plus an explicit anchor; private to the local path. */
  readonly locator: ReaderLocator;
  readonly targetChapterIndex: number;
  readonly targetChapterHref: string;
  readonly mountSpreadIndex: number;
  readonly direction: 'forward' | 'backward';
  readonly layoutConfig: CoreLayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly workerSessionId: string;
  readonly tocEntry: TocEntry | undefined;
  readonly transport: BrowserReaderChapterLocalTransport;
  mainSettled: boolean;
}

export interface BrowserReaderChapterLocalPreviewActive {
  readonly request: BrowserReaderChapterLocalPreviewRequest;
  readonly owner: BrowserReaderChapterLocalOwner;
  readonly localSpreadIndex: number;
  readonly frame: BrowserReaderFrame;
  readonly images: Map<string, ImageBitmap>;
  phase: 'paintable' | 'handoff';
  exactSpreadIndex: number | undefined;
  presentationStarted: boolean;
}

export interface BrowserReaderChapterLocalPreviewState {
  nextRequestId: number;
  latestRequestId: number;
  active: BrowserReaderChapterLocalPreviewActive | undefined;
  initialLocator: ReaderLocator | undefined;
}

export type BrowserReaderChapterLocalCapableWorker = BrowserReaderWorkerClient &
  Pick<
    BrowserReaderChapterLocalTransport,
    'createChapterLocalRevision' | 'releaseChapterLocalRevision'
  >;
