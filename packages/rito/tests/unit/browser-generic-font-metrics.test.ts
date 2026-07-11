import { describe, expect, it, vi } from 'vitest';
import {
  createHostFontMetrics,
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
