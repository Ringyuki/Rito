import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageBufferPool } from '../src/painter/buffer-pool';
import { createDisplaySurface } from '../src/painter/display-surface';
import { createFakeGl } from './helpers/fake-gl';
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

beforeEach(() => {
  rafCallbacks = [];
  rafId = 0;
});

function flushRaf(time = 16): void {
  const cbs = [...rafCallbacks];
  rafCallbacks = [];
  for (const cb of cbs) cb(time);
}

/** A display on a fake WebGL2 context: what it shows is the textures drawn to its own framebuffer. */
function createGlSurface() {
  const fake = createFakeGl();
  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: () => fake.gl,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLCanvasElement;
  const surface = createDisplaySurface(canvas);
  surface.setSize(800, 600, 1);
  const clear = vi.spyOn(surface, 'clear');
  const displayed = (): unknown[] =>
    fake.draws.filter((draw) => draw.framebuffer === null).map((draw) => draw.texture);
  return { surface, clear, displayed };
}

describe('FrameDriver', () => {
  it('scheduleComposite is idempotent', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    const td = createTransitionDriver();

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(() => true),
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

  it('compositeNow renders immediately and cancels a pending scheduled frame', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    const td = createTransitionDriver();
    const renderer = vi.fn((_spreadIndex: number) => true);

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: renderer,
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    driver.scheduleComposite();
    expect(rafCallbacks.length).toBe(1);

    driver.compositeNow();

    expect(rafCallbacks.length).toBe(0);
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(view.displayed().length).toBeGreaterThan(0);

    driver.dispose();
  });

  it('compositeNow does not clear the surface when content is not ready', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    const td = createTransitionDriver();

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(() => false),
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    driver.compositeNow();

    expect(view.clear).not.toHaveBeenCalled();
    expect(view.displayed()).toEqual([]);

    driver.dispose();
  });

  it('composites content on frame when idle', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    const td = createTransitionDriver();
    const renderer = vi.fn((_spreadIndex: number) => true);

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
    expect(view.displayed().length).toBeGreaterThan(0);

    // Idle → no more rAF scheduled
    expect(rafCallbacks.length).toBe(0);

    driver.dispose();
  });

  it('does not clear the surface when the current content slot is not ready', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    const td = createTransitionDriver();
    const renderer = vi.fn(() => false);

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

    expect(renderer).toHaveBeenCalledTimes(1);
    expect(pool.curr.contentDirty).toBe(true);
    expect(view.clear).not.toHaveBeenCalled();
    expect(view.displayed()).toEqual([]);

    driver.dispose();
  });

  it('continues rAF during animation', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    pool.assignSlot('next', 1);
    const td = createTransitionDriver();
    td.viewportWidth = 800;

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(() => true),
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

  it('draws the page a cut turn was leaving until the next turn has crossed its own start', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('prev', 0);
    pool.assignSlot('curr', 1);
    pool.assignSlot('next', 2);
    const td = createTransitionDriver();
    td.viewportWidth = 800;
    td.onSettled((event) => {
      if (event.committed) pool.rotateForward();
    });

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(() => true),
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    // A turn to spread 2 is cut into part of the way: it lands, and 2 is the current spread.
    td.goToTarget('forward', 1, 2);
    td.step(80);
    td.handOver();
    pool.assignSlot('next', 3);
    td.goToTarget('forward', 2, 3);
    driver.compositeNow();

    const drawn = view.displayed();
    // Spread 2 still arriving, spread 1 still leaving; nothing of spread 3 yet.
    expect(drawn).toEqual([pool.curr.content.texture, pool.prev.content.texture]);
    expect(pool.getSlotFor(1)).toBe('prev');

    driver.dispose();
  });

  it('draws the page a cut turn back was leaving, on the other side', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('prev', 1);
    pool.assignSlot('curr', 2);
    pool.assignSlot('next', 3);
    const td = createTransitionDriver();
    td.viewportWidth = 800;
    td.onSettled((event) => {
      if (event.committed) pool.rotateBackward();
    });

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(() => true),
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    td.goToTarget('backward', 2, 1);
    td.step(80);
    td.handOver();
    pool.assignSlot('prev', 0);
    td.goToTarget('backward', 1, 0);
    driver.compositeNow();

    const drawn = view.displayed();
    expect(drawn).toEqual([pool.curr.content.texture, pool.next.content.texture]);
    expect(pool.getSlotFor(2)).toBe('next');

    driver.dispose();
  });

  it('markOverlayDirty triggers recomposite', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 3);
    const td = createTransitionDriver();

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(() => true),
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

  it('renders dirty offscreen content without compositing it to the surface', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    pool.assignSlot('next', 1);
    const td = createTransitionDriver();
    const renderer = vi.fn((_spreadIndex: number) => true);

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: renderer,
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    driver.markContentDirty(1);

    expect(renderer).toHaveBeenCalledWith(1, expect.any(Object));
    expect(pool.next.contentDirty).toBe(false);
    expect(view.displayed()).toEqual([]);

    driver.dispose();
  });

  it('composites current dirty content immediately without waiting for rAF', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    const td = createTransitionDriver();
    const renderer = vi.fn((_spreadIndex: number) => true);

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: renderer,
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    driver.markContentDirty(0);

    expect(renderer).toHaveBeenCalledWith(0, expect.any(Object));
    expect(pool.curr.contentDirty).toBe(false);
    expect(rafCallbacks.length).toBe(0);
    expect(view.displayed().length).toBeGreaterThan(0);

    driver.dispose();
  });

  it('preserves the scheduled animation frame when current content refreshes mid-transition', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    pool.assignSlot('next', 1);
    const td = createTransitionDriver();
    td.viewportWidth = 800;
    const renderer = vi.fn((_spreadIndex: number) => true);

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: renderer,
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    td.goToTarget('forward', 0, 1);
    driver.scheduleComposite();
    expect(rafCallbacks.length).toBe(1);

    driver.markContentDirty(0);

    expect(renderer).toHaveBeenCalledWith(0, expect.any(Object));
    expect(pool.curr.contentDirty).toBe(false);
    expect(rafCallbacks.length).toBe(1);
    expect(view.displayed()).toEqual([]);

    flushRaf();

    expect(view.displayed().length).toBeGreaterThan(0);
    expect(rafCallbacks.length).toBe(1);

    driver.dispose();
  });

  it('dispose cancels pending rAF', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    const td = createTransitionDriver();

    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(() => true),
      overlayProvider: () => [],
      getBackingRatio: () => 1,
    });

    driver.scheduleComposite();
    driver.dispose();

    // Flush should be safe but no-op
    flushRaf();
    expect(view.displayed()).toEqual([]);
  });

  it('hands a painted effect the finger, the phase, the spine and each page as last painted', () => {
    const view = createGlSurface();
    const { surface } = view;
    const pool = createPageBufferPool(surface.compositor);
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);
    pool.assignSlot('next', 1);
    const seen: { frame: unknown; spine: number; version: number | undefined }[] = [];
    const td = createTransitionDriver({
      effect: {
        paint(scene, frame) {
          seen.push({ frame, spine: scene.spine, version: scene.page('curr')?.version });
        },
      },
    });
    // The surface is 800 device pixels across a 400 px viewport.
    td.viewportWidth = 400;
    td.spine = 200;
    const driver = createFrameDriver({
      surface,
      pool,
      transitionDriver: td,
      contentRenderer: vi.fn(() => true),
      overlayProvider: () => [],
      getBackingRatio: () => 2,
    });
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-50, 16, {
      origin: { x: 300, y: 100 },
      position: { x: 250, y: 90 },
      farthest: { x: 240, y: 95 },
    });
    driver.compositeNow();

    expect(seen[0]).toMatchObject({
      spine: 400,
      frame: {
        dx: -100,
        width: 800,
        phase: 'held',
        velocity: 0,
        touch: {
          origin: { x: 600, y: 200 },
          position: { x: 500, y: 180 },
          farthest: { x: 480, y: 190 },
        },
      },
    });

    // The page is painted again (an image landed): its version moves on.
    driver.markContentDirty(0);
    flushRaf();
    expect(seen[1]?.version).toBeGreaterThan(seen[0]?.version ?? Infinity);
    driver.dispose();
  });
});
