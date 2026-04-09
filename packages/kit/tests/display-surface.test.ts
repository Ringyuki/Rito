// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createDisplaySurface } from '../src/painter/display-surface';

function createMockCanvas() {
  const mockCtx = {
    clearRect: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: vi.fn(() => mockCtx),
  } as unknown as HTMLCanvasElement;
  return { canvas, mockCtx };
}

describe('DisplaySurface', () => {
  it('creates from an HTMLCanvasElement', () => {
    const { canvas } = createMockCanvas();
    const surface = createDisplaySurface(canvas);
    expect(surface.canvas).toBe(canvas);
    expect(surface.ctx).toBeDefined();
  });

  it('setSize sets backing store and CSS dimensions', () => {
    const { canvas } = createMockCanvas();
    const surface = createDisplaySurface(canvas);

    surface.setSize(800, 600, 2);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    expect(surface.width).toBe(1600);
    expect(surface.height).toBe(1200);
  });

  it('clear clears the entire backing store', () => {
    const { canvas, mockCtx } = createMockCanvas();
    const surface = createDisplaySurface(canvas);

    surface.setSize(800, 600, 1);
    surface.clear();

    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });
});
