/**
 * Phase 0 characterization: text decoration & inline border painting.
 *
 * Pins down render-time derived geometry that Phase 2 will push back into
 * the RunPaint layer (RunDecoration.y / thickness / color, RunBorder.startEdge /
 * endEdge). Current behavior:
 *   - underline y = run.y + fontSize
 *   - line-through y = run.y + fontSize * 0.5
 *   - thickness = 1 (hardcoded drawLine lineWidth)
 *   - inline border start/end requires both borderStart/borderEnd flag AND
 *     style !== 'none'
 */
import { describe, expect, it } from 'vitest';
import { drawTextRun } from '../../src/render/text/text-renderer';
import type { TextRun } from '../../src/layout/core/types';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import type { ComputedStyle } from '../../src/style/core/types';
import { runPaintFromStyle } from '../../src/layout/text/run-paint-from-style';
import { createMockCanvasContext, isCall, type CanvasCall } from '../helpers/mock-canvas-context';

function calls(records: readonly unknown[]): CanvasCall[] {
  return (records as ReadonlyArray<CanvasCall>).filter(isCall);
}

interface RunOverrides {
  readonly borderStart?: boolean;
  readonly borderEnd?: boolean;
}

function makeRun(style: ComputedStyle, overrides: RunOverrides = {}): TextRun {
  const start = overrides.borderStart === true;
  const end = overrides.borderEnd === true;
  return {
    type: 'text-run',
    text: 'sample',
    bounds: { x: 0, y: 0, width: 60, height: 24 },
    paint: runPaintFromStyle(style, { start, end }),
  };
}

describe('Phase 0 — text decoration geometry', () => {
  it('underline draws a line at y = run.y + fontSize spanning run.bounds.width', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = { ...DEFAULT_STYLE, textDecoration: 'underline', fontSize: 16 };
    drawTextRun(mock.ctx, makeRun(style), 0, 0);

    // drawLine emits: strokeStyle=color, lineWidth=1, beginPath, moveTo, lineTo, stroke
    const strokes = calls(mock.records).filter((c) => c.method === 'stroke');
    const moveTos = calls(mock.records).filter((c) => c.method === 'moveTo');
    const lineTos = calls(mock.records).filter((c) => c.method === 'lineTo');
    expect(strokes.length).toBeGreaterThan(0);

    // underline: moveTo(0, 0 + 16) → lineTo(0 + 60, 0 + 16)
    expect(moveTos.at(-1)?.args).toEqual([0, 16]);
    expect(lineTos.at(-1)?.args).toEqual([60, 16]);

    const lineWidthSet = mock.getPropertySets('lineWidth');
    expect(lineWidthSet.at(-1)?.value).toBe(1);
  });

  it('line-through draws at y = run.y + fontSize * 0.5', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = { ...DEFAULT_STYLE, textDecoration: 'line-through', fontSize: 20 };
    drawTextRun(mock.ctx, makeRun(style), 0, 0);

    const moveTos = calls(mock.records).filter((c) => c.method === 'moveTo');
    const lineTos = calls(mock.records).filter((c) => c.method === 'lineTo');
    // line-through: moveTo(0, 0 + 10) → lineTo(0 + 60, 0 + 10)
    expect(moveTos.at(-1)?.args).toEqual([0, 10]);
    expect(lineTos.at(-1)?.args).toEqual([60, 10]);
  });

  it('decoration y honors offsetX/offsetY from caller', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = { ...DEFAULT_STYLE, textDecoration: 'underline', fontSize: 12 };
    drawTextRun(mock.ctx, makeRun(style), 100, 50);

    const moveTos = calls(mock.records).filter((c) => c.method === 'moveTo');
    const lineTos = calls(mock.records).filter((c) => c.method === 'lineTo');
    // offsets: x=100, y=50 → underline at (100, 50 + 12) = (100, 62)
    expect(moveTos.at(-1)?.args).toEqual([100, 62]);
    expect(lineTos.at(-1)?.args).toEqual([160, 62]);
  });

  it('textDecoration "none" emits no decoration line', () => {
    const mock = createMockCanvasContext();
    drawTextRun(mock.ctx, makeRun({ ...DEFAULT_STYLE, textDecoration: 'none' }), 0, 0);
    const strokes = calls(mock.records).filter((c) => c.method === 'stroke');
    expect(strokes).toHaveLength(0);
  });

  it('decoration color matches run.style.color (no override)', () => {
    const mock = createMockCanvasContext();
    drawTextRun(
      mock.ctx,
      makeRun({ ...DEFAULT_STYLE, textDecoration: 'underline', color: '#cc0000', fontSize: 10 }),
      0,
      0,
    );
    const strokeStyleSets = mock.getPropertySets('strokeStyle');
    // The last strokeStyle set before stroke() is for the decoration line
    expect(strokeStyleSets.at(-1)?.value).toBe('#cc0000');
  });
});

