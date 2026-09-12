import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserReaderIncrementalPagination } from '../../src/bindings/browser/reader/reader';
import { createState, createWorker } from './browser-reader-reflow-fixtures';

const mocks = vi.hoisted(() => ({
  ensureBrowserReaderBoundedSpread: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../src/bindings/browser/bounded-session-runtime', () => ({
  ensureBrowserReaderBoundedSpread: mocks.ensureBrowserReaderBoundedSpread,
}));

describe('Browser reader incremental pagination accessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureBrowserReaderBoundedSpread.mockResolvedValue(true);
  });

  it('reports the committed revision as complete', () => {
    const state = readyState();
    const pagination = createBrowserReaderIncrementalPagination(state);

    expect(pagination.complete).toBe(true);
  });

  it('forwards spread growth and cancellation to the bounded session runtime', async () => {
    const state = readyState();
    const pagination = createBrowserReaderIncrementalPagination(state);
    const abort = new AbortController();

    await expect(pagination.ensureSpread(4, abort.signal)).resolves.toBe(true);

    expect(mocks.ensureBrowserReaderBoundedSpread).toHaveBeenCalledWith(state, 4, abort.signal);
  });
});

function readyState(): ReturnType<typeof createState> {
  const state = createState(createWorker(() => undefined).worker);
  state.revisionBundle = {
    ...state.revisionBundle,
    revision: {
      ...state.revisionBundle.revision,
      revisionId: 'ready',
      status: 'complete',
      finalExtent: state.revisionBundle.revision.knownExtent,
    },
  };
  return state;
}
