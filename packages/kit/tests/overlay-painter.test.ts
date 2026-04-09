import { describe, expect, it } from 'vitest';
import { paintOverlayInto } from '../src/painter/overlay-painter';
import type { OverlayLayer } from '../src/painter/types';

function createMockCtx(width = 800, height = 600) {
  const canvas = { width, height };
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const ctx = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === 'canvas') return canvas;
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
        };
      },
      set(_, prop: string, value: unknown) {
        calls.push({ method: `set:${prop}`, args: [value] });
        return true;
      },
    },
  ) as unknown as OffscreenCanvasRenderingContext2D;
  return { ctx, calls };
}

describe('paintOverlayInto', () => {
  it('clears the canvas even with no layers', () => {
    const { ctx, calls } = createMockCtx();
    paintOverlayInto(ctx, [], 1);

    const clearCalls = calls.filter((c) => c.method === 'clearRect');
    expect(clearCalls.length).toBe(1);
    expect(clearCalls[0]?.args).toEqual([0, 0, 800, 600]);

    // Should NOT call save/restore when no layers
    const saveCalls = calls.filter((c) => c.method === 'save');
    expect(saveCalls.length).toBe(0);
  });

  it('paints layers sorted by zIndex', () => {
    const { ctx, calls } = createMockCtx();
    const layers: OverlayLayer[] = [
      { id: 'b', rects: [{ x: 0, y: 0, width: 10, height: 10 }], color: 'red', zIndex: 2 },
      { id: 'a', rects: [{ x: 0, y: 0, width: 20, height: 20 }], color: 'blue', zIndex: 1 },
    ];

    paintOverlayInto(ctx, layers, 1);

    // Colors should appear in zIndex order: blue first, then red
    const colorSets = calls.filter((c) => c.method === 'set:fillStyle');
    expect(colorSets[0]?.args[0]).toBe('blue');
    expect(colorSets[1]?.args[0]).toBe('red');
  });

  it('applies backingRatio via ctx.scale', () => {
    const { ctx, calls } = createMockCtx();
    const layers: OverlayLayer[] = [
      { id: 'a', rects: [{ x: 10, y: 20, width: 30, height: 40 }], color: 'green', zIndex: 0 },
    ];

    paintOverlayInto(ctx, layers, 2);

    const scaleCalls = calls.filter((c) => c.method === 'scale');
    expect(scaleCalls[0]?.args).toEqual([2, 2]);
  });

  it('draws border when borderColor is set', () => {
    const { ctx, calls } = createMockCtx();
    const layers: OverlayLayer[] = [
      {
        id: 'a',
        rects: [{ x: 0, y: 0, width: 10, height: 10 }],
        color: 'yellow',
        borderColor: 'black',
        zIndex: 0,
      },
    ];

    paintOverlayInto(ctx, layers, 1);

    const strokeCalls = calls.filter((c) => c.method === 'strokeRect');
    expect(strokeCalls.length).toBe(1);
  });

  it('does not draw border when borderColor is absent', () => {
    const { ctx, calls } = createMockCtx();
    const layers: OverlayLayer[] = [
      { id: 'a', rects: [{ x: 0, y: 0, width: 10, height: 10 }], color: 'yellow', zIndex: 0 },
    ];

    paintOverlayInto(ctx, layers, 1);

    const strokeCalls = calls.filter((c) => c.method === 'strokeRect');
    expect(strokeCalls.length).toBe(0);
  });
});
