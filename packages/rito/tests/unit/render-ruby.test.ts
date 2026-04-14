/**
 * Phase 2 characterization: ruby annotation render.
 *
 * Post-Phase-2, ruby is an independent `RubyAnnotation` LineBox child produced
 * by the layout's text-align pass. The renderer just consumes `ruby.bounds`
 * and `ruby.paint` — there is no on-the-fly grouping or geometry derivation.
 *
 * These tests pin the render-time behavior:
 *   - rubyX = offsetX + ruby.bounds.x + (ruby.bounds.width - measured.width) / 2
 *   - rubyY = offsetY + ruby.bounds.y
 *   - ctx.font is derived from ruby.paint.font (e.g. sizePx=10 for a 20px base)
 *   - base text fillText still runs for each adjacent TextRun
 *   - drawRubyAnnotation is wrapped in save/restore
 *
 * Contiguous-group formation is a LAYOUT responsibility (see text-align tests);
 * here we only verify that a single RubyAnnotation spanning a group is
 * rendered exactly once.
 */
import { describe, expect, it } from 'vitest';
import { renderBlock } from '../../src/render/page/block-renderer';
import type {
  LayoutBlock,
  LineBox,
  Rect,
  RubyAnnotation,
  RunPaint,
  TextRun,
} from '../../src/layout/core/types';
import { DEFAULT_RUN_PAINT } from '../../src/layout/text/run-paint-from-style';
import type { CanvasCall, CanvasPropertySet, CanvasRecord } from '../helpers/mock-canvas-context';
import { isCall } from '../helpers/mock-canvas-context';

/**
 * Variant mock that also stubs ctx.measureText so drawRubyAnnotation's
 * horizontal-centering calculation doesn't blow up on `undefined.width`.
 */
function createRubyMockContext(): {
  ctx: CanvasRenderingContext2D;
  records: readonly CanvasRecord[];
} {
  const records: CanvasRecord[] = [];
  const measureText = (text: string): TextMetrics => {
    records.push({ method: 'measureText', args: [text] });
    // Fake advance = 10 per char. Ink bounds match.
    return {
      width: text.length * 10,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 10,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
    } as TextMetrics;
  };

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === 'toJSON') return undefined;
      if (prop === 'measureText') return measureText;
      return (...args: unknown[]) => {
        records.push({ method: prop, args });
      };
    },
    set(_target, prop: string, value: unknown) {
      records.push({ property: prop, value });
      return true;
    },
  };
  const ctx = new Proxy(
    {} as Record<string, unknown>,
    handler,
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, records };
}

function calls(records: readonly CanvasRecord[]): CanvasCall[] {
  return records.filter(isCall);
}

function makeRun(
  text: string,
  x: number,
  width: number,
  paint: RunPaint = DEFAULT_RUN_PAINT,
): TextRun {
  return {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width, height: 24 },
    paint,
  };
}

function makeRubyPaint(baseFontSizePx: number, family = 'serif'): RunPaint {
  return {
    ...DEFAULT_RUN_PAINT,
    font: { ...DEFAULT_RUN_PAINT.font, sizePx: baseFontSizePx * 0.5, family },
  };
}

/** Build a RubyAnnotation node whose bounds cover `[baseX, baseX+baseWidth]`
 *  horizontally and whose Y mirrors what the layout's text-align pass emits:
 *    bounds.y = baseY - baseFontSize * 0.5 - 1
 *  Vertical height is `baseFontSize * 0.5` (same as paint.font.sizePx).
 */
function makeRuby(
  text: string,
  baseX: number,
  baseY: number,
  baseWidth: number,
  baseFontSize: number,
): RubyAnnotation {
  const annotationFont = baseFontSize * 0.5;
  const bounds: Rect = {
    x: baseX,
    y: baseY - annotationFont - 1,
    width: baseWidth,
    height: annotationFont,
  };
  return {
    type: 'ruby-annotation',
    text,
    bounds,
    paint: makeRubyPaint(baseFontSize),
  };
}

function makeLine(runs: readonly (TextRun | RubyAnnotation)[], y: number): LineBox {
  return {
    type: 'line-box',
    bounds: { x: 0, y, width: 400, height: 24 },
    runs,
  };
}

function wrapBlock(children: LineBox[]): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: 400, height: 100 },
    children,
  };
}