describe('Phase 0 — inline border draw decisions', () => {
  const borderEdge = { width: 2, color: '#0000ff', style: 'solid' as const };
  const NONE = { width: 2, color: '#0000ff', style: 'none' as const };

  it('draws left border only when borderStart=true AND style !== none', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = { ...DEFAULT_STYLE, borderLeft: borderEdge };
    drawTextRun(mock.ctx, makeRun(style, { borderStart: true }), 0, 0);
    const strokes = calls(mock.records).filter((c) => c.method === 'stroke');
    expect(strokes.length).toBeGreaterThan(0);
  });

  it('skips left border when borderStart=false (even if width>0 and style=solid)', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = { ...DEFAULT_STYLE, borderLeft: borderEdge };
    drawTextRun(mock.ctx, makeRun(style, { borderStart: false }), 0, 0);
    const strokes = calls(mock.records).filter((c) => c.method === 'stroke');
    // No border strokes; no decoration stroke either (textDecoration=none by default)
    expect(strokes).toHaveLength(0);
  });

  it('skips left border when style="none" (even if borderStart=true)', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = { ...DEFAULT_STYLE, borderLeft: NONE };
    drawTextRun(mock.ctx, makeRun(style, { borderStart: true }), 0, 0);
    const strokes = calls(mock.records).filter((c) => c.method === 'stroke');
    expect(strokes).toHaveLength(0);
  });

  it('top/bottom borders draw regardless of borderStart/borderEnd', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = {
      ...DEFAULT_STYLE,
      borderTop: borderEdge,
      borderBottom: borderEdge,
    };
    drawTextRun(mock.ctx, makeRun(style), 0, 0);
    const strokes = calls(mock.records).filter((c) => c.method === 'stroke');
    // Two stroke calls for top + bottom
    expect(strokes.length).toBeGreaterThanOrEqual(2);
  });

  it('right border requires borderEnd=true', () => {
    const style: ComputedStyle = { ...DEFAULT_STYLE, borderRight: borderEdge };
    const withEnd = makeRun(style, { borderEnd: true });
    const withoutEnd = makeRun(style, { borderEnd: false });

    const m1 = createMockCanvasContext();
    drawTextRun(m1.ctx, withEnd, 0, 0);
    const m2 = createMockCanvasContext();
    drawTextRun(m2.ctx, withoutEnd, 0, 0);

    const s1 = calls(m1.records).filter((c) => c.method === 'stroke');
    const s2 = calls(m2.records).filter((c) => c.method === 'stroke');
    expect(s1.length).toBeGreaterThan(0);
    expect(s2).toHaveLength(0);
  });
});

