import type { LayoutConfig, Page } from '../layout/types';
import type { ChapterRange, EpubDocument } from '../runtime/types';
import { loadFonts } from './font-loader';
import { loadImages } from './image-loader';
import { createCanvasTextMeasurer } from './canvas-text-measurer';
import { paginateWithMeta } from '../runtime/paginate';

/** Resources produced by {@link prepare}, needed for rendering. */
export interface Resources {
  /** Paginated pages ready for spread building and rendering. */
  readonly pages: readonly Page[];
  /** Decoded image bitmaps for rendering. */
  readonly images: ReadonlyMap<string, ImageBitmap>;
  /** Map from spine item idref to page range. */
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  /** Map from fragment identifier (id attribute) to page index. */
  readonly anchorMap: ReadonlyMap<string, number>;
}

/**
 * Load fonts, decode images, paginate chapters, and return everything
 * needed to render spreads.
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
  const [fontResult, imageResult] = await Promise.allSettled([loadFonts(doc), loadImages(doc)]);
  if (fontResult.status === 'rejected') console.warn('Font loading failed:', fontResult.reason);
  const images =
    imageResult.status === 'fulfilled' ? imageResult.value : new Map<string, ImageBitmap>();

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context from canvas');
  const measurer = createCanvasTextMeasurer(ctx as CanvasRenderingContext2D);

  const { pages, chapterMap, anchorMap } = paginateWithMeta(doc, config, measurer, images);
  return { pages, images, chapterMap, anchorMap };
}

/**
 * Release GPU/memory resources held by a {@link Resources} object.
 * Calls `.close()` on each decoded ImageBitmap.
 */
export function disposeResources(resources: Resources): void {
  for (const bitmap of resources.images.values()) {
    bitmap.close();
  }
}
