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
  readonly warmFrameWindow: Mock<BrowserReaderWorkerClient['warmFrameWindow']>;
  readonly getPageSemanticsAtRevision: Mock<
    BrowserReaderWorkerClient['getPageSemanticsAtRevision']
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
  readonly resolveSameFlowTextRangeAtRevision: Mock<
    BrowserReaderWorkerClient['resolveSameFlowTextRangeAtRevision']
  >;
  readonly resolveExactSourceRangeAtRevision: Mock<
    BrowserReaderWorkerClient['resolveExactSourceRangeAtRevision']
  >;
  readonly getFootnoteAtRevision: Mock<BrowserReaderWorkerClient['getFootnoteAtRevision']>;
  readonly resolveSourceLocatorAtRevision: Mock<
    BrowserReaderWorkerClient['resolveSourceLocatorAtRevision']
  >;
  readonly releaseRevisionTransfers: Mock<BrowserReaderWorkerClient['releaseRevisionTransfers']>;
  readonly releaseRevision: Mock<BrowserReaderWorkerClient['releaseRevision']>;
  readonly dispose: Mock<BrowserReaderWorkerClient['dispose']>;
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
  const releaseRevisionTransfers = vi.fn(() => Promise.resolve());
  const releaseRevision = vi.fn(() => Promise.resolve());
  const dispose = vi.fn();
  const warmFrameWindow = vi.fn((revisionId: string, centerSpreadIndex: number) =>
    Promise.resolve({
      plan: {
        revisionId,
        centerSpreadIndex,
        displaySpreadIndex: centerSpreadIndex,
        spreadIndexes: [centerSpreadIndex],
      },
      frames: [frameBuffer(revisionId, centerSpreadIndex)],
      spreads: [{ spreadIndex: centerSpreadIndex, resources: [] }],
    }),
  );
  const activeChapterPreview = vi.fn((_revisionId: string, _spreadIndex: number) =>
    Promise.resolve<TestActiveChapterPreview | undefined>(undefined),
  );
  const open = vi.fn<BrowserReaderWorkerClient['open']>();
  const getPageSemanticsAtRevision =
    vi.fn<BrowserReaderWorkerClient['getPageSemanticsAtRevision']>();
  const getPageTargetsAtRevision = vi.fn<BrowserReaderWorkerClient['getPageTargetsAtRevision']>();
  const getPageTextPositionsAtRevision =
    vi.fn<BrowserReaderWorkerClient['getPageTextPositionsAtRevision']>();
  const getTextRangeGeometryAtRevision =
    vi.fn<BrowserReaderWorkerClient['getTextRangeGeometryAtRevision']>();
  const resolveTextCaretAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveTextCaretAtRevision']>();
  const resolveSameFlowTextRangeAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveSameFlowTextRangeAtRevision']>();
  const resolveExactSourceRangeAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveExactSourceRangeAtRevision']>();
  const getFootnoteAtRevision = vi.fn<BrowserReaderWorkerClient['getFootnoteAtRevision']>();
  const resolveSourceLocatorAtRevision =
    vi.fn<BrowserReaderWorkerClient['resolveSourceLocatorAtRevision']>();
  const createViewRevision = vi.fn((request: CoreViewRevisionRequest) =>
    createViewRevisionResult(request, createRevision, activeChapterPreview),
  );
  const worker: BrowserReaderWorkerClient = {
    sessionId,
    open,
    createBoundedRevision: vi.fn<BrowserReaderWorkerClient['createBoundedRevision']>(),
    continueRevision: vi.fn<BrowserReaderWorkerClient['continueRevision']>(),
    cancelRevision: vi.fn<BrowserReaderWorkerClient['cancelRevision']>(),
    getRevisionSummaryAtRevision:
      vi.fn<BrowserReaderWorkerClient['getRevisionSummaryAtRevision']>(),
    getShapeProvenanceDiagnosticAtRevision:
      vi.fn<BrowserReaderWorkerClient['getShapeProvenanceDiagnosticAtRevision']>(),
    getRevisionNavigationAtRevision:
      vi.fn<BrowserReaderWorkerClient['getRevisionNavigationAtRevision']>(),
    readFrameBufferAtRevision: vi.fn<BrowserReaderWorkerClient['readFrameBufferAtRevision']>(),
    warmFrameWindowAtRevision: vi.fn<BrowserReaderWorkerClient['warmFrameWindowAtRevision']>(),
    getPageSemanticsAtRevision,
    getPageTargetsAtRevision,
    getPageTextPositionsAtRevision,
    getTextRangeGeometryAtRevision,
    resolveTextCaretAtRevision,
    resolveSameFlowTextRangeAtRevision,
    resolveExactSourceRangeAtRevision,
    getFootnoteAtRevision,
    resolveLocatorAtRevision: vi.fn<BrowserReaderWorkerClient['resolveLocatorAtRevision']>(),
    readResourceAtRevision: vi.fn<BrowserReaderWorkerClient['readResourceAtRevision']>(),
    resolveSourceLocatorAtRevision,
    releaseRevisionTransfersAtRevision:
      vi.fn<BrowserReaderWorkerClient['releaseRevisionTransfersAtRevision']>(),
    releaseRevisionAtRevision: vi.fn<BrowserReaderWorkerClient['releaseRevisionAtRevision']>(),
    createViewRevision,
    readResource: vi.fn(),
    warmFrameWindow,
    resolveLocator: vi.fn(),
    search: vi.fn(),
    releaseRevisionTransfers,
    releaseRevision,
    dispose,
  };
  return {
    worker,
    open,
    createRevision,
    createViewRevision,
    warmFrameWindow,
    getPageSemanticsAtRevision,
    getPageTargetsAtRevision,
    getPageTextPositionsAtRevision,
    getTextRangeGeometryAtRevision,
    resolveTextCaretAtRevision,
    resolveSameFlowTextRangeAtRevision,
    resolveExactSourceRangeAtRevision,
    getFootnoteAtRevision,
    resolveSourceLocatorAtRevision,
    releaseRevisionTransfers,
    releaseRevision,
    dispose,
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