describe('Phase 0 — inline background rect geometry', () => {
  it('inline backgroundColor fills rect excluding padding/border when none set', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = {
      ...DEFAULT_STYLE,
      backgroundColor: '#ffff00',
      fontSize: 16,
    };
    drawTextRun(mock.ctx, makeRun(style), 0, 0);
    const fillRect = calls(mock.records).find((c) => c.method === 'fillRect');
    // width = 60 + 0 padding + 0 border = 60; height = 16 + 0 + 0 = 16
    expect(fillRect?.args).toEqual([0, 0, 60, 16]);
  });

  it('inline background includes padding + border on all sides', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = {
      ...DEFAULT_STYLE,
      backgroundColor: '#ffff00',
      fontSize: 16,
      paddingLeft: 3,
      paddingRight: 4,
      paddingTop: 2,
      paddingBottom: 5,
      borderLeft: { width: 1, color: '#000', style: 'solid' },
      borderRight: { width: 1, color: '#000', style: 'solid' },
      borderTop: { width: 1, color: '#000', style: 'solid' },
      borderBottom: { width: 1, color: '#000', style: 'solid' },
    };
    drawTextRun(mock.ctx, makeRun(style, { borderStart: true, borderEnd: true }), 0, 0);
    const fillRect = calls(mock.records).find((c) => c.method === 'fillRect');
    // x = 0 - 3 - 1 = -4; y = 0 - 2 - 1 = -3
    // width = 60 + 3 + 4 + 1 + 1 = 69; height = 16 + 2 + 5 + 1 + 1 = 25
    expect(fillRect?.args).toEqual([-4, -3, 69, 25]);
  });

  it('inline background with borderRadius > 0 uses path + fill (no fillRect)', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = {
      ...DEFAULT_STYLE,
      backgroundColor: '#ffff00',
      fontSize: 16,
      borderRadius: 4,
    };
    drawTextRun(mock.ctx, makeRun(style), 0, 0);
    const fillRectCount = calls(mock.records).filter((c) => c.method === 'fillRect').length;
    const fillCount = calls(mock.records).filter((c) => c.method === 'fill').length;
    expect(fillRectCount).toBe(0);
    expect(fillCount).toBeGreaterThan(0);
  });
});

describe('Phase 0 — font string composition (current impl)', () => {
  it('sets ctx.font from run.style via buildFontString', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = {
      ...DEFAULT_STYLE,
      fontSize: 18,
      fontWeight: 700,
      fontStyle: 'italic',
      fontFamily: 'Georgia',
    };
    drawTextRun(mock.ctx, makeRun(style), 0, 0);
    const fontSets = mock.getPropertySets('font');
    // Exactly one font set per drawTextRun
    expect(fontSets.length).toBeGreaterThanOrEqual(1);
    const fontValue = String(fontSets[0]?.value);
    // Lock: buildFontString produces "italic 700 18px Georgia"
    expect(fontValue).toContain('italic');
    expect(fontValue).toContain('700');
    expect(fontValue).toContain('18px');
    expect(fontValue).toContain('Georgia');
  });
});

describe('Phase 0 — word/letter spacing property assignment', () => {
  it('non-zero wordSpacing is stringified as "${n}px"', () => {
    const mock = createMockCanvasContext();
    const style: ComputedStyle = { ...DEFAULT_STYLE, wordSpacing: 4 };
    drawTextRun(mock.ctx, makeRun(style), 0, 0);
    const sets = mock.getPropertySets('wordSpacing');
    expect(sets.at(-1)?.value).toBe('4px');
  });

  it('zero wordSpacing is set to empty string', () => {
    const mock = createMockCanvasContext();
    drawTextRun(mock.ctx, makeRun({ ...DEFAULT_STYLE, wordSpacing: 0 }), 0, 0);
    const sets = mock.getPropertySets('wordSpacing');
    expect(sets.at(-1)?.value).toBe('');
  });

  it('non-zero letterSpacing is stringified as "${n}px"', () => {
    const mock = createMockCanvasContext();
    drawTextRun(mock.ctx, makeRun({ ...DEFAULT_STYLE, letterSpacing: 2 }), 0, 0);
    const sets = mock.getPropertySets('letterSpacing');
    expect(sets.at(-1)?.value).toBe('2px');
  });
});
