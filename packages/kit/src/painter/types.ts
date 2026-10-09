/** Rect in logical (viewport) coordinate space. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A single overlay highlight layer. */
export interface OverlayLayer {
  readonly id: string;
  readonly rects: readonly Rect[];
  readonly color: string;
  readonly borderColor?: string | undefined;
  readonly zIndex: number;
}

/** A rendering context that can target either on-screen or off-screen canvases. */
export type AnyRenderingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A canvas that can be either on-screen or off-screen. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** One slot in the page buffer pool. */
export interface PageBufferSlot {
  /** The spread index this slot is assigned to, or null if empty. */
  spreadIndex: number | null;
  /** Content buffer — always allocated. */
  readonly content: OffscreenCanvas;
  /** Overlay buffer — lazy, created on first overlay paint. */
  overlay: OffscreenCanvas | null;
  /** Whether the content buffer needs re-rendering. */
  contentDirty: boolean;
  /** Whether the overlay buffer needs re-rendering. */
  overlayDirty: boolean;
}

/** Named slot positions in the three-slot ring buffer. */
export type SlotPosition = 'prev' | 'curr' | 'next';
