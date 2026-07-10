import { describe, expect, it, vi } from 'vitest';
import { syncCanvasSize } from '../src/controller/facade/lifecycle';
import type { Internals } from '../src/controller/core/internals';
import type { RuntimeComponents } from '../src/controller/facade/types';

describe('syncCanvasSize', () => {
  it('resizes a fresh buffer pool even when the reused surface already has the right size', () => {
    const setSize = vi.fn();
    const resize = vi.fn();
    const internals = {
      renderScale: 1,
      reader: {
        dpr: 2,
        getCanvasSize: vi.fn(() => ({ width: 800, height: 600 })),
      },
    } as unknown as Internals;
    const runtime = {
      surface: {
        width: 1600,
        height: 1200,
        setSize,
      },
      pool: {
        resize,
      },
      td: {
        viewportWidth: 0,
      },
    } as unknown as RuntimeComponents;

    syncCanvasSize(internals, runtime);

    expect(setSize).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(800, 600, 2);
    expect(runtime.td.viewportWidth).toBe(800);
  });
});
