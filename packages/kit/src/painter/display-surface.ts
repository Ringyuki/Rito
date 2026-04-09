/**
 * Thin wrapper around the single display canvas.
 * All visual output flows through this surface — no other code writes to the display canvas.
 */
export interface DisplaySurface {
  /** The display canvas element (lives in DOM). */
  readonly canvas: HTMLCanvasElement;
  /** The 2D context of the display canvas. */
  readonly ctx: CanvasRenderingContext2D;
  /** Current backing-store width in device pixels. */
  readonly width: number;
  /** Current backing-store height in device pixels. */
  readonly height: number;
  /** Sync canvas backing store and CSS size. Backing = CSS × DPR. */
  setSize(cssWidth: number, cssHeight: number, dpr: number): void;
  /** Clear the entire display canvas. */
  clear(): void;
}

export function createDisplaySurface(canvas: HTMLCanvasElement): DisplaySurface {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context from display canvas');

  let w = canvas.width;
  let h = canvas.height;

  return {
    canvas,
    ctx,
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    setSize(cssWidth: number, cssHeight: number, dpr: number): void {
      w = Math.round(cssWidth * dpr);
      h = Math.round(cssHeight * dpr);
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${String(cssWidth)}px`;
      canvas.style.height = `${String(cssHeight)}px`;
    },
    clear(): void {
      ctx.clearRect(0, 0, w, h);
    },
  };
}
