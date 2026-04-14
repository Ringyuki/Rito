import { describe, expect, it } from 'vitest';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import type { ComputedStyle } from '../../src/style/core/types';
import type { InlineSegment } from '../../src/layout/text/styled-segment';
import type { InlineAtom, TextRun } from '../../src/layout/core/types';

function textOf(run: TextRun | InlineAtom | undefined): string | undefined {
  return run?.type === 'text-run' ? run.text : undefined;
}

// With charWidthFactor=0.6 and fontSize=16, each char is 9.6px wide.
const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);

function seg(text: string, style?: Partial<ComputedStyle>): InlineSegment {
  return { text, style: { ...DEFAULT_STYLE, ...style } };
}

describe('GreedyParagraphLayouter', () => {
  describe('basic line breaking', () => {
    it('fits a short text on one line', () => {
      const lines = layouter.layoutParagraph([seg('hello')], 200, 0);
      expect(lines).toHaveLength(1);
      expect(textOf(lines[0]?.runs[0])).toBe('hello');
    });

    it('breaks long text into multiple lines', () => {
      // "one two three four" with width 100
      // Each char is 9.6px. "one two" = 7 chars = 67.2px fits in 100
      // "one two three" = 13 chars = 124.8px > 100 → break
      const lines = layouter.layoutParagraph([seg('one two three four')], 100, 0);
      expect(lines.length).toBeGreaterThan(1);
      // All text should be present
      const allText = lines.map((l) => l.runs.map((r) => textOf(r) ?? '').join('')).join(' ');
      expect(allText).toContain('one');
      expect(allText).toContain('four');
    });

    it('breaks an oversized word at character boundaries', () => {
      // "superlongword" = 13 chars * 9.6 = 124.8px, width 100
      const lines = layouter.layoutParagraph([seg('superlongword')], 100, 0);
      expect(lines.length).toBeGreaterThan(1);
      const allText = lines.flatMap((l) => l.runs.map((r) => textOf(r) ?? '')).join('');
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
  });

  describe('text runs', () => {
    it('produces one run per line', () => {
      const lines = layouter.layoutParagraph([seg('hello world')], 200, 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.runs).toHaveLength(1);
      expect(textOf(lines[0]?.runs[0])).toBe('hello world');
    });
  });

  describe('newlines', () => {
    it('forces a line break on newline characters', () => {
      const lines = layouter.layoutParagraph([seg('line1\nline2')], 400, 0);
      expect(lines).toHaveLength(2);
      expect(textOf(lines[0]?.runs[0])).toBe('line1');
      expect(textOf(lines[1]?.runs[0])).toBe('line2');
    });

    it('handles multiple consecutive newlines', () => {
      const lines = layouter.layoutParagraph([seg('a\n\nb')], 400, 0);
      // Each \n produces its own line break: "a", empty line, "b"
      expect(lines).toHaveLength(3);
      expect(textOf(lines[0]?.runs[0])).toBe('a');
      // lines[1] is the empty line (from first \n → second \n)
      expect(lines[1]?.runs).toHaveLength(0);
      expect(textOf(lines[2]?.runs[0])).toBe('b');
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
      const allText = lines.flatMap((l) => l.runs.map((r) => textOf(r) ?? '')).join('');
      expect(allText).toBe('你好世界测试');
    });

    it('preserves all CJK characters across lines', () => {
      const text = '这是一段很长的中文文本需要多行显示完整内容';
      const lines = layouter.layoutParagraph([seg(text)], 80, 0);
      const allText = lines.flatMap((l) => l.runs.map((r) => textOf(r) ?? '')).join('');
      expect(allText).toBe(text);
    });
  });

  describe('edge cases', () => {
    it('handles leading and trailing spaces', () => {
      const lines = layouter.layoutParagraph([seg('  hello  ')], 200, 0);
      expect(lines).toHaveLength(1);
      expect(textOf(lines[0]?.runs[0])?.trim()).toBe('hello');
    });

    it('handles many segments producing one line', () => {
      const segments = [seg('a '), seg('b '), seg('c')];
      const lines = layouter.layoutParagraph(segments, 200, 0);
      expect(lines).toHaveLength(1);
      expect(textOf(lines[0]?.runs[0])).toContain('a');
    });
  });

  describe('inline margin', () => {
    it('includes inline margin in line-width budget (triggers break)', () => {
      // "aaaa" = 4 chars * 9.6 = 38.4px text. Plus 30+30 margin = 98.4px total.
      // Width 60 → text alone fits, but with margins it must break.
      const segments: InlineSegment[] = [
        { text: 'aaaa', style: DEFAULT_STYLE, inlineMarginLeft: 30, inlineMarginRight: 30 },
      ];
      const lines = layouter.layoutParagraph(segments, 60, 0);
      // Without the margin in the budget, this would fit on one line.
      // With it, we expect it either to break or at least not overflow 60px.
      const firstLine = lines[0];
      expect(firstLine).toBeDefined();
      const runsRightEdge = Math.max(
        ...(firstLine?.runs.map((r) => {
          const trailing = r.type === 'text-run' && r.inlineMarginRight ? r.inlineMarginRight : 0;
          return r.bounds.x + r.bounds.width + trailing;
        }) ?? [0]),
      );
      expect(runsRightEdge).toBeLessThanOrEqual(60 + 0.01);
    });

    it('stamps inlineMarginRight on the last run of the segment', () => {
      const segments: InlineSegment[] = [
        { text: 'hi', style: DEFAULT_STYLE, inlineMarginRight: 5 },
        { text: ' world', style: DEFAULT_STYLE },
      ];
      const lines = layouter.layoutParagraph(segments, 500, 0);
      const runs = lines[0]?.runs ?? [];
      const hiRun = runs.find((r) => r.type === 'text-run' && r.text === 'hi');
      expect(hiRun?.type).toBe('text-run');
      expect((hiRun as TextRun).inlineMarginRight).toBe(5);
    });

    it('offsets subsequent runs by inlineMarginLeft', () => {
      const segments: InlineSegment[] = [
        { text: 'A', style: DEFAULT_STYLE },
        { text: 'B', style: DEFAULT_STYLE, inlineMarginLeft: 10 },
      ];
      const lines = layouter.layoutParagraph(segments, 500, 0);
      const runs = lines[0]?.runs ?? [];
      const aRun = runs.find((r) => r.type === 'text-run' && r.text === 'A') as TextRun;
      const bRun = runs.find((r) => r.type === 'text-run' && r.text === 'B') as TextRun;
      expect(bRun.bounds.x - (aRun.bounds.x + aRun.bounds.width)).toBeGreaterThanOrEqual(10);
    });
  });
});
