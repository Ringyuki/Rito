import type { GlPageTarget } from './gl/targets';

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
  /** How each rect is marked: filled (the default), or a line along its bottom edge. */
  readonly mark?: 'fill' | 'underline' | undefined;
}

/** A rendering context that can target either on-screen or off-screen canvases. */
export type AnyRenderingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A canvas that can be either on-screen or off-screen. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** One slot in the page buffer pool. */
export interface PageBufferSlot {
  /** The spread index this slot is assigned to, or null if empty. */
  spreadIndex: number | null;
  /** The page as the engine (and the host's painter) painted it. */
  content: GlPageTarget;
  /** Overlay layers, painted on a canvas of their own and kept as a texture; made on first overlay paint. */
  overlay: { readonly canvas: OffscreenCanvas; readonly texture: WebGLTexture } | null;
  /** The page with its overlay over it, for a turn that shows the page as one picture; made when asked for. */
  composed: GlPageTarget | null;
  /** The paint count `composed` was made at; -1 when it is stale. */
  composedAt: number;
  /** Whether the content buffer needs re-rendering. */
  contentDirty: boolean;
  /** Whether the overlay buffer needs re-rendering. */
  overlayDirty: boolean;
  /** Whether the overlay holds anything. */
  overlayShown: boolean;
  /** Counts every change to the pixels of either buffer. */
  paints: number;
}

/** Named slot positions in the three-slot ring buffer. */
export type SlotPosition = 'prev' | 'curr' | 'next';
