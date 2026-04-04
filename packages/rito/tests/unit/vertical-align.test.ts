import { describe, expect, it } from 'vitest';
import { parseCssDeclarations } from '../../src/style/css-property-parser';
import { parseDisplay, parseVerticalAlign } from '../../src/style/css-value-parsers';
import { getTagStyle } from '../../src/style/tag-styles';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import { VERTICAL_ALIGNS, DISPLAY_VALUES } from '../../src/style/types';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import type { ComputedStyle } from '../../src/style/types';
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

  it('super runs have negative y offset', () => {
    const run = firstRun([seg('x', { verticalAlign: VERTICAL_ALIGNS.Super })]);
    // super shifts up by ~0.4 * fontSize = 0.4 * 16 = -6.4
    expect(run.bounds.y).toBeCloseTo(-6.4);
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
    expect(runs[0]?.bounds.y).toBe(0);
    expect(runs[1]?.bounds.y).toBeCloseTo(-6.4);
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
});
