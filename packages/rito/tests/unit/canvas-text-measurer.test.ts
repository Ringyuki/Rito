import { describe, expect, it, vi } from 'vitest';
import type { MeasurePaint } from '../../src/style/core/paint-types';
import { createCanvasTextMeasurer } from '../../src/render/text/canvas-text-measurer';

const PAINT: MeasurePaint = {
  font: {
    style: 'normal',
    weight: 400,
    sizePx: 56,
    family: 'title, serif',
  },
};

function makeMetrics(overrides: Partial<TextMetrics>): TextMetrics {
  return {
    width: 0,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 0,
    ...overrides,
  } as unknown as TextMetrics;
}

describe('createCanvasTextMeasurer', () => {
  it('uses advance width instead of ink width for layout measurement', () => {
    const ctx = {
      font: '',
      measureText: vi.fn(() =>
        makeMetrics({
          width: 38.584,
          actualBoundingBoxLeft: 61.712,
          actualBoundingBoxRight: 100.24,
        }),
      ),
    } satisfies Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

    const measurer = createCanvasTextMeasurer(ctx as unknown as CanvasRenderingContext2D);

    expect(measurer.measureText('A', PAINT).width).toBeCloseTo(38.584);
  });

  it('adds manual word spacing to the advance width', () => {
    const ctx = {
      font: '',
      wordSpacing: '12px',
      letterSpacing: '12px',
      measureText: vi.fn(() => makeMetrics({ width: 30 })),
    } satisfies Pick<
      CanvasRenderingContext2D,
      'font' | 'wordSpacing' | 'letterSpacing' | 'measureText'
    >;
    const measurer = createCanvasTextMeasurer(ctx as unknown as CanvasRenderingContext2D);

    expect(measurer.measureText('a b c', { ...PAINT, wordSpacingPx: 2 }).width).toBe(34);
    expect(ctx.wordSpacing).toBe('0px');
    expect(ctx.letterSpacing).toBe('0px');
  });

  it('adds manual letter spacing to the advance width', () => {
    const ctx = {
      font: '',
      wordSpacing: '0px',
      letterSpacing: '0px',
      measureText: vi.fn(() => makeMetrics({ width: 30 })),
    } satisfies Pick<
      CanvasRenderingContext2D,
      'font' | 'wordSpacing' | 'letterSpacing' | 'measureText'
    >;
    const measurer = createCanvasTextMeasurer(ctx as unknown as CanvasRenderingContext2D);

    expect(measurer.measureText('abc', { ...PAINT, letterSpacingPx: 2 }).width).toBe(34);
  });
});
