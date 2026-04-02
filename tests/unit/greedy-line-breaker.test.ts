import { describe, expect, it } from 'vitest';
import { createGreedyLayouter } from '../../src/layout/greedy-line-breaker';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { ComputedStyle } from '../../src/style/types';
import type { StyledSegment } from '../../src/layout/styled-segment';

// With charWidthFactor=0.6 and fontSize=16, each char is 9.6px wide.
// A space is also 9.6px.
const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CHAR_WIDTH = 16 * 0.6; // 9.6

function seg(text: string, style?: Partial<ComputedStyle>): StyledSegment {
  return { text, style: { ...DEFAULT_STYLE, ...style } };
}

describe('GreedyParagraphLayouter', () => {
  describe('basic line breaking', () => {
    it('fits a short text on one line', () => {
      // "hello" = 5 chars = 48px, width 200 => fits on one line
      const lines = layouter.layoutParagraph([seg('hello')], 200, 0);

      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs).toHaveLength(1);
      expect(lines[0]?.runs[0]?.text).toBe('hello');
    });

    it('breaks long text into multiple lines', () => {
      // "one two three four" with width 100
      // "one" = 3*9.6=28.8, "two" = 28.8, "three" = 48, "four" = 38.4
      // Line 1: "one two" = 28.8 + 9.6 + 28.8 = 67.2 ✓
      // adding "three": 67.2 + 9.6 + 48 = 124.8 > 100 → break
      // Line 2: "three" = 48 ✓
      // adding "four": 48 + 9.6 + 38.4 = 96 ✓
      // Line 2: "three four" = 96 ✓
      const lines = layouter.layoutParagraph([seg('one two three four')], 100, 0);

      expect(lines).toHaveLength(2);
      expect(lines[0]?.runs.map((r) => r.text)).toEqual(['one', 'two']);
      expect(lines[1]?.runs.map((r) => r.text)).toEqual(['three', 'four']);
    });

    it('places a word that exceeds maxWidth alone on its line', () => {
      // "superlongword" = 13*9.6 = 124.8, width 100
      const lines = layouter.layoutParagraph([seg('superlongword')], 100, 0);

      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.text).toBe('superlongword');
    });

    it('returns empty array for empty input', () => {
      const lines = layouter.layoutParagraph([], 200, 0);
      expect(lines).toHaveLength(0);
    });

    it('handles a single space segment', () => {
      const lines = layouter.layoutParagraph([seg(' ')], 200, 0);
      // Space-only content produces no words after splitting
      expect(lines).toHaveLength(0);
    });
  });

  describe('line positioning', () => {
    it('positions lines vertically with correct y offsets', () => {
      // lineHeight 1.5 * fontSize 16 = 24px per line
      const lines = layouter.layoutParagraph([seg('aa bb cc dd')], 50, 0);

      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]?.bounds.y).toBe(0);
      expect(lines[1]?.bounds.y).toBe(24);
      if (lines.length > 2) {
        expect(lines[2]?.bounds.y).toBe(48);
      }
    });

    it('respects startY parameter', () => {
      const lines = layouter.layoutParagraph([seg('hello world')], 200, 100);

      expect(lines[0]?.bounds.y).toBe(100);
    });

    it('sets correct line box width', () => {
      const lines = layouter.layoutParagraph([seg('hello')], 200, 0);

      // "hello" = 5 * 9.6 = 48
      expect(lines[0]?.bounds.width).toBeCloseTo(48);
    });

    it('sets correct line box height', () => {
      const lines = layouter.layoutParagraph([seg('hello')], 200, 0);

      // fontSize=16 * lineHeight=1.5 = 24
      expect(lines[0]?.bounds.height).toBe(24);
    });
  });

  describe('text runs', () => {
    it('positions runs horizontally with spaces between words', () => {
      const lines = layouter.layoutParagraph([seg('hello world')], 200, 0);

      const runs = lines[0]?.runs;
      expect(runs).toHaveLength(2);
      expect(runs?.[0]?.bounds.x).toBe(0);
      // "hello" = 48, space = 9.6, so "world" starts at 57.6
      expect(runs?.[1]?.bounds.x).toBeCloseTo(57.6);
    });

    it('sets correct width on each run', () => {
      const lines = layouter.layoutParagraph([seg('hi there')], 200, 0);

      expect(lines[0]?.runs[0]?.bounds.width).toBeCloseTo(2 * CHAR_WIDTH);
      expect(lines[0]?.runs[1]?.bounds.width).toBeCloseTo(5 * CHAR_WIDTH);
    });
  });

  describe('mixed styles', () => {
    it('preserves per-segment styles in text runs', () => {
      const bold: Partial<ComputedStyle> = { fontWeight: 'bold' };
      const segments = [seg('Hello ', {}), seg('world', bold)];
      const lines = layouter.layoutParagraph(segments, 400, 0);

      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.style.fontWeight).toBe('normal');
      expect(lines[0]?.runs[1]?.style.fontWeight).toBe('bold');
    });

    it('handles mixed font sizes (line height from tallest)', () => {
      const big = { fontSize: 32, lineHeight: 1.5 } as const;
      const segments = [seg('small ', {}), seg('BIG', big)];
      const lines = layouter.layoutParagraph(segments, 400, 0);

      // Line height should be max(16*1.5=24, 32*1.5=48) = 48
      expect(lines[0]?.bounds.height).toBe(48);
    });
  });

  describe('newlines', () => {
    it('forces a line break on newline characters', () => {
      const lines = layouter.layoutParagraph([seg('line1\nline2')], 400, 0);

      expect(lines).toHaveLength(2);
      expect(lines[0]?.runs[0]?.text).toBe('line1');
      expect(lines[1]?.runs[0]?.text).toBe('line2');
    });

    it('handles multiple consecutive newlines', () => {
      const lines = layouter.layoutParagraph([seg('a\n\nb')], 400, 0);

      // "a", then newline (emit "a"), then newline (emit empty), then "b"
      // Empty lines produce no output since they have no words
      expect(lines).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('handles multiple spaces between words', () => {
      const lines = layouter.layoutParagraph([seg('hello    world')], 200, 0);

      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs).toHaveLength(2);
      expect(lines[0]?.runs[0]?.text).toBe('hello');
      expect(lines[0]?.runs[1]?.text).toBe('world');
    });

    it('handles leading and trailing spaces', () => {
      const lines = layouter.layoutParagraph([seg('  hello  ')], 200, 0);

      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.text).toBe('hello');
    });

    it('handles many segments producing one line', () => {
      const segments = [seg('a '), seg('b '), seg('c')];
      const lines = layouter.layoutParagraph(segments, 200, 0);

      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs.map((r) => r.text)).toEqual(['a', 'b', 'c']);
    });
  });
});
