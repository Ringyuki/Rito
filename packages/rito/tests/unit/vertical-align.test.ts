import { describe, expect, it } from 'vitest';
import { parseCssDeclarations } from '../../src/style/css/property-parser';
import { parseDisplay, parseVerticalAlign } from '../../src/style/css/value-parsers';
import { getTagStyle } from '../../src/style/core/tag-styles';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import { VERTICAL_ALIGNS, DISPLAY_VALUES } from '../../src/style/core/types';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import type { ComputedStyle } from '../../src/style/core/types';
import type { StyledSegment } from '../../src/layout/text/styled-segment';
import type { TextRun } from '../../src/layout/core/types';

const BASE_FONT_SIZE = 16;
const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);

function seg(text: string, style?: Partial<ComputedStyle>): StyledSegment {
  return { text, style: { ...DEFAULT_STYLE, ...style } };
}

/** Extract the first run from the first line, failing the test if absent. */
function firstRun(segments: readonly StyledSegment[], maxWidth = 200): TextRun {
  const lines = layouter.layoutParagraph(segments, maxWidth, 0);
  expect(lines.length).toBeGreaterThan(0);
  const line = lines[0];
  expect(line).toBeDefined();
  expect(line?.runs.length).toBeGreaterThan(0);
  const run = line?.runs[0];
  expect(run).toBeDefined();
  return run as TextRun;
}

// ── parseVerticalAlign ─────────────────────────────────────────────

