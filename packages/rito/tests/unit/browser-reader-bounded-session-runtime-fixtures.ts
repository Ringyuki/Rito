import { vi } from 'vitest';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { createWorker } from './browser-reader-reflow-fixtures';

export function createFontGeometryReplacementWorker(
  state: BrowserReaderState,
  snapshot: BrowserReaderBoundedSnapshot,
): BrowserReaderWorkerClient {
  state.fontMetrics.genericSerif = undefined;
  Object.assign(state.ctx, {
    save: vi.fn(),
    restore: vi.fn(),
    measureText: vi.fn(() => ({ width: 16 })),
    font: '',
    wordSpacing: '',
    letterSpacing: '',
  });
  const candidate = createWorker(() => undefined, 'font-geometry-replacement');
  candidate.open.mockResolvedValue({
    publication: state.publication,
    pinnedFontPolicy: state.pinnedFonts.summary,
  });
  const revision = {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
  Object.assign(candidate.worker, {
    createBoundedRevision: vi.fn<BrowserReaderWorkerClient['createBoundedRevision']>(() =>
      Promise.resolve({
        revision,
        value: {
          revision: snapshot.revision,
          previousKnownExtent: { pageCount: 0, spreadCount: 0 },
          newlyKnownPages: {
            startPage: 0,
            endPageExclusive: snapshot.revision.knownExtent.pageCount,
          },
          processedTopLevelNodes: 1,
          continuation: { ...revision, cursor: 'cursor-1' },
        },
      }),
    ),
    getRevisionPresentationAtRevision: vi.fn<
      BrowserReaderWorkerClient['getRevisionPresentationAtRevision']
    >(() => Promise.resolve({ revision, value: snapshot.presentation })),
    getFootnotesAtRevision: vi.fn<BrowserReaderWorkerClient['getFootnotesAtRevision']>(() =>
      Promise.resolve({
        revision,
        value: { revisionId: revision.revisionId, entries: {} },
      }),
    ),
    getChapterTextIndicesAtRevision: vi.fn<
      BrowserReaderWorkerClient['getChapterTextIndicesAtRevision']
    >(() =>
      Promise.resolve({
        revision,
        value: { revisionId: revision.revisionId, entries: {} },
      }),
    ),
  });
  Object.assign(state, { workerFactory: () => candidate.worker });
  return candidate.worker;
}
