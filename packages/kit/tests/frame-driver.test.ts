import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createPageBufferPool } from '../src/painter/buffer-pool';
import { createFrameDriver } from '../src/driver/frame-driver';
import { createTransitionDriver } from '../src/driver/transition-driver';

// Polyfill OffscreenCanvas
beforeAll(() => {
  if (typeof globalThis['OffscreenCanvas'] === 'undefined') {
    (globalThis as Record<string, unknown>)['OffscreenCanvas'] = class OffscreenCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return {
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
          drawImage: vi.fn(),
          canvas: this,
        };
      }
    };
  }
});

// Mock rAF
let rafCallbacks: Array<(time: number) => void> = [];
let rafId = 0;

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
    rafCallbacks.push(cb);
    return ++rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
    rafCallbacks = [];
  });
});

function flushRaf(time = 16): void {
  const cbs = [...rafCallbacks];
  rafCallbacks = [];
  for (const cb of cbs) cb(time);
}

function createMockSurface() {
  const ctx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
  return {
    canvas: {} as HTMLCanvasElement,
    ctx: ctx as unknown as CanvasRenderingContext2D,
    width: 800,
    height: 600,
    setSize: vi.fn(),
    clear() {
      ctx.clearRect(0, 0, 800, 600);
    },
  };
}

describe('FrameDriver', () => {
  it('scheduleComposite is idempotent', () => {
    const surface = createMockSurface();
    const pool = createPageBufferPool();
    pool.resize(800, 600, 1);
    const td = createTransitionDriver();

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(),
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    driver.scheduleComposite();
    driver.scheduleComposite();
    driver.scheduleComposite();

    // Only one rAF callback should be queued
    expect(rafCallbacks.length).toBe(1);
    driver.dispose();
  });

  it('composites content on frame when idle', () => {
    const surface = createMockSurface();
    const pool = createPageBufferPool();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    const td = createTransitionDriver();
    const renderer = vi.fn();

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: renderer,
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    driver.scheduleComposite();
    flushRaf();

    // Should have called renderer for curr slot
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(renderer.mock.calls[0]?.[0]).toBe(0); // spreadIndex

    // Should have drawn to surface
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(surface.ctx.drawImage).toHaveBeenCalled();

    // Idle → no more rAF scheduled
    expect(rafCallbacks.length).toBe(0);

    driver.dispose();
  });

  it('continues rAF during animation', () => {
    const surface = createMockSurface();
    const pool = createPageBufferPool();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    pool.assignSlot('next', 1);
    const td = createTransitionDriver();
    td.viewportWidth = 800;

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(),
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    td.goToTarget('forward', 0, 1);
    driver.scheduleComposite();
    flushRaf(16);

    // Animation in progress → should schedule another rAF
    expect(rafCallbacks.length).toBe(1);

    driver.dispose();
  });

  it('markOverlayDirty triggers recomposite', () => {
    const surface = createMockSurface();
    const pool = createPageBufferPool();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 3);
    const td = createTransitionDriver();

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(),
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    // Clear initial schedule
    driver.scheduleComposite();
    flushRaf();
    rafCallbacks = [];

    // Mark overlay dirty
    driver.markOverlayDirty(3);

    // Should have scheduled a new composite
    expect(rafCallbacks.length).toBe(1);

    driver.dispose();
  });

  it('dispose cancels pending rAF', () => {
    const surface = createMockSurface();
    const pool = createPageBufferPool();
    pool.resize(800, 600, 1);
    const td = createTransitionDriver();

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(),
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    driver.scheduleComposite();
    driver.dispose();

    // Flush should be safe but no-op
    flushRaf();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(surface.ctx.drawImage).not.toHaveBeenCalled();
  });
});
