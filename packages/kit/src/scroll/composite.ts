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

/**
 * Draws the windows a view scrolled to `offset` shows, each at whole device
 * pixels, the ones still loading left as the ground. Returns the windows
 * it could not draw yet.
 */
export function compositeWindows(
  compositor: GlCompositor,
  geometry: ScrollGeometry,
  offset: number,
  width: number,
  height: number,
  picture: (window: ScrollWindow, rect: QuadRect) => WebGLTexture | undefined,
): readonly ScrollWindow[] {
  const at = Math.round(offset);
  const missing: ScrollWindow[] = [];
  const length = geometry.axis === 'down' ? height : width;
  for (const window of geometry.visible(at, length)) {
    const rect = windowRect(geometry, window, at, width, height);
    const texture = picture(window, rect);
    if (texture === undefined) missing.push(window);
    else compositor.drawTexture(texture, rect);
  }
  return missing;
}
