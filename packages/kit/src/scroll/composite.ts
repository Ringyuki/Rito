import type { GlCompositor, QuadRect } from '../painter/gl/compositor';
import type { ScrollGeometry, ScrollWindow } from './geometry';

/**
 * Where window `window` lands on a `width` × `height` device-pixel view
 * scrolled to device offset `offset`: below the one before it, or left of
 * it for a book that scrolls leftwards, whose start is the view's right
 * edge.
 */
export function windowRect(
  geometry: ScrollGeometry,
  window: ScrollWindow,
  offset: number,
  width: number,
  height: number,
): QuadRect {
  const along = window.start - offset;
  return geometry.axis === 'down'
    ? { x: 0, y: along, width, height: window.length }
    : { x: width - along - window.length, y: 0, width: window.length, height };
}

/** What is drawn at a window's place on the view; undefined for nothing yet. */
export type WindowLayer = (window: ScrollWindow, rect: QuadRect) => WebGLTexture | undefined;

/**
 * Draws the windows a view scrolled to `offset` shows, each at whole device
 * pixels, the ones still loading left as the ground, and over each its
 * overlay. Returns the windows it could not draw yet.
 *
 * Every window's picture is had first: painting one binds its own
 * framebuffer, and a window drawn from its texture while that framebuffer
 * is bound would be drawn into itself rather than onto the view. The view
 * is bound once they all are.
 */
export function compositeWindows(
  compositor: GlCompositor,
  geometry: ScrollGeometry,
  offset: number,
  width: number,
  height: number,
  picture: WindowLayer,
  overlay?: WindowLayer,
): readonly ScrollWindow[] {
  const at = Math.round(offset);
  const missing: ScrollWindow[] = [];
  const shown: { rect: QuadRect; layers: WebGLTexture[] }[] = [];
  const length = geometry.axis === 'down' ? height : width;
  for (const window of geometry.visible(at, length)) {
    const rect = windowRect(geometry, window, at, width, height);
    const texture = picture(window, rect);
    if (texture === undefined) {
      missing.push(window);
      continue;
    }
    const over = overlay?.(window, rect);
    shown.push({ rect, layers: over === undefined ? [texture] : [texture, over] });
  }
  compositor.bind(null, width, height);
  for (const { rect, layers } of shown) {
    for (const layer of layers) compositor.drawTexture(layer, rect);
  }
  return missing;
}
