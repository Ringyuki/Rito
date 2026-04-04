import { describe, expect, it } from 'vitest';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { ComputedStyle } from '../../src/style/types';
import type { StyledSegment } from '../../src/layout/text/styled-segment';

// With charWidthFactor=0.6 and fontSize=16, each char is 9.6px wide.
const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);

function seg(text: string, style?: Partial<ComputedStyle>): StyledSegment {
  return { text, style: { ...DEFAULT_STYLE, ...style } };
}

describe('GreedyParagraphLayouter', () => {
  describe('basic line breaking', () => {
    it('fits a short text on one line', () => {
      const lines = layouter.layoutParagraph([seg('hello')], 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.text).toBe('hello');
    });

    it('breaks long text into multiple lines', () => {
      // "one two three four" with width 100
      // Each char is 9.6px. "one two" = 7 chars = 67.2px fits in 100
      // "one two three" = 13 chars = 124.8px > 100 → break
      const lines = layouter.layoutParagraph([seg('one two three four')], 100, 0);
      expect(lines.length).toBeGreaterThan(1);
      // All text should be present
      const allText = lines.map((l) => l.runs.map((r) => r.text).join('')).join(' ');
      expect(allText).toContain('one');
      expect(allText).toContain('four');
    });

    it('breaks an oversized word at character boundaries', () => {
      // "superlongword" = 13 chars * 9.6 = 124.8px, width 100
      const lines = layouter.layoutParagraph([seg('superlongword')], 100, 0);
      expect(lines.length).toBeGreaterThan(1);
      const allText = lines.flatMap((l) => l.runs.map((r) => r.text)).join('');
      expect(allText).toBe('superlongword');
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
      expect(lines[1]?.bounds.y).toBe(24); // fontSize=16 * lineHeight=1.5
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
      expect(lines[0]?.bounds.height).toBe(24);
    });
  });

  describe('text runs', () => {
    it('produces one run per line', () => {
      const lines = layouter.layoutParagraph([seg('hello world')], 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs).toHaveLength(1);
      expect(lines[0]?.runs[0]?.text).toBe('hello world');
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
      // "a", newline, empty line (skipped), "b"
      expect(lines).toHaveLength(2);
      expect(lines[0]?.runs[0]?.text).toBe('a');
      expect(lines[1]?.runs[0]?.text).toBe('b');
    });
  });

  describe('text-indent', () => {
    it('indents the first line of a paragraph', () => {
      const segments = [seg('hello world', { textIndent: 32 })];
      const lines = layouter.layoutParagraph(segments, 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.bounds.x).toBeCloseTo(32);
    });

    it('does not indent subsequent lines', () => {
      const segments = [seg('hello world foo bar', { textIndent: 32 })];
      const lines = layouter.layoutParagraph(segments, 90, 0);
      if (lines.length > 1) {
        expect(lines[1]?.runs[0]?.bounds.x).toBeCloseTo(0);
      }
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

    it('does not justify the last line', () => {
      const segments = [seg('hi', { textAlign: 'justify' })];
      const lines = layouter.layoutParagraph(segments, 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.bounds.x).toBeCloseTo(0);
    });
  });

  describe('CJK text', () => {
    it('breaks CJK text at character boundaries', () => {
      // CJK char-width measurer: each char is 16*0.6=9.6px
      // "你好世界测试" = 6 CJK chars = 57.6px
      const lines = layouter.layoutParagraph([seg('你好世界测试')], 40, 0);
      expect(lines.length).toBeGreaterThan(1);
      const allText = lines.flatMap((l) => l.runs.map((r) => r.text)).join('');
      expect(allText).toBe('你好世界测试');
    });

    it('preserves all CJK characters across lines', () => {
      const text = '这是一段很长的中文文本需要多行显示完整内容';
      const lines = layouter.layoutParagraph([seg(text)], 80, 0);
      const allText = lines.flatMap((l) => l.runs.map((r) => r.text)).join('');
      expect(allText).toBe(text);
    });
  });

  describe('edge cases', () => {
    it('handles leading and trailing spaces', () => {
      const lines = layouter.layoutParagraph([seg('  hello  ')], 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.text.trim()).toBe('hello');
    });

    it('handles many segments producing one line', () => {
      const segments = [seg('a '), seg('b '), seg('c')];
      const lines = layouter.layoutParagraph(segments, 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs[0]?.text).toContain('a');
    });
  });
});
