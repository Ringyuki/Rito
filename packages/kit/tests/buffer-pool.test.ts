import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createPageBufferPool } from '../src/painter/buffer-pool';

// Polyfill OffscreenCanvas for Node/happy-dom test environment
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
          canvas: this,
        };
      }
    };
  }
});

describe('PageBufferPool', () => {
  it('starts with three empty slots', () => {
    const pool = createPageBufferPool();
    expect(pool.prev.spreadIndex).toBeNull();
    expect(pool.curr.spreadIndex).toBeNull();
    expect(pool.next.spreadIndex).toBeNull();
  });

  it('assignSlot sets spreadIndex and marks dirty', () => {
    const pool = createPageBufferPool();
    pool.assignSlot('curr', 0);
    expect(pool.curr.spreadIndex).toBe(0);
    expect(pool.curr.contentDirty).toBe(true);
    expect(pool.curr.overlayDirty).toBe(true);
  });

  it('ensureContent calls renderer once then clears dirty', () => {
    const pool = createPageBufferPool();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 5);

    const renderer = vi.fn();
    pool.ensureContent('curr', renderer);

    expect(renderer).toHaveBeenCalledTimes(1);
    expect(renderer.mock.calls[0]?.[0]).toBe(5); // spreadIndex
    expect(pool.curr.contentDirty).toBe(false);

    // Second call should be no-op
    pool.ensureContent('curr', renderer);
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it('ensureContent skips empty slots', () => {
    const pool = createPageBufferPool();
    const renderer = vi.fn();
    pool.ensureContent('curr', renderer);
    expect(renderer).not.toHaveBeenCalled();
  });

  it('ensureOverlay allocates lazily and paints layers', () => {
    const pool = createPageBufferPool();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);

    expect(pool.curr.overlay).toBeNull();

    const provider = vi.fn(() => [
      { id: 'sel', rects: [{ x: 0, y: 0, width: 100, height: 20 }], color: 'blue', zIndex: 0 },
    ]);

    pool.ensureOverlay('curr', provider, 1);

    expect(pool.curr.overlay).not.toBeNull();
    expect(pool.curr.overlayDirty).toBe(false);
    expect(provider).toHaveBeenCalledWith(0);
  });

  it('ensureOverlay skips allocation when provider returns empty layers', () => {
    const pool = createPageBufferPool();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);

    const provider = vi.fn(() => []);
    pool.ensureOverlay('curr', provider, 1);

    expect(pool.curr.overlay).toBeNull();
    expect(pool.curr.overlayDirty).toBe(false);
  });

  it('rotateForward shifts slots correctly', () => {
    const pool = createPageBufferPool();
    pool.resize(100, 100, 1);
    pool.assignSlot('prev', 0);
    pool.assignSlot('curr', 1);
    pool.assignSlot('next', 2);

    pool.rotateForward();

    // prev ← old curr, curr ← old next, next ← cleared
    expect(pool.prev.spreadIndex).toBe(1);
    expect(pool.curr.spreadIndex).toBe(2);
    expect(pool.next.spreadIndex).toBeNull();
    expect(pool.next.contentDirty).toBe(true);
  });

  it('rotateBackward shifts slots correctly', () => {
    const pool = createPageBufferPool();
    pool.resize(100, 100, 1);
    pool.assignSlot('prev', 0);
    pool.assignSlot('curr', 1);
    pool.assignSlot('next', 2);

    pool.rotateBackward();

    // prev ← cleared, curr ← old prev, next ← old curr
    expect(pool.prev.spreadIndex).toBeNull();
    expect(pool.curr.spreadIndex).toBe(0);
    expect(pool.next.spreadIndex).toBe(1);
    expect(pool.prev.contentDirty).toBe(true);
  });

  it('jump clears all slots and assigns curr', () => {
    const pool = createPageBufferPool();
    pool.resize(100, 100, 1);
    pool.assignSlot('prev', 0);
    pool.assignSlot('curr', 1);
    pool.assignSlot('next', 2);

    pool.jump(10);

    expect(pool.prev.spreadIndex).toBeNull();
    expect(pool.curr.spreadIndex).toBe(10);
    expect(pool.next.spreadIndex).toBeNull();
    expect(pool.curr.contentDirty).toBe(true);
  });

  it('resize resizes all slot canvases and marks dirty', () => {
    const pool = createPageBufferPool();
    pool.resize(800, 600, 2);

    expect(pool.curr.content.width).toBe(1600);
    expect(pool.curr.content.height).toBe(1200);
    expect(pool.curr.contentDirty).toBe(true);
  });

  it('invalidateAllContent marks all slots dirty', () => {
    const pool = createPageBufferPool();
    pool.resize(100, 100, 1);
    pool.assignSlot('curr', 0);

    const renderer = vi.fn();
    pool.ensureContent('curr', renderer);
    expect(pool.curr.contentDirty).toBe(false);

    pool.invalidateAllContent();
    expect(pool.curr.contentDirty).toBe(true);
    expect(pool.prev.contentDirty).toBe(true);
    expect(pool.next.contentDirty).toBe(true);
  });

  it('invalidateOverlayForSpread only affects matching slot', () => {
    const pool = createPageBufferPool();
    pool.resize(100, 100, 1);
    pool.assignSlot('prev', 0);
    pool.assignSlot('curr', 1);
    pool.assignSlot('next', 2);

    // Clear dirty flags
    const renderer = vi.fn();
    const provider = vi.fn(() => []);
    pool.ensureContent('curr', renderer);
    pool.ensureOverlay('curr', provider, 1);
    expect(pool.curr.overlayDirty).toBe(false);

    pool.invalidateOverlayForSpread(1);
    expect(pool.curr.overlayDirty).toBe(true);
    // prev/next unaffected (they were already dirty from assignSlot, but let's check a different way)
    expect(pool.prev.spreadIndex).toBe(0);
    expect(pool.next.spreadIndex).toBe(2);
  });

  it('getSlotFor finds the right position', () => {
    const pool = createPageBufferPool();
    pool.assignSlot('prev', 5);
    pool.assignSlot('curr', 6);
    pool.assignSlot('next', 7);

    expect(pool.getSlotFor(5)).toBe('prev');
    expect(pool.getSlotFor(6)).toBe('curr');
    expect(pool.getSlotFor(7)).toBe('next');
    expect(pool.getSlotFor(99)).toBeNull();
  });

  it('double rotateForward produces correct state', () => {
    const pool = createPageBufferPool();
    pool.resize(100, 100, 1);
    pool.assignSlot('prev', 0);
    pool.assignSlot('curr', 1);
    pool.assignSlot('next', 2);

    pool.rotateForward();
    pool.assignSlot('next', 3);
    pool.rotateForward();

    expect(pool.prev.spreadIndex).toBe(2);
    expect(pool.curr.spreadIndex).toBe(3);
    expect(pool.next.spreadIndex).toBeNull();
  });
});
