import { vi, type Mock } from 'vitest';
import type { ReaderOptions } from '../../src/reader';
import type {
  CoreLayoutConfig,
  CoreLineBreaking,
  CoreViewRevisionRequest,
} from '../../src/bindings/browser/core-contracts';
import type {
  BrowserReaderRevisionResult,
  BrowserReaderViewRevisionResult,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import { frameBuffer } from './browser-reader-reflow-state-fixtures';

export {
  chapterNavigation,
  createState,
  frameBuffer,
  revisionResult,
  revisionSummary,
  setRevisionState,
  spreadNavigation,
  spreadNavigationSlot,
} from './browser-reader-reflow-state-fixtures';

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

interface TestActiveChapterPreview {
  readonly chapterIndex: number;
  readonly progress: number;
}

type TestCreateRevision = (
  layoutConfig: CoreLayoutConfig,
  lineBreaking: CoreLineBreaking,
  activeSpreadIndex: number,
  previousRevisionId?: string,
) => Promise<BrowserReaderRevisionResult>;

interface TestWorkerFixture {
  readonly worker: BrowserReaderWorkerClient;
  readonly open: Mock<BrowserReaderWorkerClient['open']>;
  readonly createRevision: Mock<TestCreateRevision>;
  readonly createViewRevision: Mock<BrowserReaderWorkerClient['createViewRevision']>;
  readonly calibrateRevisionFontVerticalMetrics: Mock<
    BrowserReaderWorkerClient['calibrateRevisionFontVerticalMetrics']
  >;
  readonly warmFrameWindow: Mock<BrowserReaderWorkerClient['warmFrameWindowAtRevision']>;
  readonly getPageSemanticsAtRevision: Mock<
    BrowserReaderWorkerClient['getPageSemanticsAtRevision']
  >;
  readonly getPageReadingAnchorAtRevision: Mock<
    BrowserReaderWorkerClient['getPageReadingAnchorAtRevision']
  >;
  readonly getPageTargetsAtRevision: Mock<BrowserReaderWorkerClient['getPageTargetsAtRevision']>;
  readonly getPageTextPositionsAtRevision: Mock<
    BrowserReaderWorkerClient['getPageTextPositionsAtRevision']
  >;
  readonly getTextRangeGeometryAtRevision: Mock<
    BrowserReaderWorkerClient['getTextRangeGeometryAtRevision']
  >;
  readonly resolveTextCaretAtRevision: Mock<
    BrowserReaderWorkerClient['resolveTextCaretAtRevision']
  >;
  readonly resolveTextRangeAtRevision: Mock<
    BrowserReaderWorkerClient['resolveTextRangeAtRevision']
  >;
  readonly resolveTextRangeFromPointsAtRevision: Mock<
    BrowserReaderWorkerClient['resolveTextRangeFromPointsAtRevision']
  >;
  readonly resolveTextRangeToPointAtRevision: Mock<
    BrowserReaderWorkerClient['resolveTextRangeToPointAtRevision']
  >;
  readonly resolveTextSelectionMovementAtRevision: Mock<
    BrowserReaderWorkerClient['resolveTextSelectionMovementAtRevision']
  >;
  readonly resolveExactSourceRangeAtRevision: Mock<
    BrowserReaderWorkerClient['resolveExactSourceRangeAtRevision']
  >;
  readonly getFootnoteAtRevision: Mock<BrowserReaderWorkerClient['getFootnoteAtRevision']>;
  readonly resolveSourceLocatorAtRevision: Mock<
    BrowserReaderWorkerClient['resolveSourceLocatorAtRevision']
  >;
  readonly releaseRevisionTransfers: Mock<
    BrowserReaderWorkerClient['releaseRevisionTransfersAtRevision']
  >;
  readonly releaseRevision: Mock<(revisionId: string) => void>;
  readonly releaseRevisionAtRevision: Mock<BrowserReaderWorkerClient['releaseRevisionAtRevision']>;
  readonly dispose: Mock<BrowserReaderWorkerClient['dispose']>;
  readonly whenDisposed: Mock<BrowserReaderWorkerClient['whenDisposed']>;
  readonly activeChapterPreview: Mock<
    (revisionId: string, spreadIndex: number) => Promise<TestActiveChapterPreview | undefined>
  >;
}

export const BASE_READER_OPTIONS: ReaderOptions = {
  width: 800,
  height: 600,
  margin: 40,
  spread: 'single',
};

let nextTestWorkerSessionId = 1;

export function createWorker(
  onCreateRevision: (deferred: Deferred<BrowserReaderRevisionResult>) => void,
  sessionId = `test-reader-session-${String(nextTestWorkerSessionId++)}`,
): TestWorkerFixture {
  const createRevision = vi.fn((..._args: Parameters<TestCreateRevision>) => {
    const deferred = createDeferred<BrowserReaderRevisionResult>();
    onCreateRevision(deferred);
    return deferred.promise;
  });
  const releaseRevisionTransfers = vi.fn<
    BrowserReaderWorkerClient['releaseRevisionTransfersAtRevision']
  >((revision) => Promise.resolve({ revision, value: 0 }));
  const releaseRevision = vi.fn<(revisionId: string) => void>();
  const releaseRevisionAtRevision = vi.fn<BrowserReaderWorkerClient['releaseRevisionAtRevision']>(
    (revision) => {
      releaseRevision(revision.revisionId);
      return Promise.resolve({
        revision,
        value: { releasedRevision: true, releasedTransferCount: 0 },
      });
    },
  );
  const dispose = vi.fn();
  const whenDisposed = vi.fn<BrowserReaderWorkerClient['whenDisposed']>(() => Promise.resolve());
  const warmFrameWindow = vi.fn<BrowserReaderWorkerClient['warmFrameWindowAtRevision']>(
    (revision, centerSpreadIndex) =>
      Promise.resolve({
        revision,
        value: {
          plan: {
            revisionId: revision.revisionId,
            centerSpreadIndex,
            displaySpreadIndex: centerSpreadIndex,
            spreadIndexes: [centerSpreadIndex],
          },
          frames: [frameBuffer(revision.revisionId, centerSpreadIndex)],
          spreads: [{ spreadIndex: centerSpreadIndex, resources: [], missingResources: [] }],
        },
      }),
  );
  const activeChapterPreview = vi.fn((_revisionId: string, _spreadIndex: number) =>
    Promise.resolve<TestActiveChapterPreview | undefined>(undefined),
  );
  const open = vi.fn<BrowserReaderWorkerClient['open']>();
  const getPageSemanticsAtRevision =
    vi.fn<BrowserReaderWorkerClient['getPageSemanticsAtRevision']>();
  const getPageReadingAnchorAtRevision = vi.fn<
    BrowserReaderWorkerClient['getPageReadingAnchorAtRevision']
  >((revision, pageIndex) =>
    Promise.resolve({
      revision,
      value: {
        status: 'unavailable',
        revisionId: revision.revisionId,
        pageIndex,
        spreadIndex: pageIndex,
        reason: 'noSourceContent',
      },
    }),
  );
  const getPageTargetsAtRevision = vi.fn<BrowserReaderWorkerClient['getPageTargetsAtRevision']>();
  const getPageTextPositionsAtRevision =
    vi.fn<BrowserReaderWorkerClient['getPageTextPositionsAtRevision']>();
  const getTextRangeGeometryAtRevision =
    vi.fn<BrowserReaderWorkerClient['getTextRangeGeometryAtRevision']>();
  const resolveTextCaretAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveTextCaretAtRevision']>();
  const resolveTextRangeAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveTextRangeAtRevision']>();
  const resolveTextRangeFromPointsAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveTextRangeFromPointsAtRevision']>();
  const resolveTextRangeToPointAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveTextRangeToPointAtRevision']>();
  const resolveTextSelectionMovementAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveTextSelectionMovementAtRevision']>();
  const resolveExactSourceRangeAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveExactSourceRangeAtRevision']>();
  const getFootnoteAtRevision = vi.fn<BrowserReaderWorkerClient['getFootnoteAtRevision']>();
  const resolveSourceLocatorAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveSourceLocatorAtRevision']>();
  const createViewRevision = vi.fn((request: CoreViewRevisionRequest) =>
    createViewRevisionResult(request, createRevision, activeChapterPreview),
  );
  const calibrateRevisionFontVerticalMetrics =
    vi.fn<BrowserReaderWorkerClient['calibrateRevisionFontVerticalMetrics']>();
  const worker: BrowserReaderWorkerClient = {
    sessionId,
    open,
    createBoundedRevision: vi.fn<BrowserReaderWorkerClient['createBoundedRevision']>(),
    continueRevision: vi.fn<BrowserReaderWorkerClient['continueRevision']>(),
    calibrateRevisionFontVerticalMetrics,
    cancelRevision: vi.fn<BrowserReaderWorkerClient['cancelRevision']>(),
    getRevisionSummaryAtRevision:
      vi.fn<BrowserReaderWorkerClient['getRevisionSummaryAtRevision']>(),
    getRevisionBundleAtRevision: vi.fn<BrowserReaderWorkerClient['getRevisionBundleAtRevision']>(),
    getRevisionPresentationAtRevision:
      vi.fn<BrowserReaderWorkerClient['getRevisionPresentationAtRevision']>(),
    getShapeProvenanceDiagnosticAtRevision:
      vi.fn<BrowserReaderWorkerClient['getShapeProvenanceDiagnosticAtRevision']>(),
    getRevisionNavigationAtRevision:
      vi.fn<BrowserReaderWorkerClient['getRevisionNavigationAtRevision']>(),
    readFrameBufferAtRevision: vi.fn<BrowserReaderWorkerClient['readFrameBufferAtRevision']>(),
    warmFrameWindowAtRevision: warmFrameWindow,
    getPageSemanticsAtRevision,
    getPageReadingAnchorAtRevision,
    getPageTargetsAtRevision,
    getPageTextPositionsAtRevision,
    getTextRangeGeometryAtRevision,
    resolveTextCaretAtRevision,
    resolveTextRangeAtRevision,
    resolveTextRangeFromPointsAtRevision,
    resolveTextRangeToPointAtRevision,
    resolveTextSelectionMovementAtRevision,
    resolveExactSourceRangeAtRevision,
    getFootnoteAtRevision,
    getFootnotesAtRevision: vi.fn<BrowserReaderWorkerClient['getFootnotesAtRevision']>(),
    getChapterTextIndicesAtRevision:
      vi.fn<BrowserReaderWorkerClient['getChapterTextIndicesAtRevision']>(),
    searchAtRevision: vi.fn<BrowserReaderWorkerClient['searchAtRevision']>(),
    resolveLocatorAtRevision: vi.fn<BrowserReaderWorkerClient['resolveLocatorAtRevision']>(),
    readResourceAtRevision: vi.fn<BrowserReaderWorkerClient['readResourceAtRevision']>(),
    resolveSourceLocatorAtRevision,
    releaseRevisionTransfersAtRevision: releaseRevisionTransfers,
    releaseRevisionAtRevision,
    createViewRevision,
    readResource: vi.fn(),
    warmFrameWindow: vi.fn<BrowserReaderWorkerClient['warmFrameWindow']>(),
    resolveLocator: vi.fn(),
    search: vi.fn(),
    releaseRevisionTransfers: vi.fn<BrowserReaderWorkerClient['releaseRevisionTransfers']>(),
    releaseRevision: vi.fn<BrowserReaderWorkerClient['releaseRevision']>(),
    takeHostLineMetricRequests: vi.fn(
      (): ReturnType<BrowserReaderWorkerClient['takeHostLineMetricRequests']> =>
        Promise.resolve([]),
    ),
    setHostLineMetrics: vi.fn<BrowserReaderWorkerClient['setHostLineMetrics']>(() =>
      Promise.resolve(),
    ),
    setUnavailableFontFaces: vi.fn<BrowserReaderWorkerClient['setUnavailableFontFaces']>(() =>
      Promise.resolve(),
    ),
    createBoundedChapterLocalRevision:
      vi.fn<BrowserReaderWorkerClient['createBoundedChapterLocalRevision']>(),
    continueChapterLocalRevision:
      vi.fn<BrowserReaderWorkerClient['continueChapterLocalRevision']>(),
    releaseChapterLocalRevision: vi.fn<BrowserReaderWorkerClient['releaseChapterLocalRevision']>(),
    dispose,
    whenDisposed,
    chapterFragmentProbe: vi.fn<BrowserReaderWorkerClient['chapterFragmentProbe']>(),
  };
  return {
    worker,
    open,
    createRevision,
    createViewRevision,
    calibrateRevisionFontVerticalMetrics,
    warmFrameWindow,
    getPageSemanticsAtRevision,
    getPageReadingAnchorAtRevision,
    getPageTargetsAtRevision,
    getPageTextPositionsAtRevision,
    getTextRangeGeometryAtRevision,
    resolveTextCaretAtRevision,
    resolveTextRangeAtRevision,
    resolveTextRangeFromPointsAtRevision,
    resolveTextRangeToPointAtRevision,
    resolveTextSelectionMovementAtRevision,
    resolveExactSourceRangeAtRevision,
    getFootnoteAtRevision,
    resolveSourceLocatorAtRevision,
    releaseRevisionTransfers,
    releaseRevision,
    releaseRevisionAtRevision,
    dispose,
    whenDisposed,
    activeChapterPreview,
  };
}

async function createViewRevisionResult(
  request: CoreViewRevisionRequest,
  createRevision: TestCreateRevision,
  activeChapterPreview: (
    revisionId: string,
    spreadIndex: number,
  ) => Promise<TestActiveChapterPreview | undefined>,
): Promise<BrowserReaderViewRevisionResult> {
  const lineBreaking = request.lineBreaking ?? 'greedy';
  const preview =
    request.mode === 'preview' && request.previousRevisionId !== undefined
      ? await activeChapterPreview(request.previousRevisionId, request.activeSpreadIndex)
      : undefined;
  const result =
    request.previousRevisionId === undefined
      ? await createRevision(request.layoutConfig, lineBreaking, request.activeSpreadIndex)
      : await createRevision(
          request.layoutConfig,
          lineBreaking,
          request.activeSpreadIndex,
          request.previousRevisionId,
        );
  const kind =
    request.mode === 'preview' && request.previousRevisionId !== undefined
      ? preview === undefined
        ? 'full'
        : 'preview'
      : request.mode;
  const display =
    kind === 'preview' && request.previousRevisionId !== undefined ? 'visualPreview' : 'revision';
  const followUp =
    kind === 'preview'
      ? {
          delayMs: 1000,
          request: {
            ...request,
            mode: 'full' as const,
            previousRevisionId: request.previousRevisionId ?? result.bundle.revision.revisionId,
          },
        }
      : undefined;
  return {
    kind,
    display,
    ...(followUp !== undefined ? { followUp } : {}),
    result: { ...result, preview: kind === 'preview' },
  };
}

export function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export async function flushPromises(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
