import { describe, expect, it, vi } from 'vitest';
import type { Reader, Spread } from '@ritojs/core';
import type { SearchResult } from '@ritojs/core/search';
import { goToSearchResult, type SearchNavDeps } from '../src/controller/engines/search-navigation';

describe('search navigation', () => {
  it('emits spreadChange when a far search jump skips normal navigation', () => {
    const spread = {} as Spread;
    const notifyActiveSpread = vi.fn();
    const emitSpreadChange = vi.fn();
    const navGoToSpread = vi.fn();
    const poolJump = vi.fn();
    const poolEnsureContent = vi.fn();
    const setCurrentSpread = vi.fn();
    const scheduleComposite = vi.fn();

    const reader = {
      findSpread: () => 4,
      spreads: [spread, spread, spread, spread, spread],
      notifyActiveSpread,
    } as unknown as Reader;
    const deps = {
      reader,
      nav: { goToSpread: navGoToSpread },
      pool: { jump: poolJump, ensureContent: poolEnsureContent },
      frameDriver: { scheduleComposite },
      contentRenderer: vi.fn(),
      getCurrentSpread: () => 20,
      setCurrentSpread,
      emitSpreadChange,
    } as unknown as SearchNavDeps;

    goToSearchResult(createSearchResult(12), deps);

    expect(navGoToSpread).not.toHaveBeenCalled();
    expect(poolJump).toHaveBeenCalledWith(4);
    expect(poolEnsureContent).toHaveBeenCalledWith('curr', deps.contentRenderer);
    expect(setCurrentSpread).toHaveBeenCalledWith(4);
    expect(emitSpreadChange).toHaveBeenCalledWith(4);
    expect(notifyActiveSpread).toHaveBeenCalledWith(4);
    expect(scheduleComposite).toHaveBeenCalled();
  });
});

function createSearchResult(pageIndex: number): SearchResult {
  return {
    pageIndex,
    range: {} as SearchResult['range'],
    context: 'match',
  };
}
