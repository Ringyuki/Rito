import { describe, expect, it, vi } from 'vitest';
import type { Spread } from '@ritojs/core';
import type { Reader } from '@ritojs/core';
import type { SearchResult } from '../src/interaction/index';
import { goToSearchResult, type SearchNavDeps } from '../src/controller/engines/search-navigation';

describe('search navigation', () => {
  it('emits spreadChange when a far search jump skips normal navigation', () => {
    const spread = {} as Spread;
    const notifyActiveSpread = vi.fn();
    const emitSpreadChange = vi.fn();
    const navGoToSpread = vi.fn();
    const poolJump = vi.fn();
    const poolEnsureContent = vi.fn(() => true);
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
      contentRenderer: vi.fn(() => true),
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

  it('falls back to deferred navigation when far-jump content is not ready', () => {
    const navGoToSpread = vi.fn();
    const poolJump = vi.fn();
    const poolEnsureContent = vi.fn(() => false);
    const setCurrentSpread = vi.fn();
    const emitSpreadChange = vi.fn();
    const reader = {
      findSpread: () => 4,
      spreads: [],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const deps = {
      reader,
      nav: { goToSpread: navGoToSpread },
      pool: { jump: poolJump, ensureContent: poolEnsureContent },
      frameDriver: { scheduleComposite: vi.fn() },
      contentRenderer: vi.fn(() => true),
      getCurrentSpread: () => 20,
      setCurrentSpread,
      emitSpreadChange,
    } as unknown as SearchNavDeps;

    goToSearchResult(createSearchResult(12), deps);

    expect(poolJump).toHaveBeenCalledWith(4);
    expect(poolEnsureContent).toHaveBeenCalledWith('curr', deps.contentRenderer);
    expect(navGoToSpread).toHaveBeenCalledWith(4);
    expect(setCurrentSpread).not.toHaveBeenCalled();
    expect(emitSpreadChange).not.toHaveBeenCalled();
  });
});

function createSearchResult(pageIndex: number): SearchResult {
  return {
    pageIndex,
    range: {} as SearchResult['range'],
    context: 'match',
  };
}
