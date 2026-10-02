import { describe, expect, it, vi } from 'vitest';
import { prefetchBrowserReaderShardsNear } from '../../src/bindings/browser/shard-prefetch';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';

function state(documentData: unknown): {
  readonly state: BrowserReaderState;
  readonly prefetch: ReturnType<typeof vi.fn>;
} {
  const prefetch = vi.fn(() => Promise.resolve());
  return {
    prefetch,
    state: {
      documentData,
      worker: { prefetchShardsNear: prefetch },
      logger: { warn: vi.fn() },
      revisionBundle: {
        navigation: {
          spreads: [
            { spreadIndex: 0, pageIndexes: [0, 1] },
            { spreadIndex: 1, pageIndexes: [2, 3] },
          ],
          chapters: [
            { idref: 'a', href: 'Text/a.xhtml', linear: true, startPage: 0, endPage: 2 },
            { idref: 'b', href: 'Text/b.xhtml', linear: true, startPage: 2, endPage: 4 },
          ],
        },
      },
    } as unknown as BrowserReaderState,
  };
}

describe('browser reader shard prefetch', () => {
  it('orders ahead-of-need supply from the chapter the spread opens with', () => {
    const sharded = state({ skeleton: new ArrayBuffer(1), loadShards: vi.fn() });
    prefetchBrowserReaderShardsNear(sharded.state, 1);
    expect(sharded.prefetch).toHaveBeenCalledWith('Text/b.xhtml');
  });

  it('does nothing for a publication opened from its archive', () => {
    const archive = state(new ArrayBuffer(4));
    prefetchBrowserReaderShardsNear(archive.state, 0);
    expect(archive.prefetch).not.toHaveBeenCalled();
  });
});
