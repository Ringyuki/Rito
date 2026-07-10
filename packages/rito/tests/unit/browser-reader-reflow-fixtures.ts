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
  readonly createRevision: Mock<TestCreateRevision>;
  readonly createViewRevision: Mock<BrowserReaderWorkerClient['createViewRevision']>;
  readonly warmFrameWindow: Mock<BrowserReaderWorkerClient['warmFrameWindow']>;
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

export function createWorker(
  onCreateRevision: (deferred: Deferred<BrowserReaderRevisionResult>) => void,
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
  const createViewRevision = vi.fn((request: CoreViewRevisionRequest) =>
    createViewRevisionResult(request, createRevision, activeChapterPreview),
  );
  const worker: BrowserReaderWorkerClient = {
    open: vi.fn(),
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
    createRevision,
    createViewRevision,
    warmFrameWindow,
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
          mode: 'full' as const,
          delayMs: 1000,
          previousRevisionId: request.previousRevisionId ?? result.bundle.revision.revisionId,
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
