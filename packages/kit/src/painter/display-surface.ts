import { createCompositor, type GlCompositor } from './gl/compositor';
import { pinchScale, screenRatio, watchScreen } from './screen';

/** Thrown where the browser gives no WebGL2 context: the reader draws its pages with it. */
export class WebGlUnavailableError extends Error {
  constructor() {
    super('@ritojs/kit draws pages with WebGL2, which this browser does not provide');
    this.name = 'WebGlUnavailableError';
  }
}

/**
 * Thin wrapper around the single display canvas and its WebGL2 context.
 * All visual output flows through this surface — no other code writes to the display canvas.
 */
export interface DisplaySurface {
  /** The display canvas element (lives in DOM). */
  readonly canvas: HTMLCanvasElement;
  /** The canvas's WebGL2 context; the page buffers live in it too. */
  readonly gl: WebGL2RenderingContext;
  readonly compositor: GlCompositor;
  /** Width of the region shown, in device pixels. */
  readonly width: number;
  /** Height of the region shown, in device pixels. */
  readonly height: number;
  /**
   * Shows `cssWidth` × `cssHeight` CSS pixels, one drawing-buffer pixel per
   * device pixel at `dpr`: the bottom-left corner of the drawing buffer,
   * where the framebuffer's origin is, so whatever draws to it draws to
   * that region as it always has. The drawing buffer only ever grows, and
   * starts at the screen's size: assigning a canvas's size reallocates the
   * buffer and makes the page wait for the GPU, which a window dragged
   * through a new size every frame paid on every frame.
   */
  setSize(cssWidth: number, cssHeight: number, dpr: number): void;
  /** Binds the canvas's own framebuffer and clears it. */
  clear(): void;
  /**
   * Calls back when the context was lost and has been restored, after the
   * compositor has made its programs again: everything else held in the
   * context is gone and must be made and painted again. Returns the unsubscribe.
   */
  onRestored(listener: () => void): () => void;
  /**
   * Calls back with the screen's pixel ratio whenever it changes (the page
   * zoomed, the window went to another screen). Returns the unsubscribe.
   */
  onPixelRatioChange(listener: (ratio: number) => void): () => void;
  /** Stops listening to the canvas and the screen. */
  dispose(): void;
}

const DISPLAY_CONTEXT: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  // A host may read the display back (a screenshot, a thumbnail) at any time.
  preserveDrawingBuffer: true,
};

/**
 * Whether this browser, on this machine, gives the WebGL2 context the
 * controller draws with. It does not where the browser has no GPU it will
 * use — hardware acceleration turned off, a GPU it blocks — so a host can
 * ask before it opens a book and say so instead.
 */
export function canDrawWithWebGl2(): boolean {
  if (typeof document === 'undefined') return false;
  const gl = document.createElement('canvas').getContext('webgl2', DISPLAY_CONTEXT);
  if (!gl) return false;
  // Browsers keep few contexts alive at once: this one is let go at once.
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

export function createDisplaySurface(canvas: HTMLCanvasElement): DisplaySurface {
  const gl = canvas.getContext('webgl2', DISPLAY_CONTEXT);
  if (!gl) throw new WebGlUnavailableError();
  const compositor = createCompositor(gl);
  const restoration = listenForRestoration(canvas, compositor);
  const presentation = presentOnScreen(canvas);
  // The canvas shows the bottom-left region of its drawing buffer as it
  // is (see `setSize`).
  canvas.style.objectFit = 'none';
  canvas.style.objectPosition = 'left bottom';
  let w = canvas.width;
  let h = canvas.height;

  return {
    canvas,
    gl,
    compositor,
    onRestored: restoration.onRestored,
    onPixelRatioChange: presentation.onPixelRatioChange,
    dispose(): void {
      restoration.dispose();
      presentation.dispose();
    },
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    setSize(cssWidth: number, cssHeight: number, dpr: number): void {
      w = Math.round(cssWidth * dpr);
      h = Math.round(cssHeight * dpr);
      growDrawingBuffer(canvas, w, h, dpr);
      // Zoomed out by the ratio, the canvas shows its drawing buffer at
      // one pixel per device pixel; its box, the given CSS size, crops it
      // to the bottom-left region.
      canvas.style.zoom = String(1 / dpr);
      canvas.style.width = `${String(cssWidth * dpr)}px`;
      canvas.style.height = `${String(cssHeight * dpr)}px`;
      presentation.paintedAt(dpr);
    },
    clear(): void {
      compositor.bind(null, w, h);
      compositor.clear();
    },
  };
}

/**
 * Grows the drawing buffer to hold `width` × `height` device pixels and,
 * the first time, the whole screen at `dpr`: a window is never larger
 * than its screen, so dragging one through any size reallocates nothing.
 * Each assignment reallocates whatever the value, so only a growing side
 * is assigned.
 */
function growDrawingBuffer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
): void {
  const screenSize = globalThis.screen as Screen | undefined;
  const targetWidth = Math.max(width, Math.ceil((screenSize?.width ?? 0) * dpr));
  const targetHeight = Math.max(height, Math.ceil((screenSize?.height ?? 0) * dpr));
  if (canvas.width < targetWidth) canvas.width = targetWidth;
  if (canvas.height < targetHeight) canvas.height = targetHeight;
}

/**
 * How the browser shows the canvas. Painted at the screen's ratio and not
 * magnified, the canvas holds one pixel per device pixel, and the browser
 * is asked to show them as they are: filtered, Chrome compositing in
 * software showed part of the canvas blended with the next row, and a
 * canvas whose CSS height times the ratio is not whole came out blurred.
 * Stretched — the page zoomed and not yet painted at the new ratio, or a
 * pinch magnifying it — the canvas is smoothed, as the browser smooths
 * the page.
 */
function presentOnScreen(canvas: HTMLCanvasElement): {
  paintedAt(ratio: number): void;
  onPixelRatioChange: DisplaySurface['onPixelRatioChange'];
  dispose(): void;
} {
  let painted = screenRatio();
  const listeners = new Set<(ratio: number) => void>();
  const present = (): void => {
    const asPainted = painted === screenRatio() && pinchScale() === 1;
    canvas.style.imageRendering = asPainted ? 'pixelated' : 'auto';
  };
  const stop = watchScreen((ratio) => {
    present();
    for (const listener of [...listeners]) listener(ratio);
  }, present);
  present();
  return {
    paintedAt(ratio): void {
      painted = ratio;
      present();
    },
    onPixelRatioChange(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      listeners.clear();
      stop();
    },
  };
}

/** Keeps a lost context restorable and, once it is back, remakes the compositor's programs before telling. */
function listenForRestoration(
  canvas: HTMLCanvasElement,
  compositor: GlCompositor,
): Pick<DisplaySurface, 'onRestored' | 'dispose'> {
  const restored = new Set<() => void>();
  // Without this the browser would not give the context back.
  const lost = (event: Event): void => {
    event.preventDefault();
  };
  const back = (): void => {
    compositor.restore();
    for (const listener of [...restored]) listener();
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', back);
  return {
    onRestored(listener): () => void {
      restored.add(listener);
      return () => restored.delete(listener);
    },
    dispose(): void {
      restored.clear();
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', back);
    },
  };
}