describe('parseVerticalAlign', () => {
  it('parses baseline', () => {
    expect(parseVerticalAlign('baseline')).toBe('baseline');
  });

  it('parses top', () => {
    expect(parseVerticalAlign('top')).toBe('top');
  });

  it('parses middle', () => {
    expect(parseVerticalAlign('middle')).toBe('middle');
  });

  it('parses bottom', () => {
    expect(parseVerticalAlign('bottom')).toBe('bottom');
  });

  it('parses super', () => {
    expect(parseVerticalAlign('super')).toBe('super');
  });

  it('parses sub', () => {
    expect(parseVerticalAlign('sub')).toBe('sub');
  });

  it('parses text-top', () => {
    expect(parseVerticalAlign('text-top')).toBe('text-top');
  });

  it('parses text-bottom', () => {
    expect(parseVerticalAlign('text-bottom')).toBe('text-bottom');
  });

  it('returns undefined for invalid values', () => {
    expect(parseVerticalAlign('invalid')).toBeUndefined();
    expect(parseVerticalAlign('10px')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(parseVerticalAlign('SUPER')).toBe('super');
    expect(parseVerticalAlign('Middle')).toBe('middle');
  });
});

// ── parseDisplay with inline-block ─────────────────────────────────

describe('parseDisplay — inline-block', () => {
  it('parses inline-block', () => {
    expect(parseDisplay('inline-block')).toBe('inline-block');
  });

  it('is case-insensitive', () => {
    expect(parseDisplay('INLINE-BLOCK')).toBe('inline-block');
  });
});

// ── PROPERTY_HANDLERS integration ──────────────────────────────────

describe('parseCssDeclarations — vertical-align', () => {
  it('parses vertical-align: super', () => {
    expect(parseCssDeclarations('vertical-align: super', BASE_FONT_SIZE)).toEqual({
      verticalAlign: 'super',
    });
  });

  it('parses vertical-align: sub', () => {
    expect(parseCssDeclarations('vertical-align: sub', BASE_FONT_SIZE)).toEqual({
      verticalAlign: 'sub',
    });
  });

  it('parses vertical-align: middle', () => {
    expect(parseCssDeclarations('vertical-align: middle', BASE_FONT_SIZE)).toEqual({
      verticalAlign: 'middle',
    });
  });

  it('parses vertical-align: baseline', () => {
    expect(parseCssDeclarations('vertical-align: baseline', BASE_FONT_SIZE)).toEqual({
      verticalAlign: 'baseline',
    });
  });

  it('ignores invalid vertical-align values', () => {
    expect(parseCssDeclarations('vertical-align: 10px', BASE_FONT_SIZE)).toEqual({});
  });
});

describe('parseCssDeclarations — display: inline-block', () => {
  it('parses display: inline-block', () => {
    expect(parseCssDeclarations('display: inline-block', BASE_FONT_SIZE)).toEqual({
      display: 'inline-block',
    });
  });
});

// ── tag-styles for sup/sub ─────────────────────────────────────────

describe('tag-styles — sup and sub', () => {
  it('applies super vertical-align to <sup>', () => {
    const style = getTagStyle('sup');
    expect(style).toBeDefined();
    expect(style?.verticalAlign).toBe(VERTICAL_ALIGNS.Super);
    expect(style?.fontSize).toBe(13);
  });

  it('applies sub vertical-align to <sub>', () => {
    const style = getTagStyle('sub');
    expect(style).toBeDefined();
    expect(style?.verticalAlign).toBe(VERTICAL_ALIGNS.Sub);
    expect(style?.fontSize).toBe(13);
  });
});

// ── DEFAULT_STYLE ──────────────────────────────────────────────────

describe('DEFAULT_STYLE — verticalAlign', () => {
  it('defaults to baseline', () => {
    expect(DEFAULT_STYLE.verticalAlign).toBe(VERTICAL_ALIGNS.Baseline);
  });

  it('includes inline-block in DISPLAY_VALUES', () => {
    expect(DISPLAY_VALUES.InlineBlock).toBe('inline-block');
  });
});

// ── Layout: vertical-align y-offset ────────────────────────────────

describe('greedy layouter — vertical-align offsets', () => {
  it('baseline runs have y=0', () => {
    const run = firstRun([seg('hello', { verticalAlign: VERTICAL_ALIGNS.Baseline })]);
    expect(run.bounds.y).toBe(0);
  });

  it('super runs shift line box so run stays at y=0', () => {
    const run = firstRun([seg('x', { verticalAlign: VERTICAL_ALIGNS.Super })]);
    // super raw offset = -6.4, but line box shifts all runs down so min_y = 0
    expect(run.bounds.y).toBeCloseTo(0);
  });

  it('sub runs have positive y offset', () => {
    const run = firstRun([seg('x', { verticalAlign: VERTICAL_ALIGNS.Sub })]);
    // sub shifts down by ~0.2 * fontSize = 0.2 * 16 = 3.2
    expect(run.bounds.y).toBeCloseTo(3.2);
  });

  it('middle runs are centered in line box', () => {
    const run = firstRun([seg('x', { verticalAlign: VERTICAL_ALIGNS.Middle })]);
    // lineHeight = 16 * 1.5 = 24. middle = (24 - 16) / 2 = 4
    expect(run.bounds.y).toBeCloseTo(4);
  });

  it('bottom runs align to bottom of line box', () => {
    const run = firstRun([seg('x', { verticalAlign: VERTICAL_ALIGNS.Bottom })]);
    // lineHeight = 24, fontSize = 16. bottom = 24 - 16 = 8
    expect(run.bounds.y).toBeCloseTo(8);
  });

  it('top runs have y=0', () => {
    const run = firstRun([seg('x', { verticalAlign: VERTICAL_ALIGNS.Top })]);
    expect(run.bounds.y).toBe(0);
  });

  it('text-top runs have y=0', () => {
    const run = firstRun([seg('x', { verticalAlign: VERTICAL_ALIGNS.TextTop })]);
    expect(run.bounds.y).toBe(0);
  });

  it('text-bottom runs align to bottom', () => {
    const run = firstRun([seg('x', { verticalAlign: VERTICAL_ALIGNS.TextBottom })]);
    expect(run.bounds.y).toBeCloseTo(8);
  });

  it('mixed baseline and super runs on same line', () => {
    const segments = [
      seg('normal', { verticalAlign: VERTICAL_ALIGNS.Baseline }),
      seg('sup', { verticalAlign: VERTICAL_ALIGNS.Super }),
    ];
    const lines = layouter.layoutParagraph(segments, 400, 0);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toBeDefined();
    const runs = line?.runs ?? [];
    expect(runs).toHaveLength(2);
    // super raw offset = -6.4, shift = +6.4 → baseline run at 6.4, super run at 0
    expect(runs[0]?.bounds.y).toBeCloseTo(6.4);
    expect(runs[1]?.bounds.y).toBeCloseTo(0);
  });

  it('mixed baseline and sub runs on same line', () => {
    const segments = [seg('normal'), seg('sub', { verticalAlign: VERTICAL_ALIGNS.Sub })];
    const lines = layouter.layoutParagraph(segments, 400, 0);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toBeDefined();
    const runs = line?.runs ?? [];
    expect(runs).toHaveLength(2);
    expect(runs[0]?.bounds.y).toBe(0);
    expect(runs[1]?.bounds.y).toBeCloseTo(3.2);
  });

  it('baseline alignment shifts smaller font down to align baselines', () => {
    // Normal text (16px) + small text (12px), both baseline-aligned
    // lineHeight = 16 * 1.5 = 24
    // baseFontSize = 24 / 1.5 = 16
    // Normal: offset = 0.8 * (16 - 16) = 0
    // Small:  offset = 0.8 * (16 - 12) = 3.2
    const segments = [seg('normal', { fontSize: 16 }), seg('small', { fontSize: 12 })];
    const lines = layouter.layoutParagraph(segments, 400, 0);
    expect(lines).toHaveLength(1);
    const runs = lines[0]?.runs ?? [];
    expect(runs).toHaveLength(2);
    expect(runs[0]?.bounds.y).toBe(0);
    expect(runs[1]?.bounds.y).toBeCloseTo(3.2);
  });

  it('same-size baseline runs still have y=0', () => {
    // When all runs have the same fontSize, baseline = top (no shift)
    const segments = [seg('a', { fontSize: 16 }), seg('b', { fontSize: 16 })];
    const lines = layouter.layoutParagraph(segments, 400, 0);
    const runs = lines[0]?.runs ?? [];
    expect(runs[0]?.bounds.y).toBe(0);
    expect(runs[1]?.bounds.y).toBe(0);
  });

  it('same-size run with different line-height stays at y=0', () => {
    // A span with line-height:1 inside a paragraph with line-height:1.5
    // should NOT shift vertically — baseline alignment depends on font size, not line-height
    const segments = [
      seg('normal', { fontSize: 16, lineHeight: 1.5 }),
      seg('compact', { fontSize: 16, lineHeight: 1 }),
    ];
    const lines = layouter.layoutParagraph(segments, 400, 0);
    const runs = lines[0]?.runs ?? [];
    expect(runs).toHaveLength(2);
    // Both runs have the same fontSize — baseline alignment should give y=0 for both
    expect(runs[0]?.bounds.y).toBe(0);
    expect(runs[1]?.bounds.y).toBe(0);
  });

  it('line box height expands when a run has larger fontSize', () => {
    // Base: fontSize=16, lineHeight=1.5 → baseLineHeight=24
    // Large run: fontSize=32, lineHeight=1.5 → runHeight=48
    // Baseline offset for large run: 0.8*(16-32) = -12.8 (extends above)
    // Effective box: min_top=-12.8, max_bottom=max(24, -12.8+48=35.2) → height=48, yShift=12.8
    const segments = [
      seg('small', { fontSize: 16, lineHeight: 1.5 }),
      seg('BIG', { fontSize: 32, lineHeight: 1.5 }),
    ];
    const lines = layouter.layoutParagraph(segments, 400, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.bounds.height).toBeCloseTo(48);
    // All runs should have non-negative y (shifted down to fit in the line box)
    const runs = lines[0]?.runs ?? [];
    for (const run of runs) {
      expect(run.bounds.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('line box does not shrink when a run has smaller fontSize', () => {
    const segments = [
      seg('normal', { fontSize: 16, lineHeight: 1.5 }),
      seg('tiny', { fontSize: 8, lineHeight: 1.5 }),
    ];
    const lines = layouter.layoutParagraph(segments, 400, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.bounds.height).toBeCloseTo(24);
  });

  it('runs with negative baseline offset are shifted into the line box', () => {
    // Simulates the vol.1 case: base=41.6, larger child=49.92
    // Large run baseline offset: 0.8*(41.6-49.92) = -6.66 (above line box)
    // After shift: large run y=0, small run y shifts down proportionally
    const segments = [
      seg('vol.', { fontSize: 16.64, lineHeight: 1.0 }),
      seg('1', { fontSize: 49.92, lineHeight: 1.0 }),
    ];
    const lines = layouter.layoutParagraph(segments, 400, 0);
    expect(lines).toHaveLength(1);
    const runs = lines[0]?.runs ?? [];
    expect(runs).toHaveLength(2);
    const volRun = runs[0];
    const oneRun = runs[1];
    // The larger "1" run should start at y >= 0 (not negative)
    expect(oneRun?.bounds.y).toBeGreaterThanOrEqual(0);
    // The smaller "vol." run should be shifted further down (baseline aligned)
    expect(volRun?.bounds.y).toBeGreaterThan(oneRun?.bounds.y ?? 0);
    // Run heights reflect their own content height, not the base lineHeight
    expect(volRun?.bounds.height).toBeCloseTo(16.64); // 16.64 * 1.0
    expect(oneRun?.bounds.height).toBeCloseTo(49.92); // 49.92 * 1.0
    // Line box must contain both runs (using run's actual height)
    const lineH = lines[0]?.bounds.height ?? 0;
    for (const run of runs) {
      expect(run.bounds.y).toBeGreaterThanOrEqual(0);
      expect(run.bounds.y + run.bounds.height).toBeLessThanOrEqual(lineH + 0.01);
    }
  });
});
