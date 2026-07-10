import { describe, expect, it, vi } from 'vitest';
import type { MeasurePaint } from '../../src/reference/ts-core/style/core/paint-types';
import { canvasTextMeasurementBackend } from '../../src/reference/ts-core/render/backends/canvas';

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

describe('canvasTextMeasurementBackend', () => {
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

    const measurer = canvasTextMeasurementBackend.createTextMeasurer(
      ctx as unknown as CanvasRenderingContext2D,
    );

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
    const measurer = canvasTextMeasurementBackend.createTextMeasurer(
      ctx as unknown as CanvasRenderingContext2D,
    );

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
    const measurer = canvasTextMeasurementBackend.createTextMeasurer(
      ctx as unknown as CanvasRenderingContext2D,
    );

    expect(measurer.measureText('abc', { ...PAINT, letterSpacingPx: 2 }).width).toBe(34);
  });

  it('resolves and caches font metrics from the canvas backend', () => {
    const ctx = {
      font: '',
      wordSpacing: '8px',
      letterSpacing: '9px',
      measureText: vi.fn(() =>
        makeMetrics({
          width: 0,
          fontBoundingBoxAscent: 44,
          fontBoundingBoxDescent: 12,
          actualBoundingBoxAscent: 40,
          actualBoundingBoxDescent: 10,
        }),
      ),
    } satisfies Pick<
      CanvasRenderingContext2D,
      'font' | 'wordSpacing' | 'letterSpacing' | 'measureText'
    >;
    const measurer = canvasTextMeasurementBackend.createTextMeasurer(
      ctx as unknown as CanvasRenderingContext2D,
    );

    expect(measurer.resolveFontMetrics(PAINT)).toEqual({
      ascentPx: 44,
      descentPx: 12,
      lineGapPx: 0,
      contentHeightPx: 56,
    });
    expect(measurer.resolveFontMetrics(PAINT).contentHeightPx).toBe(56);
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    expect(ctx.wordSpacing).toBe('0px');
    expect(ctx.letterSpacing).toBe('0px');
  });

  it('falls back to the font size when canvas font metrics are unavailable', () => {
    const ctx = {
      font: '',
      wordSpacing: '0px',
      letterSpacing: '0px',
      measureText: vi.fn(() => makeMetrics({ width: 0 })),
    } satisfies Pick<
      CanvasRenderingContext2D,
      'font' | 'wordSpacing' | 'letterSpacing' | 'measureText'
    >;
    const measurer = canvasTextMeasurementBackend.createTextMeasurer(
      ctx as unknown as CanvasRenderingContext2D,
    );

    expect(measurer.resolveFontMetrics(PAINT)).toEqual({
      ascentPx: 56,
      descentPx: 0,
      lineGapPx: 0,
      contentHeightPx: 56,
    });
  });

  it('bounds the text-width cache with least-recently-used eviction', () => {
    const ctx = {
      font: '',
      wordSpacing: '0px',
      letterSpacing: '0px',
      measureText: vi.fn(() => makeMetrics({ width: 10 })),
    } satisfies Pick<
      CanvasRenderingContext2D,
      'font' | 'wordSpacing' | 'letterSpacing' | 'measureText'
    >;
    const measurer = canvasTextMeasurementBackend.createTextMeasurer(
      ctx as unknown as CanvasRenderingContext2D,
    );

    for (let index = 0; index <= 4096; index++) {
      measurer.measureText(`entry-${String(index)}`, PAINT);
    }
    measurer.measureText('entry-0', PAINT);

    expect(ctx.measureText).toHaveBeenCalledTimes(4098);
  });
});
