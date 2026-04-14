import { describe, expect, it, vi } from 'vitest';
import { createPositionTracker } from '../../src/interaction/position';
import { createSearchEngine } from '../../src/interaction/search';
import type { LayoutBlock, LineBox, Page, Spread, TextRun } from '../../src/layout/core/types';
import { DEFAULT_RUN_PAINT } from '../../src/layout/text/run-paint-from-style';

function makeRun(text: string, x: number): TextRun {
  return {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: text.length * 10, height: 20 },
    paint: DEFAULT_RUN_PAINT,
  };
}

function makeLine(runs: TextRun[], y: number): LineBox {
  return { type: 'line-box', bounds: { x: 0, y, width: 300, height: 20 }, runs };
}

function makeBlock(lines: LineBox[]): LayoutBlock {
  return { type: 'layout-block', bounds: { x: 0, y: 0, width: 300, height: 100 }, children: lines };
}

function makePage(text: string, index: number): Page {
  return {
    index,
    bounds: { x: 0, y: 0, width: 300, height: 400 },
    content: [makeBlock([makeLine([makeRun(text, 0)], 0)])],
  };
}

// --- SearchEngine ---
describe('SearchEngine', () => {
  it('finds results across pages', () => {
    const engine = createSearchEngine();
    engine.setPages([makePage('The quick brown fox', 0), makePage('The lazy dog', 1)]);
    engine.search('The');
    expect(engine.getResults()).toHaveLength(2);
    expect(engine.getActiveIndex()).toBe(0);
  });

  it('navigates results with next/prev', () => {
    const engine = createSearchEngine();
    engine.setPages([makePage('a b a', 0)]);
    engine.search('a');
    expect(engine.getActiveIndex()).toBe(0);
    engine.nextResult();
    expect(engine.getActiveIndex()).toBe(1);
    engine.nextResult();
    expect(engine.getActiveIndex()).toBe(0); // wraps around
    engine.prevResult();
    expect(engine.getActiveIndex()).toBe(1); // wraps back
  });

  it('fires callbacks on search and navigation', () => {
    const engine = createSearchEngine();
    engine.setPages([makePage('hello world', 0)]);
    const resultsCb = vi.fn();
    const activeCb = vi.fn();
    engine.onResultsChange(resultsCb);
    engine.onActiveResultChange(activeCb);

    engine.search('hello');
    expect(resultsCb).toHaveBeenCalledTimes(1);
    expect(activeCb).toHaveBeenCalledTimes(1);

    engine.nextResult();
    expect(activeCb).toHaveBeenCalledTimes(2);
  });

  it('clears results', () => {
    const engine = createSearchEngine();
    engine.setPages([makePage('test', 0)]);
    engine.search('test');
    expect(engine.getResults()).toHaveLength(1);
    engine.clear();
    expect(engine.getResults()).toHaveLength(0);
    expect(engine.getActiveIndex()).toBe(-1);
  });

  it('resets results when pages change', () => {
    const engine = createSearchEngine();
    engine.setPages([makePage('abc', 0)]);
    engine.search('abc');
    expect(engine.getResults()).toHaveLength(1);
    engine.setPages([makePage('xyz', 0)]);
    expect(engine.getResults()).toHaveLength(0);
  });

  it('returns empty for search before setPages', () => {
    const engine = createSearchEngine();
    engine.search('test');
    expect(engine.getResults()).toHaveLength(0);
  });
});

// --- PositionTracker ---
describe('PositionTracker', () => {
  const p0 = makePage('Page 0', 0);
  const p1 = makePage('Page 1', 1);
  const p2 = makePage('Page 2', 2);
  const pages = [p0, p1, p2];
  const spreads: Spread[] = [
    { index: 0, left: p0 },
    { index: 1, left: p1 },
    { index: 2, left: p2 },
  ];
  const chapterMap = new Map([
    ['ch1.xhtml', { startPage: 0, endPage: 1 }],
    ['ch2.xhtml', { startPage: 2, endPage: 2 }],
  ]);

  it('tracks current position', () => {
    const tracker = createPositionTracker(spreads, pages, chapterMap);
    expect(tracker.getCurrent()).toBeNull();
    tracker.update(1);
    const pos = tracker.getCurrent();
    expect(pos?.spreadIndex).toBe(1);
    expect(pos?.pageIndex).toBe(1);
    expect(pos?.chapterHref).toBe('ch1.xhtml');
  });

  it('serializes and restores position', () => {
    const tracker = createPositionTracker(spreads, pages, chapterMap);
    tracker.update(2);
    const json = tracker.serialize();

    const tracker2 = createPositionTracker(spreads, pages, chapterMap);
    const idx = tracker2.restore(json);
    expect(idx).toBe(2);
    expect(tracker2.getCurrent()?.chapterHref).toBe('ch2.xhtml');
  });

  it('returns undefined for invalid serialized data', () => {
    const tracker = createPositionTracker(spreads, pages, chapterMap);
    expect(tracker.restore('not json')).toBeUndefined();
    expect(tracker.restore('{}')).toBeUndefined();
  });

  it('fires position change callbacks', () => {
    const tracker = createPositionTracker(spreads, pages, chapterMap);
    const cb = vi.fn();
    tracker.onPositionChange(cb);
    tracker.update(0);
    expect(cb).toHaveBeenCalledTimes(1);
    const pos = cb.mock.calls[0]?.[0] as { spreadIndex: number } | undefined;
    expect(pos?.spreadIndex).toBe(0);
  });

  it('unsubscribe stops notifications', () => {
    const tracker = createPositionTracker(spreads, pages, chapterMap);
    const cb = vi.fn();
    const unsub = tracker.onPositionChange(cb);
    unsub();
    tracker.update(1);
    expect(cb).not.toHaveBeenCalled();
  });
});
