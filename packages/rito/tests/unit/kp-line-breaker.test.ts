import { describe, expect, it } from 'vitest';
import { buildKPItems } from '../../src/layout/line-breaker/kp/builder';
import { createKnuthPlassLayouter } from '../../src/layout/line-breaker/kp';
import { emergencyBreaks, solveKP } from '../../src/layout/line-breaker/kp/solver';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import type { ComputedStyle } from '../../src/style/core/types';
import type { InlineSegment } from '../../src/layout/text/styled-segment';
import type { InlineAtom, RubyAnnotation, TextRun } from '../../src/layout/core/types';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';

function textOf(run: TextRun | InlineAtom | RubyAnnotation | undefined): string | undefined {
  return run?.type === 'text-run' ? run.text : undefined;
}

// With charWidthFactor=0.6 and fontSize=16, each char is 9.6px wide.
const measurer = createMockTextMeasurer(0.6);
const layouter = createKnuthPlassLayouter(measurer);
const greedyLayouter = createGreedyLayouter(measurer);

function seg(text: string, style?: Partial<ComputedStyle>): InlineSegment {
  return { text, style: { ...DEFAULT_STYLE, ...style } };
}

describe('KP Item Building', () => {
  it('builds box and glue items from simple text', () => {
    const items = buildKPItems([seg('hello world')], measurer);
    // Should have: box("hello"), glue, box("world"), finishing glue, finishing penalty
    const boxes = items.filter((i) => i.type === 'box');
    const glues = items.filter((i) => i.type === 'glue');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.type === 'box' && boxes[0].text).toBe('hello');
    expect(boxes[1]?.type === 'box' && boxes[1].text).toBe('world');
    // At least one glue between words + finishing glue
    expect(glues.length).toBeGreaterThanOrEqual(2);
  });

  it('builds correct box widths', () => {
    const items = buildKPItems([seg('hi')], measurer);
    const box = items.find((i) => i.type === 'box');
    expect(box).toBeDefined();
    // "hi" = 2 chars * 16 * 0.6 = 19.2
    if (box?.type === 'box') {
      expect(box.width).toBeCloseTo(19.2);
    }
  });

  it('adds forced break penalty for newlines', () => {
    const items = buildKPItems([seg('a\nb')], measurer);
    const penalties = items.filter((i) => i.type === 'penalty' && i.penalty === -Infinity);
    // One for the newline + one for the finishing forced break
    expect(penalties.length).toBeGreaterThanOrEqual(2);
  });

  it('adds hyphenation penalties for long words', () => {
    // "information" has 11 chars, should get hyphenation points
    const items = buildKPItems([seg('information')], measurer);
    const flaggedPenalties = items.filter((i) => i.type === 'penalty' && i.flagged);
    expect(flaggedPenalties.length).toBeGreaterThan(0);
  });

  it('adds zero-width inter-character glue for CJK text', () => {
    const items = buildKPItems([seg('甲乙丙。丁戊')], measurer);
    const textGlues = items.filter(
      (item) => item.type === 'glue' && item.width === 0 && item.text === '',
    );
    expect(textGlues.length).toBeGreaterThan(1);
  });

  it('keeps CJK optimization glue stretchable when final text justification is inter-word', () => {
    const items = buildKPItems([seg('甲乙丙丁戊', { textJustify: 'inter-word' })], measurer);
    const textGlues = items.filter(
      (item) => item.type === 'glue' && item.width === 0 && item.text === '',
    );
    expect(textGlues.some((item) => item.type === 'glue' && item.stretch > 0)).toBe(true);
    expect(solveKP(items, 28.8)).toBeDefined();
  });

  it('keeps Latin runs grouped inside mixed CJK tokens', () => {
    const items = buildKPItems([seg('ABC甲DEF')], measurer);
    const boxTexts = items.flatMap((item) => (item.type === 'box' ? [item.text] : []));
    expect(boxTexts).toEqual(['ABC', '甲', 'DEF']);
  });

  it('keeps grapheme clusters grouped inside mixed CJK tokens', () => {
    const glyph = '辻\u{E0100}';
    const items = buildKPItems([seg(`${glyph}ABC甲`)], measurer);
    const boxTexts = items.flatMap((item) => (item.type === 'box' ? [item.text] : []));
    expect(boxTexts).toEqual([glyph, 'ABC', '甲']);
  });

  it('groups closing punctuation with the preceding CJK unit', () => {
    const items = buildKPItems([seg('甲乙丙。丁')], measurer);
    const boxTexts = items.flatMap((item) => (item.type === 'box' ? [item.text] : []));
    expect(boxTexts).toEqual(['甲', '乙', '丙。', '丁']);
  });

  it('keeps Latin hyphenation points inside mixed CJK tokens', () => {
    const items = buildKPItems([seg('information甲')], measurer);
    const flaggedPenalties = items.filter((item) => item.type === 'penalty' && item.flagged);
    expect(flaggedPenalties.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty segments', () => {
    const items = buildKPItems([], measurer);
    expect(items).toHaveLength(0);
  });

  it('returns empty array for whitespace-only text', () => {
    const items = buildKPItems([seg('')], measurer);
    expect(items).toHaveLength(0);
  });

  it('ends with a forced break penalty', () => {
    const items = buildKPItems([seg('hello')], measurer);
    const lastItem = items[items.length - 1];
    expect(lastItem?.type).toBe('penalty');
    if (lastItem?.type === 'penalty') {
      expect(lastItem.penalty).toBe(-Infinity);
    }
  });
});

