import { describe, expect, it, vi } from 'vitest';
import {
  createHostFontMetrics,
  ensureHostFontVerticalMetrics,
  ensureHostGenericSerifMetrics,
  hostFontMetricConfig,
  measureHostFontMetrics,
  measureFontFamilyMetrics,
  measureGenericSerifAdvances,
  measureGenericSerifMetrics,
} from '../../src/bindings/browser/font-metrics';

describe('browser generic font metrics', () => {
  it('normalizes host Canvas symbol advances to em units', () => {
    const save = vi.fn();
    const restore = vi.fn();
    const context = {
      font: '12px sans-serif',
      wordSpacing: '2px',
      letterSpacing: '3px',
      save,
      restore,
      measureText: vi.fn((text: string) => {
        const width = Array.from(text).reduce(
          (total, character) =>
            character === '•' ? Number.NaN : total + (character === '─' ? 16 : 8),
          0,
        );
        return { width } as TextMetrics;
      }),
    } as unknown as Parameters<typeof measureGenericSerifAdvances>[0];

    const advances = measureGenericSerifAdvances(context);

    expect(context.font).toBe('16px serif');
    expect(context.wordSpacing).toBe('0px');
    expect(context.letterSpacing).toBe('0px');
    expect(advances['─']).toBe(1);
    expect(advances['×']).toBe(0.5);
    expect(advances['•']).toBeUndefined();
    expect(save).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
  });

  it('captures host-only punctuation pair compression as an em adjustment', () => {
    const context = createPairMeasurementContext();

    const metrics = measureGenericSerifMetrics(context);

    expect(metrics.advances['：']).toBe(1);
    expect(metrics.advances['「']).toBe(1);
    expect(metrics.pairAdjustments['：「']).toBe(-0.5);
    expect(metrics.pairAdjustments['「：']).toBeUndefined();
  });

  it('omits an empty generic pair map to match Rust serde defaults', () => {
    const genericSerif = measureGenericSerifMetrics(createAdditiveMeasurementContext());

    const config = hostFontMetricConfig({
      genericSerif,
      fontFamilies: Object.create(null) as Record<string, never>,
      verticalMetrics: Object.create(null) as Record<string, never>,
    });

    expect(config.genericSerifAdvances?.['A']).toBe(0.5);
    expect(config.genericSerifPairAdjustments).toBeUndefined();
  });

  it('keeps the initial metric config empty until the background host probe runs', () => {
    const metrics = createHostFontMetrics();
    const context = createAdditiveMeasurementContext();

    expect(hostFontMetricConfig(metrics)).toEqual({});
    expect(ensureHostGenericSerifMetrics(metrics, context)).toBe(true);
    expect(ensureHostGenericSerifMetrics(metrics, context)).toBe(false);
    expect(hostFontMetricConfig(metrics).genericSerifAdvances?.['A']).toBe(0.5);
  });

  it('captures exact-size font boxes independently for style and weight', () => {
    const metrics = createHostFontMetrics();
    const measureText = vi
      .fn()
      .mockReturnValueOnce({ fontBoundingBoxAscent: 4.5, fontBoundingBoxDescent: 31.5 })
      .mockReturnValueOnce({ fontBoundingBoxAscent: 4.75, fontBoundingBoxDescent: 31.25 })
      .mockReturnValueOnce({ fontBoundingBoxAscent: 2, fontBoundingBoxDescent: 15 });
    const context = {
      font: '',
      textBaseline: 'alphabetic',
      save: vi.fn(),
      restore: vi.fn(),
      measureText,
    } as unknown as Parameters<typeof ensureHostFontVerticalMetrics>[1];

    const normal32 = {
      fontFamily: ' Title Font ',
      fontStyle: 'normal' as const,
      fontWeight: 400,
      fontSizePx: 32,
    };
    const italic32 = { ...normal32, fontStyle: 'italic' as const, fontWeight: 700 };
    const normal16 = { ...normal32, fontSizePx: 16 };

    expect(
      ensureHostFontVerticalMetrics(metrics, context, [
        normal32,
        italic32,
        normal16,
        { ...normal32, fontFamily: 'Title Font' },
      ]),
    ).toBe(true);
    expect(ensureHostFontVerticalMetrics(metrics, context, [normal32])).toBe(false);
    expect(hostFontMetricConfig(metrics).fontVerticalMetrics).toEqual([
      {
        fontFamily: 'Title Font',
        fontStyle: 'italic',
        fontWeight: 700,
        fontSizePx: 32,
        topBaselineAscentPx: 4.75,
        topBaselineDescentPx: 31.25,
      },
      {
        fontFamily: 'Title Font',
        fontStyle: 'normal',
        fontWeight: 400,
        fontSizePx: 16,
        topBaselineAscentPx: 2,
        topBaselineDescentPx: 15,
      },
      {
        fontFamily: 'Title Font',
        fontStyle: 'normal',
        fontWeight: 400,
        fontSizePx: 32,
        topBaselineAscentPx: 4.5,
        topBaselineDescentPx: 31.5,
      },
    ]);
    expect(measureText).toHaveBeenCalledTimes(3);
    expect(context.font).toBe('16px Title Font');
  });

  it('retries a vertical metric demand after an incomplete TextMetrics result', () => {
    const metrics = createHostFontMetrics();
    const measureText = vi
      .fn()
      .mockReturnValueOnce({})
      .mockReturnValueOnce({ fontBoundingBoxAscent: 2, fontBoundingBoxDescent: 15 });
    const context = {
      font: '',
      textBaseline: 'alphabetic',
      save: vi.fn(),
      restore: vi.fn(),
      measureText,
    } as unknown as Parameters<typeof ensureHostFontVerticalMetrics>[1];
    const demand = {
      fontFamily: 'serif',
      fontStyle: 'normal' as const,
      fontWeight: 400,
      fontSizePx: 16,
    };

    expect(ensureHostFontVerticalMetrics(metrics, context, [demand])).toBe(false);
    expect(ensureHostFontVerticalMetrics(metrics, context, [demand])).toBe(true);
    expect(measureText).toHaveBeenCalledTimes(2);
  });

  it('keys publication-family metrics by normalized CSS family name', () => {
    const context = createPairMeasurementContext();

    const metrics = measureFontFamilyMetrics(context, [' Title Font ', 'Title Font']);

    expect(metrics['title font']?.advances['：']).toBe(1);
    expect(metrics['title font']?.pairAdjustments['：「']).toBe(-0.5);
    expect(context.font).toBe('16px "Title Font"');
  });

  it('supports inherited-property family names and matches ASCII-only core normalization', () => {
    const context = createPairMeasurementContext();

    const metrics = measureFontFamilyMetrics(context, [' Constructor ', 'ÄTITLE']);

    expect(Object.hasOwn(metrics, 'constructor')).toBe(true);
    expect(metrics['constructor']?.advances['：']).toBe(1);
    expect(metrics['Ätitle']?.advances['「']).toBe(1);
    expect(metrics['ätitle']).toBeUndefined();
  });

  it('reuses generic-serif probes across native contexts with the same prototype', () => {
    class TestCanvasContext {
      font = '12px sans-serif';
      wordSpacing = '2px';
      letterSpacing = '3px';
      readonly save = vi.fn();
      readonly restore = vi.fn();
      readonly measureText = vi.fn((text: string) => ({
        width: Array.from(text).length * 8,
      }));
    }
    const first = new TestCanvasContext();
    const second = new TestCanvasContext();

    const firstMetrics = measureHostFontMetrics(
      first as unknown as Parameters<typeof measureHostFontMetrics>[0],
    );
    const secondMetrics = measureHostFontMetrics(
      second as unknown as Parameters<typeof measureHostFontMetrics>[0],
    );

    expect(first.measureText).toHaveBeenCalled();
    expect(second.measureText).not.toHaveBeenCalled();
    expect(secondMetrics.genericSerif).toBe(firstMetrics.genericSerif);
  });
});

function createPairMeasurementContext(): Parameters<typeof measureGenericSerifMetrics>[0] {
  const singleWidth = (character: string): number =>
    character === '：' || character === '「' ? 16 : 8;
  return {
    font: '12px sans-serif',
    wordSpacing: '2px',
    letterSpacing: '3px',
    save: vi.fn(),
    restore: vi.fn(),
    measureText: vi.fn((text: string) => {
      const width =
        text === '：「'
          ? 24
          : Array.from(text).reduce((total, character) => total + singleWidth(character), 0);
      return { width } as TextMetrics;
    }),
  } as unknown as Parameters<typeof measureGenericSerifMetrics>[0];
}

function createAdditiveMeasurementContext(): Parameters<typeof measureGenericSerifMetrics>[0] {
  return {
    font: '12px sans-serif',
    wordSpacing: '2px',
    letterSpacing: '3px',
    save: vi.fn(),
    restore: vi.fn(),
    measureText: vi.fn((text: string) => ({
      width: Array.from(text).length * 8,
    })) as unknown as CanvasRenderingContext2D['measureText'],
  } as unknown as Parameters<typeof measureGenericSerifMetrics>[0];
}
