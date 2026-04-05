// @vitest-environment happy-dom
/**
 * Phase 2 tests: anchor system — chapter text index, selectors, round-trip.
 */
import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { buildChapterTextIndex } from '../../src/interaction/anchors/chapter-text-index';
import {
  sourcePointToOffset,
  offsetToSourcePoint,
} from '../../src/interaction/anchors/source-point';
import {
  createTextQuoteSelector,
  resolveTextQuoteSelector,
} from '../../src/interaction/anchors/quote-match';
import {
  createTextPositionSelector,
  resolveTextPositionSelector,
} from '../../src/interaction/anchors/text-position';
import {
  createProgressionSelector,
  resolveProgressionSelector,
} from '../../src/interaction/anchors/progression';

const SIMPLE_XHTML = '<html><body><p>Hello world</p><p>Second paragraph</p></body></html>';
const INLINE_XHTML = '<html><body><p>Hello <em>beautiful</em> world</p></body></html>';

describe('ChapterTextIndex', () => {
  it('builds normalized text from parsed nodes', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    expect(index.href).toBe('ch1.xhtml');
    expect(index.normalizedText).toContain('Hello world');
    expect(index.normalizedText).toContain('Second paragraph');
    expect(index.spans.length).toBeGreaterThan(0);
  });

  it('maps inline content correctly', () => {
    const { nodes } = parseXhtml(INLINE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    expect(index.normalizedText).toContain('Hello ');
    expect(index.normalizedText).toContain('beautiful');
    expect(index.normalizedText).toContain(' world');
  });

  it('spans have correct nodePaths from parser', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    // Every span should have a non-empty nodePath (from Phase 1 sourceRef)
    for (const span of index.spans) {
      expect(span.nodePath.length).toBeGreaterThan(0);
    }
  });
});

describe('SourcePoint conversion', () => {
  it('sourcePointToOffset resolves a text node position', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    // First text node "Hello world" at [0, 0]
    const firstSpan = index.spans[0];
    expect(firstSpan).toBeDefined();
    const offset = sourcePointToOffset(index, {
      nodePath: firstSpan?.nodePath ?? [],
      textOffset: 5,
    });
    expect(offset).toBe((firstSpan?.normalizedStart ?? 0) + 5);
  });

  it('offsetToSourcePoint returns a valid SourcePoint', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    const point = offsetToSourcePoint(index, 3);
    expect(point).toBeDefined();
    expect(point?.nodePath.length).toBeGreaterThan(0);
  });

  it('round-trip: offset → sourcePoint → offset', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);

    for (let i = 0; i < Math.min(index.normalizedText.length, 20); i++) {
      const point = offsetToSourcePoint(index, i);
      if (!point) continue;
      const backOffset = sourcePointToOffset(index, point);
      expect(backOffset).toBe(i);
    }
  });
});

describe('TextQuoteSelector', () => {
  it('creates selector with exact + prefix + suffix', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    const start = index.normalizedText.indexOf('world');
    const end = start + 'world'.length;
    const selector = createTextQuoteSelector(index, start, end);

    expect(selector.type).toBe('TextQuoteSelector');
    expect(selector.exact).toBe('world');
    expect(selector.prefix).toBeDefined();
    expect(selector.suffix).toBeDefined();
  });

  it('resolves exact match', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    const start = index.normalizedText.indexOf('Hello');
    const selector = createTextQuoteSelector(index, start, start + 5);
    const resolved = resolveTextQuoteSelector(index, selector);

    expect(resolved).toBeDefined();
    expect(resolved?.start).toBe(start);
    expect(resolved?.end).toBe(start + 5);
  });

  it('round-trip: create → resolve returns same range', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    const start = index.normalizedText.indexOf('Second');
    const end = start + 'Second paragraph'.length;
    const selector = createTextQuoteSelector(index, start, end);
    const resolved = resolveTextQuoteSelector(index, selector);

    expect(resolved).toEqual({ start, end });
  });
});

describe('TextPositionSelector', () => {
  it('create + resolve round-trip', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    const selector = createTextPositionSelector(5, 10);
    const resolved = resolveTextPositionSelector(index, selector);
    expect(resolved).toEqual({ start: 5, end: 10 });
  });

  it('rejects out-of-bounds', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    expect(resolveTextPositionSelector(index, createTextPositionSelector(-1, 5))).toBeUndefined();
    expect(
      resolveTextPositionSelector(index, createTextPositionSelector(0, 99999)),
    ).toBeUndefined();
  });
});

describe('ProgressionSelector', () => {
  it('create stores chapter progress', () => {
    const sel = createProgressionSelector(2, 50, 100);
    expect(sel.type).toBe('ProgressionSelector');
    expect(sel.chapter).toBe(2);
    expect(sel.chapterProgress).toBeCloseTo(0.5);
  });

  it('resolve returns approximate offset', () => {
    const { nodes } = parseXhtml(SIMPLE_XHTML);
    const index = buildChapterTextIndex('ch1.xhtml', nodes);
    const sel = createProgressionSelector(0, 0, index.normalizedText.length);
    const offset = resolveProgressionSelector(index, sel);
    expect(offset).toBe(0);
  });
});
