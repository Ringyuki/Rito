import { describe, expect, it, vi } from 'vitest';
import { createPositionTracker } from '../../src/reference/ts-core/interaction/position';
import { createSearchEngine } from '../../src/reference/ts-core/interaction/search';
import type {
  LayoutBlock,
  LineBox,
  Page,
  Spread,
  TextRun,
} from '../../src/reference/ts-core/layout/core/types';
import { DEFAULT_RUN_PAINT } from '../../src/reference/ts-core/layout/text/run-paint-from-style';

function makeRun(text: string, x: number): TextRun {
  return {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: text.length * 10, height: 20 },
    paint: DEFAULT_RUN_PAINT,
  };
}

function makeSourceRun(text: string, nodePath: readonly number[]): TextRun {
  return {
    ...makeRun(text, 0),
    sourceRef: { nodePath },
    sourceText: text,
    sourceTextOffset: 0,
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
  const layout = { spreads, pages, chapterMap };

  it('tracks current position', () => {
    const tracker = createPositionTracker(() => layout);
    expect(tracker.getCurrent()).toBeNull();
    tracker.update(1);
    const pos = tracker.getCurrent();
    expect(pos?.projection.spreadIndex).toBe(1);
    expect(pos?.projection.pageIndex).toBe(1);
    expect(pos?.locator?.spineIdref).toBe('ch1.xhtml');
  });

  it('serializes and restores position', () => {
    const tracker = createPositionTracker(() => layout);
    tracker.update(2);
    const json = tracker.serialize();

    const tracker2 = createPositionTracker(() => layout);
    const idx = tracker2.restore(json);
    expect(idx).toBe(2);
    expect(tracker2.getCurrent()?.locator?.spineIdref).toBe('ch2.xhtml');
  });

  it('restores by projecting the saved locator instead of recapturing page start', () => {
    const oldP0 = {
      ...p0,
      content: [makeBlock([makeLine([makeSourceRun('alpha', [0])], 0)])],
    };
    const oldP1 = {
      ...p1,
      content: [makeBlock([makeLine([makeSourceRun('bravo', [1])], 0)])],
    };
    const chapterTextIndex = {
      href: 'ch1.xhtml',
      normalizedText: 'alphabravo',
      spans: [
        { nodePath: [0], sourceStart: 0, sourceEnd: 5, normalizedStart: 0, normalizedEnd: 5 },
        { nodePath: [1], sourceStart: 0, sourceEnd: 5, normalizedStart: 5, normalizedEnd: 10 },
      ],
    };
    const oldLayout = {
      spreads: [
        { index: 0, left: oldP0 },
        { index: 1, left: oldP1 },
      ],
      pages: [oldP0, oldP1],
      chapterMap: new Map([['ch1.xhtml', { startPage: 0, endPage: 1 }]]),
      chapterTextIndices: new Map([['ch1.xhtml', chapterTextIndex]]),
    };
    const newP0 = {
      ...p0,
      content: [
        makeBlock([makeLine([makeSourceRun('alpha', [0]), makeSourceRun('bravo', [1])], 0)]),
      ],
    };
    const newLayout = {
      spreads: [{ index: 0, left: newP0 }],
      pages: [newP0],
      chapterMap: new Map([['ch1.xhtml', { startPage: 0, endPage: 0 }]]),
      chapterTextIndices: oldLayout.chapterTextIndices,
    };

    const tracker = createPositionTracker(() => oldLayout);
    tracker.update(1);
    const json = tracker.serialize();

    const restored = createPositionTracker(() => newLayout);
    expect(restored.restore(json)).toBe(0);

    expect(restored.getCurrent()?.locator?.sourcePoint?.nodePath).toEqual([1]);
  });

  it('rebases a saved position after layout changes', () => {
    let currentLayout = layout;
    const tracker = createPositionTracker(() => currentLayout);
    tracker.update(1);
    const position = tracker.getCurrent();
    const nextPages = [0, 1, 2, 3, 4].map((index) => makePage(`Page ${String(index)}`, index));
    const nextSpreads: Spread[] = nextPages.map((page, index) => ({ index, left: page }));

    currentLayout = {
      spreads: nextSpreads,
      pages: nextPages,
      chapterMap: new Map([
        ['ch1.xhtml', { startPage: 0, endPage: 3 }],
        ['ch2.xhtml', { startPage: 4, endPage: 4 }],
      ]),
    };

    expect(position ? tracker.resolve(position) : undefined).toBe(3);
  });

  it('returns undefined for invalid serialized data', () => {
    const tracker = createPositionTracker(() => layout);
    expect(tracker.restore('not json')).toBeUndefined();
    expect(tracker.restore('{}')).toBeUndefined();
  });

  it('fires position change callbacks', () => {
    const tracker = createPositionTracker(() => layout);
    const cb = vi.fn();
    tracker.onPositionChange(cb);
    tracker.update(0);
    expect(cb).toHaveBeenCalledTimes(1);
    const pos = cb.mock.calls[0]?.[0] as { projection: { spreadIndex: number } } | undefined;
    expect(pos?.projection.spreadIndex).toBe(0);
  });

  it('unsubscribe stops notifications', () => {
    const tracker = createPositionTracker(() => layout);
    const cb = vi.fn();
    const unsub = tracker.onPositionChange(cb);
    unsub();
    tracker.update(1);
    expect(cb).not.toHaveBeenCalled();
  });
});
