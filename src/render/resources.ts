import type { LayoutConfig, Page } from '../layout/types';
import type { EpubDocument } from '../runtime/types';
import { loadFonts } from './font-loader';
import { loadImages } from './image-loader';
import { createCanvasTextMeasurer } from './canvas-text-measurer';
import { paginate } from '../runtime/paginate';

/** Resources produced by {@link prepare}, needed for rendering. */
export interface Resources {
  /** Paginated pages ready for spread building and rendering. */
  readonly pages: readonly Page[];
  /** Decoded image bitmaps for rendering. */
  readonly images: ReadonlyMap<string, ImageBitmap>;
}

/**
 * Prepare an EPUB document for rendering in one async step.
 *
 * Loads fonts, decodes images, measures text, and paginates all chapters.
 *
 * @example
 * ```ts
 * const doc = loadEpub(data);
 * const config = createLayoutConfig({ width: 800, height: 600, margin: 40 });
 * const { pages, images } = await prepare(doc, config, canvas);
 * const spreads = buildSpreads(pages, config);
 * render(spreads[0], ctx, config, { images, backgroundColor: '#fff' });
 * ```
 */
export async function prepare(
  doc: EpubDocument,
  config: LayoutConfig,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Resources> {
  const [, images] = await Promise.all([loadFonts(doc), loadImages(doc)]);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context from canvas');
  const measurer = createCanvasTextMeasurer(ctx as CanvasRenderingContext2D);

  const pages = paginate(doc, config, measurer, images);
  return { pages, images };
}
