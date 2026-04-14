import { describe, expect, it } from 'vitest';
import { applyAlign } from '../../src/layout/text/text-align';
import { DEFAULT_RUN_PAINT } from '../../src/layout/text/run-paint-from-style';
import type { TextRun } from '../../src/layout/core/types';

function makeRun(text: string, x: number, width: number): TextRun {
  return {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width, height: 16 },
    paint: DEFAULT_RUN_PAINT,
  };
}

describe('applyAlign', () => {
  const maxWidth = 400;
  const lineHeight = 24;
  const y = 100;

  describe('left alignment', () => {
    it('does not shift runs', () => {
      const runs = [makeRun('Hello', 0, 50), makeRun(' world', 50, 60)];
      const line = applyAlign(runs, 110, y, lineHeight, maxWidth, 'left', false);
      expect(line.runs[0]?.bounds.x).toBe(0);
      expect(line.runs[1]?.bounds.x).toBe(50);
    });

    it('returns correct line box bounds', () => {
      const runs = [makeRun('Test', 0, 40)];
      const line = applyAlign(runs, 40, y, lineHeight, maxWidth, 'left', false);
      expect(line.type).toBe('line-box');
      expect(line.bounds).toEqual({ x: 0, y, width: maxWidth, height: lineHeight });
    });
  });

  describe('center alignment', () => {
    it('shifts runs by half the remaining space', () => {
      const runs = [makeRun('Hi', 0, 100)];
      const lineWidth = 100;
      const line = applyAlign(runs, lineWidth, y, lineHeight, maxWidth, 'center', false);
      const expectedOffset = (maxWidth - lineWidth) / 2; // 150
      expect(line.runs[0]?.bounds.x).toBe(expectedOffset);
    });

    it('shifts multiple runs by the same offset', () => {
      const runs = [makeRun('A', 0, 40), makeRun('B', 40, 60)];
      const lineWidth = 100;
      const line = applyAlign(runs, lineWidth, y, lineHeight, maxWidth, 'center', false);
      const offset = (maxWidth - lineWidth) / 2;
      expect(line.runs[0]?.bounds.x).toBe(0 + offset);
      expect(line.runs[1]?.bounds.x).toBe(40 + offset);
    });
  });

  describe('right alignment', () => {
    it('shifts runs to the right edge', () => {
      const runs = [makeRun('End', 0, 80)];
      const lineWidth = 80;
      const line = applyAlign(runs, lineWidth, y, lineHeight, maxWidth, 'right', false);
      const offset = maxWidth - lineWidth; // 320
      expect(line.runs[0]?.bounds.x).toBe(offset);
    });

    it('preserves relative spacing between runs', () => {
      const runs = [makeRun('A', 0, 30), makeRun('B', 30, 50)];
      const lineWidth = 80;
      const line = applyAlign(runs, lineWidth, y, lineHeight, maxWidth, 'right', false);
      const offset = maxWidth - lineWidth;
      expect((line.runs[1]?.bounds.x ?? 0) - (line.runs[0]?.bounds.x ?? 0)).toBe(30);
      expect(line.runs[0]?.bounds.x).toBe(offset);
    });
  });

  describe('justify alignment', () => {
    it('expands runs with spaces when not last line', () => {
      const runs = [makeRun('Hello world test', 0, 200)];
      const lineWidth = 200;
      const line = applyAlign(runs, lineWidth, y, lineHeight, maxWidth, 'justify', false);
      // 2 spaces in "Hello world test" -> 2 gaps
      // extra = (400 - 200) / 2 = 100 per gap
      // Run width should be expanded by 2 * 100 = 200
      expect(line.runs[0]?.bounds.width).toBe(200 + 200);
    });

    it('does not expand the last line (treated as left)', () => {
      const runs = [makeRun('Hello world', 0, 120)];
      const lineWidth = 120;
      const line = applyAlign(runs, lineWidth, y, lineHeight, maxWidth, 'justify', true);
      expect(line.runs[0]?.bounds.x).toBe(0);
      expect(line.runs[0]?.bounds.width).toBe(120);
    });
  });

  describe('empty runs', () => {
    it('returns a line box with no runs', () => {
      const line = applyAlign([], 0, y, lineHeight, maxWidth, 'left', false);
      expect(line.runs).toHaveLength(0);
      expect(line.bounds).toEqual({ x: 0, y, width: maxWidth, height: lineHeight });
    });

    it('handles center with empty runs', () => {
      const line = applyAlign([], 0, y, lineHeight, maxWidth, 'center', false);
      expect(line.runs).toHaveLength(0);
    });

    it('handles justify with empty runs', () => {
      const line = applyAlign([], 0, y, lineHeight, maxWidth, 'justify', false);
      expect(line.runs).toHaveLength(0);
    });
  });
});