describe('KP Solver', () => {
  it('finds breaks for text that fits on one line', () => {
    const items = buildKPItems([seg('hello world')], measurer);
    // "hello world" = 11 chars * 9.6 = 105.6px, maxWidth=200 → fits on one line
    const breaks = solveKP(items, 200);
    expect(breaks).toBeDefined();
    // Should have exactly one break (the finishing forced break)
    expect(breaks ?? []).toHaveLength(1);
  });

  it('finds breaks for text that needs 2 lines', () => {
    const items = buildKPItems([seg('one two three four')], measurer);
    // Total width: 18 chars * 9.6 = 172.8px, maxWidth=100 → needs 2+ lines
    const breaks = solveKP(items, 100);
    expect(breaks).toBeDefined();
    expect((breaks ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('finds breaks for text that needs 3+ lines', () => {
    const items = buildKPItems([seg('one two three four five six seven')], measurer);
    // Total width: 32 chars * 9.6 = 307.2px, maxWidth=100 → needs 3+ lines
    const breaks = solveKP(items, 100);
    expect(breaks).toBeDefined();
    expect((breaks ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('handles forced breaks from newlines', () => {
    const items = buildKPItems([seg('line1\nline2')], measurer);
    const breaks = solveKP(items, 400);
    expect(breaks).toBeDefined();
    // Should break at newline + final
    expect((breaks ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('finds breakpoints for CJK text without falling back to emergency breaks', () => {
    const items = buildKPItems([seg('甲乙丙。丁戊')], measurer);
    const breaks = solveKP(items, 28.8);
    expect(breaks).toBeDefined();
    expect((breaks ?? []).length).toBeGreaterThan(1);
  });

  it('returns undefined for empty items', () => {
    const breaks = solveKP([], 200);
    expect(breaks).toBeUndefined();
  });
});

describe('Emergency Breaks', () => {
  it('handles a word longer than line width', () => {
    // "superlongword" = 13 chars * 9.6 = 124.8px, maxWidth=50
    const items = buildKPItems([seg('superlongword')], measurer);
    const breaks = emergencyBreaks(items, 50);
    expect(breaks.length).toBeGreaterThan(0);
  });

  it('handles forced breaks', () => {
    const items = buildKPItems([seg('a\nb')], measurer);
    const breaks = emergencyBreaks(items, 400);
    // Should contain a break at the forced penalty
    expect(breaks.length).toBeGreaterThanOrEqual(1);
  });

  it('uses the wider subsequent-line budget after a narrow first line', () => {
    const items = buildKPItems([seg('aaaa bbbb cccc')], measurer);
    const breaks = emergencyBreaks(items, { firstLine: 50, subsequentLines: 100 });

    // First line breaks after "aaaa"; both remaining words then fit together.
    expect(breaks).toHaveLength(2);
  });
});

describe('KnuthPlassLayouter', () => {
  describe('basic line breaking', () => {
    it('fits a short text on one line', () => {
      const lines = layouter.layoutParagraph([seg('hello')], 200, 0);
      expect(lines).toHaveLength(1);
      expect(textOf(lines[0]?.runs[0])).toBe('hello');
    });

    it('breaks long text into multiple lines', () => {
      const lines = layouter.layoutParagraph([seg('one two three four')], 100, 0);
      expect(lines.length).toBeGreaterThan(1);
      // All text should be present
      const allText = lines.map((l) => l.runs.map((r) => textOf(r) ?? '').join('')).join(' ');
      expect(allText).toContain('one');
      expect(allText).toContain('four');
    });

    it('returns empty array for empty input', () => {
      const lines = layouter.layoutParagraph([], 200, 0);
      expect(lines).toHaveLength(0);
    });

    it('handles a single space segment', () => {
      const lines = layouter.layoutParagraph([seg(' ')], 200, 0);
      expect(lines).toHaveLength(0);
    });
  });

  describe('line positioning', () => {
    it('positions lines vertically with correct y offsets', () => {
      const lines = layouter.layoutParagraph([seg('aa bb cc dd ee ff')], 50, 0);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]?.bounds.y).toBe(0);
      expect(lines[1]?.bounds.y).toBe(19.2); // fontSize=16 * lineHeight=1.2
    });

    it('respects startY parameter', () => {
      const lines = layouter.layoutParagraph([seg('hello world')], 200, 100);
      expect(lines[0]?.bounds.y).toBe(100);
    });

    it('sets line box width to maxWidth', () => {
      const lines = layouter.layoutParagraph([seg('hello')], 200, 0);
      expect(lines[0]?.bounds.width).toBe(200);
    });

    it('sets correct line box height', () => {
      const lines = layouter.layoutParagraph([seg('hello')], 200, 0);
      expect(lines[0]?.bounds.height).toBe(19.2);
    });

    it('expands line box and shifts runs for mixed-size baseline (vol.1 case)', () => {
      // Simulates: base fontSize=16, small span=16.64, large span=49.92
      // Large run baseline offset = 0.8*(16-49.92) = -27.14 → extends above line
      // Line box must expand and shift all runs so min_y = 0
      const segments = [
        seg('vol.', { fontSize: 16.64, lineHeight: 1.0 }),
        seg('1', { fontSize: 49.92, lineHeight: 1.0 }),
      ];
      const lines = layouter.layoutParagraph(segments, 400, 0);
      expect(lines).toHaveLength(1);
      const runs = lines[0]?.runs ?? [];
      expect(runs).toHaveLength(2);

      // No run extends above the line box
      for (const run of runs) {
        expect(run.bounds.y).toBeGreaterThanOrEqual(0);
      }

      // Run heights match their own content height
      expect(runs[0]?.bounds.height).toBeCloseTo(16.64);
      expect(runs[1]?.bounds.height).toBeCloseTo(49.92);

      // Line box contains all runs
      const lineH = lines[0]?.bounds.height ?? 0;
      expect(lineH).toBeGreaterThanOrEqual(49.92);
      for (const run of runs) {
        expect(run.bounds.y + run.bounds.height).toBeLessThanOrEqual(lineH + 0.01);
      }
    });
  });

  describe('newlines (forced breaks)', () => {
    it('forces a line break on newline characters', () => {
      const lines = layouter.layoutParagraph([seg('line1\nline2')], 400, 0);
      expect(lines).toHaveLength(2);
      expect(textOf(lines[0]?.runs[0])).toBe('line1');
      expect(textOf(lines[1]?.runs[0])).toBe('line2');
    });

    it('preserves empty lines produced by forced newlines', () => {
      const lines = layouter.layoutParagraph([seg('\nline')], 400, 0);
      expect(lines).toHaveLength(2);
      expect(lines[0]?.runs).toHaveLength(0);
      expect(textOf(lines[1]?.runs[0])).toBe('line');
      expect(lines[1]?.bounds.y).toBe(19.2);
    });
  });

  describe('CJK text', () => {
    function lineTexts(text: string, width: number): string[] {
      return layouter
        .layoutParagraph([seg(text)], width, 0)
        .map((line) => line.runs.map((run) => textOf(run) ?? '').join(''));
    }

    it('avoids starting a line with closing punctuation', () => {
      expect(lineTexts('甲乙丙。丁戊', 28.8)).toEqual(['甲乙', '丙。丁', '戊']);
    });

    it('avoids ending a line with opening punctuation', () => {
      expect(lineTexts('甲乙「丙丁戊', 28.8)).toEqual(['甲乙', '「丙丁', '戊']);
    });

    it('handles long CJK paragraphs without solver blow-up', () => {
      const text = '甲乙丙。丁戊己庚辛壬癸'.repeat(80);
      const lines = layouter.layoutParagraph([seg(text)], 180, 0);
      const allText = lines.flatMap((line) => line.runs.map((run) => textOf(run) ?? '')).join('');
      expect(lines.length).toBeGreaterThan(20);
      expect(allText).toBe(text);
    });

    it('does not break Latin runs into individual letters in mixed CJK text', () => {
      expect(lineTexts('ABC甲乙DEF', 38.4)).toEqual(['ABC甲', '乙DEF']);
    });
  });

  describe('text-indent', () => {
    it('indents the first line of a paragraph', () => {
      const segments = [seg('hello world', { textIndent: 32 })];
      const lines = layouter.layoutParagraph(segments, 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.bounds.x).toBeCloseTo(32);
    });
  });

  describe('text-align', () => {
    it('centers text with text-align: center', () => {
      const segments = [seg('hi', { textAlign: 'center' })];
      const lines = layouter.layoutParagraph(segments, 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.bounds.x).toBeGreaterThan(80);
    });

    it('right-aligns text with text-align: right', () => {
      const segments = [seg('hi', { textAlign: 'right' })];
      const lines = layouter.layoutParagraph(segments, 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.bounds.x).toBeGreaterThan(170);
    });

    it('does not justify the final content line when KP breaks before the terminal penalty', () => {
      const lines = layouter.layoutParagraph([seg('甲乙丙', { textAlign: 'justify' })], 200, 0);
      const firstRun = lines[0]?.runs[0];

      expect(lines).toHaveLength(1);
      expect(textOf(firstRun)).toBe('甲乙丙');
      expect(firstRun?.type === 'text-run' ? firstRun.paint.letterSpacingPx : undefined).toBe(
        undefined,
      );
      expect(firstRun?.bounds.width).toBeCloseTo(28.8);
    });

    it('does not justify a line ending in a forced newline', () => {
      const lines = layouter.layoutParagraph(
        [seg('甲乙丙\n丁戊己', { textAlign: 'justify' })],
        200,
        0,
      );
      const firstRun = lines[0]?.runs[0];

      expect(lines).toHaveLength(2);
      expect(textOf(firstRun)).toBe('甲乙丙');
      expect(firstRun?.type === 'text-run' ? firstRun.paint.letterSpacingPx : undefined).toBe(
        undefined,
      );
      expect(firstRun?.bounds.width).toBeCloseTo(28.8);
    });
  });

  describe('emergency breaks', () => {
    it('handles a word longer than line width', () => {
      // "superlongword" = 13 chars * 9.6 = 124.8px, width 50
      const lines = layouter.layoutParagraph([seg('superlongword')], 50, 0);
      expect(lines.length).toBeGreaterThan(0);
      // All characters should be preserved
      const allText = lines.flatMap((l) => l.runs.map((r) => textOf(r) ?? '')).join('');
      // The text may contain hyphens from hyphenation
      expect(allText.replace(/-/g, '')).toBe('superlongword');
    });
  });

  describe('comparison with greedy', () => {
    it('produces more even line lengths for multi-line text', () => {
      // A paragraph that will produce multiple lines
      const text = 'The quick brown fox jumps over the lazy dog and runs away fast';
      const width = 200;

      const kpLines = layouter.layoutParagraph([seg(text)], width, 0);
      const greedyLines = greedyLayouter.layoutParagraph([seg(text)], width, 0);

      // Both should produce multiple lines
      expect(kpLines.length).toBeGreaterThan(1);
      expect(greedyLines.length).toBeGreaterThan(1);

      // Compute standard deviation of line widths (excluding last line)
      const kpWidths = kpLines
        .slice(0, -1)
        .map((l) => l.runs.reduce((sum, r) => sum + r.bounds.width, 0));
      const greedyWidths = greedyLines
        .slice(0, -1)
        .map((l) => l.runs.reduce((sum, r) => sum + r.bounds.width, 0));

      if (kpWidths.length >= 2 && greedyWidths.length >= 2) {
        const kpStdDev = stdDev(kpWidths);
        const greedyStdDev = stdDev(greedyWidths);
        // KP should produce at least as even lines as greedy
        expect(kpStdDev).toBeLessThanOrEqual(greedyStdDev + 1);
      }
    });
  });

  describe('multiple segments', () => {
    it('handles many segments producing one line', () => {
      const segments = [seg('a '), seg('b '), seg('c')];
      const lines = layouter.layoutParagraph(segments, 200, 0);
      expect(lines).toHaveLength(1);
    });

    it('keeps inter-segment spaces outside bordered inline boxes', () => {
      const bordered: ComputedStyle = {
        ...DEFAULT_STYLE,
        paddingLeft: 4,
        paddingRight: 4,
        borderTop: { width: 2, color: '#00f', style: 'solid' },
        borderRight: { width: 2, color: '#00f', style: 'solid' },
        borderBottom: { width: 2, color: '#00f', style: 'solid' },
        borderLeft: { width: 2, color: '#00f', style: 'solid' },
      };
      const plain: ComputedStyle = { ...DEFAULT_STYLE };
      const segments: InlineSegment[] = [
        { text: 'A', style: bordered, borderStart: true, borderEnd: true },
        { text: ' ', style: plain },
        { text: 'B', style: bordered, borderStart: true, borderEnd: true },
      ];

      const runs = layouter.layoutParagraph(segments, 500, 0)[0]?.runs ?? [];
      const textRuns = runs.filter((run): run is TextRun => run.type === 'text-run');
      const first = textRuns.find((run) => run.text === 'A');
      const second = textRuns.find((run) => run.text === 'B');

      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (!first || !second) return;

      const firstBorderRight =
        first.bounds.x +
        first.bounds.width +
        (first.paint.padding?.right ?? 0) +
        (first.paint.border?.end?.widthPx ?? 0);
      const secondBorderLeft =
        second.bounds.x -
        (second.paint.padding?.left ?? 0) -
        (second.paint.border?.start?.widthPx ?? 0);

      expect(secondBorderLeft - firstBorderRight).toBeGreaterThan(0);
    });

    it('keeps KP-split CJK boxes merged inside one bordered inline segment', () => {
      const bordered: ComputedStyle = {
        ...DEFAULT_STYLE,
        paddingLeft: 5,
        paddingRight: 48,
        borderRight: { width: 3, color: '#f80', style: 'solid' },
        borderBottom: { width: 3, color: '#f80', style: 'solid' },
        borderLeft: { width: 3, color: '#f80', style: 'solid' },
      };
      const lines = layouter.layoutParagraph(
        [{ text: '栉田桔梗', style: bordered, borderStart: true, borderEnd: true }],
        500,
        0,
      );
      const textRuns = (lines[0]?.runs ?? []).filter(
        (run): run is TextRun => run.type === 'text-run',
      );

      expect(textRuns).toHaveLength(1);
      expect(textRuns[0]?.text).toBe('栉田桔梗');
      expect(textRuns[0]?.bounds.x).toBe(8);
      expect(textRuns[0]?.paint.border?.start?.widthPx).toBe(3);
      expect(textRuns[0]?.paint.border?.end?.widthPx).toBe(3);
    });
  });

  describe('inline margin', () => {
    it('stamps inlineMarginRight only on the final run of a wrapped segment', () => {
      // Segment with spaces so KP has breakable glue points; with marginRight
      // that must wrap across multiple lines at width 100.
      const text = 'one two three four five six seven eight nine ten';
      const segments: InlineSegment[] = [{ text, style: DEFAULT_STYLE, inlineMarginRight: 15 }];
      const lines = layouter.layoutParagraph(segments, 100, 0);
      expect(lines.length).toBeGreaterThan(1);

      // Collect all text-runs originating from THIS segment (the only segment in the test)
      const textRuns = lines
        .flatMap((l) => l.runs)
        .filter((r): r is TextRun => r.type === 'text-run');

      const last = textRuns[textRuns.length - 1];
      const middle = textRuns.slice(0, -1);

      expect(last?.inlineMarginRight).toBe(15);
      for (const run of middle) {
        expect(run.inlineMarginRight).toBeUndefined();
      }
    });

    it('offsets subsequent runs by inlineMarginLeft', () => {
      // Use distinct style objects so appendBox does NOT merge A and B into one run.
      const styleA: ComputedStyle = { ...DEFAULT_STYLE };
      const styleB: ComputedStyle = { ...DEFAULT_STYLE };
      const segments: InlineSegment[] = [
        { text: 'A', style: styleA },
        { text: 'B', style: styleB, inlineMarginLeft: 10 },
      ];
      const lines = layouter.layoutParagraph(segments, 500, 0);
      const runs = lines[0]?.runs ?? [];
      const aRun = runs.find((r) => r.type === 'text-run' && r.text === 'A') as TextRun;
      const bRun = runs.find((r) => r.type === 'text-run' && r.text === 'B') as TextRun;
      expect(aRun).toBeDefined();
      expect(bRun).toBeDefined();
      expect(bRun.bounds.x - (aRun.bounds.x + aRun.bounds.width)).toBeGreaterThanOrEqual(10);
    });
  });
});

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