describe('Phase 2 — ruby annotation render', () => {
  it('annotationY = lineY + run.y - fontSize * 0.5 - 1', () => {
    const { ctx, records } = createRubyMockContext();
    const base = makeRun('漢', 20, 16);
    // Base run has bounds.y=0, fontSize=16. Layout places the ruby at
    // bounds.y = 0 - 8 - 1 = -9 (relative to the line).
    const ruby = makeRuby('かん', 20, 0, 16, 16);
    const block = wrapBlock([makeLine([base, ruby], 30)]);

    renderBlock(ctx, block, 0, 0);

    // Two fillText calls: base text + annotation (annotation is emitted last
    // because it comes after `base` in the runs array).
    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    expect(fillTexts).toHaveLength(2);

    const annotationCall = fillTexts[1];
    // lineY = 0 + 30; ruby.bounds.y = -9 → rubyY = 30 + (-9) = 21
    expect(annotationCall?.args[0]).toBe('かん');
    expect(annotationCall?.args[2]).toBe(21);
  });

  it('annotationY shifts by caller offsetY', () => {
    const { ctx, records } = createRubyMockContext();
    const base = makeRun('漢', 0, 16);
    const ruby = makeRuby('かん', 0, 0, 16, 16);
    const block = wrapBlock([makeLine([base, ruby], 0)]);

    renderBlock(ctx, block, 100, 50);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    const annotationCall = fillTexts[1];
    // offsetY=50, lineBox.y=0, ruby.bounds.y=-9 → rubyY = 50 + 0 + (-9) = 41
    expect(annotationCall?.args[2]).toBe(41);
  });

  it('annotation font size is fontSize * 0.5 and replaces ctx.font', () => {
    const { ctx, records } = createRubyMockContext();
    const basePaint: RunPaint = {
      ...DEFAULT_RUN_PAINT,
      font: { ...DEFAULT_RUN_PAINT.font, sizePx: 20, family: 'serif' },
    };
    const base = makeRun('漢', 0, 20, basePaint);
    const ruby = makeRuby('かん', 0, 0, 20, 20);
    const block = wrapBlock([makeLine([base, ruby], 0)]);

    renderBlock(ctx, block, 0, 0);

    // font is set at least twice: once for base text (20px), once for ruby (10px).
    const fonts = records.filter(
      (r): r is CanvasPropertySet => !isCall(r) && r.property === 'font',
    );
    expect(fonts.length).toBeGreaterThanOrEqual(2);
    expect(String(fonts[0]?.value)).toContain('20px');
    expect(fonts.some((f) => String(f.value).includes('10px'))).toBe(true);
  });

  it('rubyX centers annotation horizontally over base group width', () => {
    const { ctx, records } = createRubyMockContext();
    // Single base run at x=20 width=40. The ruby's bounds mirror the group.
    const base = makeRun('漢字', 20, 40);
    const ruby = makeRuby('か', 20, 0, 40, 16);
    const block = wrapBlock([makeLine([base, ruby], 0)]);

    renderBlock(ctx, block, 0, 0);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    const annotationCall = fillTexts[1];
    // measured = 10 (1 char × 10); rubyX = 0 + 20 + (40 - 10)/2 = 35
    expect(annotationCall?.args[1]).toBe(35);
  });

  it('one RubyAnnotation spanning two adjacent base runs renders a single label', () => {
    const { ctx, records } = createRubyMockContext();
    // Layout's text-align pass would produce a single RubyAnnotation whose
    // bounds span the full base group: x=10, width=32.
    const r1 = makeRun('漢', 10, 16);
    const r2 = makeRun('字', 26, 16);
    const ruby = makeRuby('かんじ', 10, 0, 32, 16);
    const block = wrapBlock([makeLine([r1, r2, ruby], 0)]);

    renderBlock(ctx, block, 0, 0);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    // 2 base text fills + 1 annotation fill = 3
    expect(fillTexts).toHaveLength(3);
    const annotationCall = fillTexts[2];
    // measured = 3 × 10 = 30; rubyX = 0 + 10 + (32 - 30)/2 = 11
    expect(annotationCall?.args[0]).toBe('かんじ');
    expect(annotationCall?.args[1]).toBe(11);
  });

  it('two separate RubyAnnotations produce two labels', () => {
    const { ctx, records } = createRubyMockContext();
    const r1 = makeRun('漢', 10, 16);
    const r2 = makeRun('字', 26, 16);
    const ruby1 = makeRuby('かん', 10, 0, 16, 16);
    const ruby2 = makeRuby('じ', 26, 0, 16, 16);
    const block = wrapBlock([makeLine([r1, r2, ruby1, ruby2], 0)]);

    renderBlock(ctx, block, 0, 0);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    // 2 base + 2 annotations = 4
    expect(fillTexts).toHaveLength(4);
    const ann1 = fillTexts[2];
    const ann2 = fillTexts[3];
    expect(ann1?.args[0]).toBe('かん');
    expect(ann2?.args[0]).toBe('じ');
  });

  it('base run with no sibling RubyAnnotation emits no annotation fillText', () => {
    const { ctx, records } = createRubyMockContext();
    const run = makeRun('漢', 0, 16);
    const block = wrapBlock([makeLine([run], 0)]);

    renderBlock(ctx, block, 0, 0);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    expect(fillTexts).toHaveLength(1);
  });

  it('ruby save/restore wraps annotation drawing (isolates font change)', () => {
    const { ctx, records } = createRubyMockContext();
    const base = makeRun('漢', 0, 16);
    const ruby = makeRuby('か', 0, 0, 16, 16);
    const block = wrapBlock([makeLine([base, ruby], 0)]);

    renderBlock(ctx, block, 0, 0);

    const saves = calls(records).filter((c) => c.method === 'save');
    const restores = calls(records).filter((c) => c.method === 'restore');
    // Must be balanced
    expect(saves.length).toBe(restores.length);
  });
});
