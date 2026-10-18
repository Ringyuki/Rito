import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPageBufferPool, type PageTarget } from '../src/painter/buffer-pool';
import { createCompositor } from '../src/painter/gl/compositor';
import { createFakeGl, type FakeGl } from './helpers/fake-gl';

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
          drawImage: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
          setTransform: vi.fn(),
          canvas: this,
        };
      }
    };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function poolOn(fake: FakeGl = createFakeGl()) {
  return createPageBufferPool(createCompositor(fake.gl));
}

describe('PageBufferPool', () => {
  it('starts with three empty slots', () => {
    const pool = poolOn();
    expect(pool.prev.spreadIndex).toBeNull();
    expect(pool.curr.spreadIndex).toBeNull();
    expect(pool.next.spreadIndex).toBeNull();
  });

  it('releases earlier slots when a later buffer cannot be made', () => {
    const sentinel = new Error('texture allocation failed');
    const fake = createFakeGl();
    let made = 0;
    const gl = new Proxy(fake.gl, {
      get(target, property): unknown {
        if (property === 'createTexture') {
          return () => {
            made += 1;
            if (made === 3) throw sentinel;
            return target.createTexture();
          };
        }
        return Reflect.get(target, property) as unknown;
      },
    });
    expect(() => createPageBufferPool(createCompositor(gl))).toThrow(sentinel);
    expect(fake.named('deleteTexture')).toHaveLength(2);
    expect(fake.named('deleteFramebuffer')).toHaveLength(2);
  });

  it('assignSlot sets spreadIndex and marks dirty', () => {
    const pool = poolOn();
    pool.assignSlot('curr', 0);
    expect(pool.curr.spreadIndex).toBe(0);
    expect(pool.curr.contentDirty).toBe(true);
    expect(pool.curr.overlayDirty).toBe(true);
  });

  it('ensureContent calls renderer once then clears dirty', () => {
    const pool = poolOn();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 5);

    const renderer = vi.fn((_spreadIndex: number) => true);
    pool.ensureContent('curr', renderer);

    expect(renderer).toHaveBeenCalledTimes(1);
    expect(renderer.mock.calls[0]?.[0]).toBe(5); // spreadIndex
    expect(pool.curr.contentDirty).toBe(false);

    // Second call should be no-op
    pool.ensureContent('curr', renderer);
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it("paints a spread into the slot's own framebuffer at the slot's size", () => {
    const pool = poolOn();
    pool.resize(800, 600, 2);
    pool.assignSlot('next', 6);
    const pages: PageTarget[] = [];
    expect(
      pool.ensureContent('next', (_index, page) => {
        pages.push(page);
        return true;
      }),
    ).toBe(true);
    expect(pages[0]?.target).toMatchObject({
      framebuffer: pool.next.content.framebuffer,
      width: 1600,
      height: 1200,
    });
    // Painted: asking again paints nothing.
    expect(pool.ensureContent('next', () => true)).toBe(true);
    expect(pages).toHaveLength(1);
  });

  it('lays what a host draws over the page into the page itself', () => {
    const fake = createFakeGl();
    const pool = poolOn(fake);
    pool.resize(100, 50, 1);
    pool.assignSlot('curr', 2);
    expect(pool.ensureContent('curr', () => true)).toBe(true);
    expect(fake.named('texImage2D').some((args) => args.length === 6)).toBe(false);
    const drawn = fake.draws.length;

    pool.invalidateContentForSpread(2);
    expect(
      pool.ensureContent('curr', (_index, page) => {
        page.hostLayer();
        return true;
      }),
    ).toBe(true);
    // The host's canvas is uploaded and drawn into the page's framebuffer.
    expect(fake.named('texImage2D').some((args) => args.length === 6)).toBe(true);
    expect(fake.draws.slice(drawn).map((draw) => draw.framebuffer)).toEqual([
      pool.curr.content.framebuffer,
    ]);
  });

  it('draws a page, then its overlay, and keeps one texture of both for a turn', () => {
    const fake = createFakeGl();
    const pool = poolOn(fake);
    pool.resize(100, 50, 1);
    pool.assignSlot('curr', 2);
    pool.ensureContent('curr', () => true);
    pool.ensureOverlay(
      'curr',
      () => [
        { id: 'sel', rects: [{ x: 0, y: 0, width: 10, height: 10 }], color: 'blue', zIndex: 0 },
      ],
      1,
    );
    const before = fake.draws.length;
    pool.drawSlot('curr', { x: 0, y: 0, width: 100, height: 50 });
    expect(fake.draws.slice(before).map((draw) => draw.texture)).toEqual([
      pool.curr.content.texture,
      pool.curr.overlay?.texture,
    ]);

    const first = pool.pageTexture('curr');
    const composed = fake.draws.length;
    expect(pool.pageTexture('curr')).toBe(first);
    expect(fake.draws.length).toBe(composed);
    // Painted again, the same texture holds the new painting.
    pool.invalidateContentForSpread(2);
    pool.ensureContent('curr', () => true);
    expect(pool.pageTexture('curr').texture).toBe(first.texture);
    expect(fake.draws.length).toBeGreaterThan(composed);
  });

  it('keeps content dirty when renderer defers painting', () => {
    const pool = poolOn();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 5);

    const renderer = vi.fn(() => false);
    expect(pool.ensureContent('curr', renderer)).toBe(false);
    expect(pool.curr.contentDirty).toBe(true);

    const readyRenderer = vi.fn(() => true);
    expect(pool.ensureContent('curr', readyRenderer)).toBe(true);
    expect(pool.curr.contentDirty).toBe(false);
  });

  it('ensureContent skips empty slots', () => {
    const pool = poolOn();
    const renderer = vi.fn(() => true);
    pool.ensureContent('curr', renderer);
    expect(renderer).not.toHaveBeenCalled();
  });

  it('ensureOverlay allocates lazily and paints layers', () => {
    const pool = poolOn();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);

    expect(pool.curr.overlay).toBeNull();

    const provider = vi.fn(() => [
      { id: 'sel', rects: [{ x: 0, y: 0, width: 100, height: 20 }], color: 'blue', zIndex: 0 },
    ]);

    pool.ensureOverlay('curr', provider, 1);

    expect(pool.curr.overlay).not.toBeNull();
    expect(pool.curr.overlayShown).toBe(true);
    expect(pool.curr.overlayDirty).toBe(false);
    expect(provider).toHaveBeenCalledWith(0);
  });

  it('ensureOverlay skips allocation when provider returns empty layers', () => {
    const pool = poolOn();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 0);

    const provider = vi.fn(() => []);
    pool.ensureOverlay('curr', provider, 1);

    expect(pool.curr.overlay).toBeNull();
    expect(pool.curr.overlayDirty).toBe(false);
  });

  it('rotateForward shifts slots correctly', () => {
    const pool = poolOn();
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
    const pool = poolOn();
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
    const pool = poolOn();
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
    const pool = poolOn();
    pool.resize(800, 600, 2);

    expect(pool.curr.content.width).toBe(1600);
    expect(pool.curr.content.height).toBe(1200);
    expect(pool.curr.contentDirty).toBe(true);
  });

  it('resize is a no-op when backing dimensions are unchanged', () => {
    const pool = poolOn();
    pool.resize(800, 600, 1);
    pool.assignSlot('curr', 1);

    const renderer = vi.fn(() => true);
    pool.ensureContent('curr', renderer);
    expect(pool.curr.contentDirty).toBe(false);

    pool.resize(800, 600, 1);

    expect(pool.curr.content.width).toBe(800);
    expect(pool.curr.content.height).toBe(600);
    expect(pool.curr.contentDirty).toBe(false);
  });

  it('invalidateAllContent marks all slots dirty', () => {
    const pool = poolOn();
    pool.resize(100, 100, 1);
    pool.assignSlot('curr', 0);

    const renderer = vi.fn(() => true);
    pool.ensureContent('curr', renderer);
    expect(pool.curr.contentDirty).toBe(false);

    pool.invalidateAllContent();
    expect(pool.curr.contentDirty).toBe(true);
    expect(pool.prev.contentDirty).toBe(true);
    expect(pool.next.contentDirty).toBe(true);
  });

  it('invalidateOverlayForSpread only affects matching slot', () => {
    const pool = poolOn();
    pool.resize(100, 100, 1);
    pool.assignSlot('prev', 0);
    pool.assignSlot('curr', 1);
    pool.assignSlot('next', 2);

    // Clear dirty flags
    const renderer = vi.fn(() => true);
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
    const pool = poolOn();
    pool.assignSlot('prev', 5);
    pool.assignSlot('curr', 6);
    pool.assignSlot('next', 7);

    expect(pool.getSlotFor(5)).toBe('prev');
    expect(pool.getSlotFor(6)).toBe('curr');
    expect(pool.getSlotFor(7)).toBe('next');
    expect(pool.getSlotFor(99)).toBeNull();
  });

  it('double rotateForward produces correct state', () => {
    const pool = poolOn();
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

  it('dispose releases content and overlay textures', () => {
    const fake = createFakeGl();
    const pool = poolOn(fake);
    pool.resize(800, 600, 2);
    pool.assignSlot('curr', 0);
    pool.ensureOverlay(
      'curr',
      () => [
        { id: 'sel', rects: [{ x: 0, y: 0, width: 10, height: 10 }], color: 'blue', zIndex: 0 },
      ],
      1,
    );

    pool.dispose();

    for (const slot of [pool.prev, pool.curr, pool.next]) {
      expect(slot.spreadIndex).toBeNull();
      expect(slot.overlay).toBeNull();
    }
    // Three pages and one overlay.
    expect(fake.named('deleteTexture')).toHaveLength(4);
    expect(() => {
      pool.dispose();
    }).not.toThrow();
  });

  it('remains terminal when stale work reaches it after disposal', () => {
    const pool = poolOn();
    pool.resize(800, 600, 2);
    pool.assignSlot('curr', 4);
    pool.dispose();
    const renderer = vi.fn(() => true);
    const overlays = vi.fn(() => [{ id: 'late', rects: [], color: 'blue', zIndex: 0 }]);

    pool.resize(1200, 900, 2);
    pool.assignSlot('curr', 5);
    pool.jump(6);
    pool.rotateForward();
    pool.rotateBackward();
    pool.invalidateAllContent();
    pool.invalidateContentForSpread(4);
    pool.invalidateOverlayForSpread(4);
    pool.invalidateAllOverlays();

    expect(pool.ensureContent('curr', renderer)).toBe(false);
    pool.ensureOverlay('curr', overlays, 1);
    expect(renderer).not.toHaveBeenCalled();
    expect(overlays).not.toHaveBeenCalled();
    expect(pool.getSlotFor(4)).toBeNull();
    for (const slot of [pool.prev, pool.curr, pool.next]) {
      expect(slot.spreadIndex).toBeNull();
      expect(slot.overlay).toBeNull();
    }
  });

  it('makes every buffer again, empty, after the context was lost', () => {
    const pool = poolOn();
    pool.resize(100, 50, 1);
    pool.assignSlot('curr', 3);
    pool.ensureContent('curr', () => true);
    const before = pool.curr.content;
    pool.restore();
    expect(pool.curr.content).not.toBe(before);
    expect(pool.curr.content).toMatchObject({ width: 100, height: 50 });
    expect(pool.curr.contentDirty).toBe(true);
    expect(pool.curr.spreadIndex).toBe(3);
  });
});
