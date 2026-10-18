// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canDrawWithWebGl2,
  createDisplaySurface,
  WebGlUnavailableError,
} from '../src/painter/display-surface';
import { createFakeGl } from './helpers/fake-gl';

function createMockCanvas(available = true) {
  const fake = createFakeGl();
  const getContext = vi.fn((kind: string) => (available && kind === 'webgl2' ? fake.gl : null));
  const canvas = {
    width: 0,
    height: 0,
    style: {
      width: '',
      height: '',
      imageRendering: '',
      zoom: '',
      objectFit: '',
      objectPosition: '',
    },
    getContext,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
  return { canvas, fake, getContext };
}

describe('DisplaySurface', () => {
  it('draws with a WebGL2 context of the canvas, kept for a host to read back', () => {
    const { canvas, fake, getContext } = createMockCanvas();
    const surface = createDisplaySurface(canvas);
    expect(surface.canvas).toBe(canvas);
    expect(surface.gl).toBe(fake.gl);
    expect(getContext).toHaveBeenCalledWith(
      'webgl2',
      expect.objectContaining({ preserveDrawingBuffer: true, antialias: false }),
    );
  });

  describe('against the screen', () => {
    /** A screen at `ratio` whose resolution query can be told it changed. */
    function stubScreen(ratio: number) {
      const changes: (() => void)[] = [];
      const viewport = Object.assign(new EventTarget(), { scale: 1 });
      vi.stubGlobal('devicePixelRatio', ratio);
      vi.stubGlobal('visualViewport', viewport);
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          media: query,
          addEventListener: (_type: string, listener: () => void) => changes.push(listener),
          removeEventListener: (_type: string, listener: () => void) => {
            const at = changes.indexOf(listener);
            if (at >= 0) changes.splice(at, 1);
          },
        })),
      );
      return {
        viewport,
        moveTo(next: number): void {
          vi.stubGlobal('devicePixelRatio', next);
          for (const listener of changes.splice(0)) listener();
        },
        get watching(): number {
          return changes.length;
        },
      };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('shows its pixels as they are while painted at the screen ratio, smoothed while stretched', () => {
      const screen = stubScreen(2);
      const { canvas } = createMockCanvas();
      const surface = createDisplaySurface(canvas);
      expect(canvas.style.imageRendering).toBe('pixelated');

      surface.setSize(800, 600, 2);
      expect(canvas.style.imageRendering).toBe('pixelated');
      // The page zoomed: until the pages are painted at the new ratio the
      // browser stretches the canvas, and smooths it.
      screen.moveTo(3);
      expect(canvas.style.imageRendering).toBe('auto');
      surface.setSize(800, 600, 3);
      expect(canvas.style.imageRendering).toBe('pixelated');
      // A pinch magnifies the canvas.
      screen.viewport.scale = 2;
      screen.viewport.dispatchEvent(new Event('resize'));
      expect(canvas.style.imageRendering).toBe('auto');
      screen.viewport.scale = 1;
      screen.viewport.dispatchEvent(new Event('resize'));
      expect(canvas.style.imageRendering).toBe('pixelated');
    });

    it('tells when the screen ratio changes, and stops listening when disposed', () => {
      const screen = stubScreen(1);
      const { canvas } = createMockCanvas();
      const surface = createDisplaySurface(canvas);
      const ratios: number[] = [];
      surface.onPixelRatioChange((ratio) => ratios.push(ratio));

      screen.moveTo(1.25);
      screen.moveTo(2);
      expect(ratios).toEqual([1.25, 2]);
      expect(screen.watching).toBe(1);
      surface.dispose();
      expect(screen.watching).toBe(0);
    });
  });

  it('says so where the browser gives no WebGL2', () => {
    const { canvas } = createMockCanvas(false);
    expect(() => createDisplaySurface(canvas)).toThrow(WebGlUnavailableError);
  });

  it('tells a host ahead of time whether it can draw, letting the probe go', () => {
    const loseContext = vi.fn();
    const probe = { getExtension: () => ({ loseContext }) };
    const createElement = vi.spyOn(document, 'createElement');
    createElement.mockReturnValueOnce({ getContext: () => probe } as unknown as HTMLElement);
    expect(canDrawWithWebGl2()).toBe(true);
    expect(loseContext).toHaveBeenCalledOnce();
    createElement.mockReturnValueOnce({ getContext: () => null } as unknown as HTMLElement);
    expect(canDrawWithWebGl2()).toBe(false);
    createElement.mockRestore();
  });

  describe('shows its size at one drawing-buffer pixel per device pixel', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('from a drawing buffer as large as the screen, cropped to the bottom-left', () => {
      vi.stubGlobal('screen', { width: 1440, height: 900 });
      const { canvas } = createMockCanvas();
      const surface = createDisplaySurface(canvas);

      surface.setSize(800, 600, 2);

      expect([canvas.width, canvas.height]).toEqual([2880, 1800]);
      expect([surface.width, surface.height]).toEqual([1600, 1200]);
      // Zoomed out by the ratio, a 1600 × 1200 box is 800 × 600 CSS pixels.
      expect(canvas.style).toMatchObject({
        zoom: '0.5',
        width: '1600px',
        height: '1200px',
        objectFit: 'none',
        objectPosition: 'left bottom',
      });
    });

    it('never reallocating to shrink, growing only a side that does not fit', () => {
      vi.stubGlobal('screen', { width: 1000, height: 700 });
      const { canvas } = createMockCanvas();
      const surface = createDisplaySurface(canvas);
      const sizes: string[] = [];
      let width = 0;
      let height = 0;
      Object.defineProperty(canvas, 'width', {
        get: () => width,
        set: (value: number) => {
          width = value;
          sizes.push(`width ${String(value)}`);
        },
      });
      Object.defineProperty(canvas, 'height', {
        get: () => height,
        set: (value: number) => {
          height = value;
          sizes.push(`height ${String(value)}`);
        },
      });

      surface.setSize(900, 600, 1);
      surface.setSize(500, 400, 1);
      surface.setSize(1200, 650, 1);

      expect(sizes).toEqual(['width 1000', 'height 700', 'width 1200']);
      expect([surface.width, surface.height]).toEqual([1200, 650]);
    });
  });

  it('clear binds the canvas over its whole backing store and clears it', () => {
    const { canvas, fake } = createMockCanvas();
    const surface = createDisplaySurface(canvas);

    surface.setSize(800, 600, 1);
    surface.clear();

    expect(fake.named('bindFramebuffer').at(-1)?.[1]).toBeNull();
    expect(fake.named('viewport').at(-1)).toEqual([0, 0, 800, 600]);
    expect(fake.named('clear')).toHaveLength(1);
  });

  it('keeps a lost context restorable and, once it is back, remakes its programs before telling', () => {
    const fake = createFakeGl();
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn(() => fake.gl) as unknown as typeof canvas.getContext;
    const surface = createDisplaySurface(canvas);
    const linkedBefore = fake.named('linkProgram').length;
    const restored = vi.fn(() => {
      // The compositor has its programs again by the time anyone is told.
      expect(fake.named('linkProgram').length).toBe(linkedBefore * 2);
    });
    surface.onRestored(restored);

    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(restored).toHaveBeenCalledOnce();
  });
});
