export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverlayLayer {
  readonly id: string;
  readonly rects: readonly Rect[];
  readonly color: string;
  readonly borderColor?: string | undefined;
  readonly zIndex: number;
}

export interface OverlayRenderer {
  /** Mount the overlay canvas into the container, positioned absolute over the main canvas. */
  mount(container: HTMLElement): void;
  /** Sync overlay canvas size with the main canvas. */
  setSize(width: number, height: number, dpr: number): void;
  /** Clear and redraw all layers sorted by zIndex. renderScale maps layout coords to display coords. */
  render(layers: readonly OverlayLayer[], renderScale?: number): void;
  /** Clear the overlay. */
  clear(): void;
  /** The overlay canvas element. */
  readonly canvas: HTMLCanvasElement;
  /** Remove canvas and clean up. */
  dispose(): void;
}
