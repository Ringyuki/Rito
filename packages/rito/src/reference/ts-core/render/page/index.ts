import type { LayoutConfig, Page } from '../../layout/core/types';
import {
  canvasDisplayListRenderer,
  type CanvasRenderingTarget,
  type CanvasRenderOptions,
} from '../backends/canvas';
import { buildPageDisplayList } from '../display-list';

/**
 * Render a page onto a Canvas 2D target.
 *
 * Builds a platform-neutral display list for the page, then executes it with
 * the default Web Canvas backend.
 *
 * @param page - The {@link Page} to render.
 * @param ctx - The canvas 2D rendering context.
 * @param config - Page dimensions and margins (used for content offset).
 * @param options - Optional rendering settings (background color, pixel ratio, images).
 */
export function renderPage(
  page: Page,
  ctx: CanvasRenderingTarget,
  config: LayoutConfig,
  options?: CanvasRenderOptions,
): void {
  canvasDisplayListRenderer.render(buildPageDisplayList(page, config, options), ctx, {
    ...(options?.pixelRatio !== undefined ? { pixelRatio: options.pixelRatio } : {}),
    ...(options?.imageResolver ? { imageResolver: options.imageResolver } : {}),
    ...(options?.images ? { images: options.images } : {}),
  });
}
