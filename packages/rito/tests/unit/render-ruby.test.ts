/**
 * Phase 0 characterization: ruby annotation positioning.
 *
 * Pins down the current render-time geometry:
 *   - annotationY = lineY + groupStart.bounds.y - fontSize * RUBY_FONT_SCALE (0.5) - RUBY_GAP (1)
 *   - annotation font size = style.fontSize * 0.5
 *   - horizontal centering over the full contiguous base group
 *   - contiguous runs with the SAME rubyAnnotation string are grouped into one label
 *
 * Phase 2 will move this geometry into a standalone RubyAnnotation LineBox node;
 * these assertions must then be rewritten to target that new node, not the
 * renderer's on-the-fly computation.
 */
import { describe, expect, it } from 'vitest';
import { renderBlock } from '../../src/render/page/block-renderer';
import type { LayoutBlock, TextRun, LineBox } from '../../src/layout/core/types';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import type { CanvasCall, CanvasPropertySet, CanvasRecord } from '../helpers/mock-canvas-context';
import { isCall } from '../helpers/mock-canvas-context';

/**
 * Expected ruby geometry constants (mirrored from text-renderer).
 * These are intentionally inlined in assertions below so a silent change
 * to the upstream constants is caught by failing tests.
 *
 * RUBY_FONT_SCALE = 0.5 — annotation font = baseFontSize × 0.5
 * RUBY_GAP = 1 — pixel gap between annotation bottom and base top
 */

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
  overrides: Partial<TextRun> = {},
): TextRun {
  return {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width, height: 24 },
    style: DEFAULT_STYLE,
    ...overrides,
  };
}

function makeLine(runs: TextRun[], y: number): LineBox {
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

describe('Phase 0 — ruby annotation positioning', () => {
  it('annotationY = lineY + run.y - fontSize * 0.5 - 1', () => {
    const { ctx, records } = createRubyMockContext();
    const run = makeRun('漢', 20, 16, { rubyAnnotation: 'かん' });
    const block = wrapBlock([makeLine([run], 30)]);

    renderBlock(ctx, block, 0, 0);

    // Two fillText calls: base text + annotation. The annotation is the LAST one
    // because ruby is painted in the second pass (renderRubyAnnotations after renderLineBox).
    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    expect(fillTexts).toHaveLength(2);

    // Annotation fillText args: [annotation, rubyX, annotationY]
    const annotationCall = fillTexts[1];
    // lineY = 0 + 0 + lineBox.y (30) = 30; run.y = 0
    // annotationY = 30 + 0 - 16 * 0.5 - 1 = 30 - 8 - 1 = 21
    expect(annotationCall?.args[0]).toBe('かん');
    expect(annotationCall?.args[2]).toBe(21);
  });

  it('annotationY shifts by caller offsetY', () => {
    const { ctx, records } = createRubyMockContext();
    const run = makeRun('漢', 0, 16, { rubyAnnotation: 'かん' });
    const block = wrapBlock([makeLine([run], 0)]);

    renderBlock(ctx, block, 100, 50);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    const annotationCall = fillTexts[1];
    // offsetY=50, run.y=0, fontSize=16 → annotationY = 50 - 8 - 1 = 41
    expect(annotationCall?.args[2]).toBe(41);
  });

  it('annotation font size is fontSize * 0.5 and replaces ctx.font', () => {
    const { ctx, records } = createRubyMockContext();
    const style = { ...DEFAULT_STYLE, fontSize: 20, fontFamily: 'serif' };
    const run = makeRun('漢', 0, 20, { style, rubyAnnotation: 'かん' });
    const block = wrapBlock([makeLine([run], 0)]);

    renderBlock(ctx, block, 0, 0);

    // font is set twice: once for base text (20px), once for ruby (10px).
    const fonts = records.filter(
      (r): r is CanvasPropertySet => !isCall(r) && r.property === 'font',
    );
    expect(fonts.length).toBeGreaterThanOrEqual(2);
    // Base font should contain "20px", ruby font should contain "10px".
    expect(String(fonts[0]?.value)).toContain('20px');
    expect(fonts.some((f) => String(f.value).includes('10px'))).toBe(true);
  });

  it('rubyX centers annotation horizontally over base group width', () => {
    const { ctx, records } = createRubyMockContext();
    // Single run at x=20 width=40. Annotation has 2 chars → measure=20 (fake).
    const run = makeRun('漢字', 20, 40, { rubyAnnotation: 'か' });
    const block = wrapBlock([makeLine([run], 0)]);

    renderBlock(ctx, block, 0, 0);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    const annotationCall = fillTexts[1];
    // groupX = 0 + 20 = 20; baseWidth = 40; measured = 10 (1 char * 10)
    // rubyX = 20 + (40 - 10) / 2 = 35
    expect(annotationCall?.args[1]).toBe(35);
  });

  it('contiguous runs with the same rubyAnnotation form ONE label over full span', () => {
    const { ctx, records } = createRubyMockContext();
    // Two consecutive runs share the same rubyAnnotation.
    const r1 = makeRun('漢', 10, 16, { rubyAnnotation: 'かんじ' });
    const r2 = makeRun('字', 26, 16, { rubyAnnotation: 'かんじ' });
    const block = wrapBlock([makeLine([r1, r2], 0)]);

    renderBlock(ctx, block, 0, 0);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    // 2 base text fills + 1 annotation fill = 3
    expect(fillTexts).toHaveLength(3);
    const annotationCall = fillTexts[2];
    // groupStart.bounds.x = 10; groupEnd.bounds.x + width = 26 + 16 = 42
    // groupX = 10; groupWidth = 42 - 10 = 32
    // measured = 3 * 10 = 30
    // rubyX = 10 + (32 - 30) / 2 = 11
    expect(annotationCall?.args[0]).toBe('かんじ');
    expect(annotationCall?.args[1]).toBe(11);
  });

  it('runs with DIFFERENT rubyAnnotations produce separate labels', () => {
    const { ctx, records } = createRubyMockContext();
    const r1 = makeRun('漢', 10, 16, { rubyAnnotation: 'かん' });
    const r2 = makeRun('字', 26, 16, { rubyAnnotation: 'じ' });
    const block = wrapBlock([makeLine([r1, r2], 0)]);

    renderBlock(ctx, block, 0, 0);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    // 2 base + 2 annotations = 4
    expect(fillTexts).toHaveLength(4);
    const ann1 = fillTexts[2];
    const ann2 = fillTexts[3];
    expect(ann1?.args[0]).toBe('かん');
    expect(ann2?.args[0]).toBe('じ');
  });

  it('run without rubyAnnotation emits no annotation fillText', () => {
    const { ctx, records } = createRubyMockContext();
    const run = makeRun('漢', 0, 16);
    const block = wrapBlock([makeLine([run], 0)]);

    renderBlock(ctx, block, 0, 0);

    const fillTexts = calls(records).filter((c) => c.method === 'fillText');
    expect(fillTexts).toHaveLength(1);
  });

  it('ruby save/restore wraps annotation drawing (isolates font change)', () => {
    const { ctx, records } = createRubyMockContext();
    const run = makeRun('漢', 0, 16, { rubyAnnotation: 'か' });
    const block = wrapBlock([makeLine([run], 0)]);

    renderBlock(ctx, block, 0, 0);

    const saves = calls(records).filter((c) => c.method === 'save');
    const restores = calls(records).filter((c) => c.method === 'restore');
    // Must be balanced
    expect(saves.length).toBe(restores.length);
  });
});
