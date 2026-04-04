import { describe, expect, it } from 'vitest';
import { getSelectedText, getSelectionRects } from '../../src/interaction/selection';
import { buildSearchIndex, search } from '../../src/interaction/search-index';
import { buildHitMap } from '../../src/interaction/hit-map';
import type { LayoutBlock, LineBox, Page, TextRun } from '../../src/layout/core/types';
import type { TextRange } from '../../src/interaction/types';
import type { TextMeasurer } from '../../src/layout/text/text-measurer';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';

const monospaceStyle = { ...DEFAULT_STYLE, fontSize: 10 };

const mockMeasurer: TextMeasurer = {
  measureText: (text: string) => ({ width: text.length * 10, height: 20 }),
};

function makeRun(text: string, x: number, href?: string): TextRun {
  const w = text.length * 10;
  const run: TextRun = {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: w, height: 20 },
    style: monospaceStyle,
  };
  return href ? { ...run, href } : run;
}

function makeLine(runs: TextRun[], y: number): LineBox {
  return { type: 'line-box', bounds: { x: 0, y, width: 300, height: 20 }, runs };
}

function makeBlock(lines: LineBox[]): LayoutBlock {
  return { type: 'layout-block', bounds: { x: 0, y: 0, width: 300, height: 100 }, children: lines };
}

function makePage(blocks: LayoutBlock[], index = 0): Page {
  return { index, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: blocks };
}

describe('getSelectedText', () => {
  const page = makePage([
    makeBlock([
      makeLine([makeRun('Hello ', 0), makeRun('world', 60)], 0),
      makeLine([makeRun('Second line', 0)], 25),
    ]),
  ]);

  it('extracts text within a single run', () => {
    const range: TextRange = {
      start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
      end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 5 },
    };
    expect(getSelectedText(page, range)).toBe('Hello');
  });

  it('extracts text across two runs', () => {
    const range: TextRange = {
      start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 3 },
      end: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 3 },
    };
    expect(getSelectedText(page, range)).toBe('lo wor');
  });

  it('extracts text across lines', () => {
    const range: TextRange = {
      start: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 0 },
      end: { blockIndex: 0, lineIndex: 1, runIndex: 0, charIndex: 6 },
    };
    expect(getSelectedText(page, range)).toBe('worldSecond');
  });

  it('handles reversed range (end before start)', () => {
    const range: TextRange = {
      start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 5 },
      end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
    };
    expect(getSelectedText(page, range)).toBe('Hello');
  });
});

describe('getSelectionRects', () => {
  const page = makePage([
    makeBlock([
      makeLine([makeRun('Hello ', 0), makeRun('world', 60)], 0),
      makeLine([makeRun('Second line', 0)], 25),
    ]),
  ]);
  const hitMap = buildHitMap(page);

  it('returns single rect for selection within one run', () => {
    const range: TextRange = {
      start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 1 },
      end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 4 },
    };
    const rects = getSelectionRects(hitMap, range, mockMeasurer);
    expect(rects).toHaveLength(1);
    expect(rects[0]?.x).toBe(10); // 1 char * 10px
    expect(rects[0]?.width).toBe(30); // 3 chars * 10px
  });

  it('merges rects on same line for cross-run selection', () => {
    const range: TextRange = {
      start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
      end: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 5 },
    };
    const rects = getSelectionRects(hitMap, range, mockMeasurer);
    expect(rects).toHaveLength(1); // merged into one line rect
  });

  it('returns multiple rects for cross-line selection', () => {
    const range: TextRange = {
      start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
      end: { blockIndex: 0, lineIndex: 1, runIndex: 0, charIndex: 6 },
    };
    const rects = getSelectionRects(hitMap, range, mockMeasurer);
    expect(rects.length).toBeGreaterThanOrEqual(2);
  });
});

describe('buildSearchIndex + search', () => {
  const pages = [
    makePage([makeBlock([makeLine([makeRun('The quick brown fox', 0)], 0)])], 0),
    makePage([makeBlock([makeLine([makeRun('jumps over the lazy dog', 0)], 0)])], 1),
  ];
  const index = buildSearchIndex(pages);

  it('finds matches on correct pages', () => {
    const results = search(index, 'the');
    expect(results).toHaveLength(2); // "The" on page 0, "the" on page 1
    expect(results[0]?.pageIndex).toBe(0);
    expect(results[1]?.pageIndex).toBe(1);
  });

  it('supports case-sensitive search', () => {
    const results = search(index, 'The', { caseSensitive: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.pageIndex).toBe(0);
  });

  it('supports whole-word search', () => {
    const results = search(index, 'the', { wholeWord: true });
    // "The" on page 0 and "the" on page 1 both match (case-insensitive + word boundary)
    expect(results).toHaveLength(2);
    // "quick" is not a whole-word match for "qui"
    expect(search(index, 'qui', { wholeWord: true })).toHaveLength(0);
  });

  it('returns empty for no matches', () => {
    expect(search(index, 'xyz')).toHaveLength(0);
  });

  it('returns empty for empty query', () => {
    expect(search(index, '')).toHaveLength(0);
  });

  it('produces correct TextRange for matches', () => {
    const results = search(index, 'quick');
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r?.range.start.charIndex).toBe(4); // "The " = 4 chars
    expect(r?.range.end.charIndex).toBe(9); // "quick" ends at 9
  });

  it('provides context around matches', () => {
    const results = search(index, 'fox');
    expect(results[0]?.context).toContain('fox');
    expect(results[0]?.context).toContain('brown');
  });
});
