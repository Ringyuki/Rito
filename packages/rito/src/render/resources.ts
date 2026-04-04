import type { LayoutConfig, Page } from '../layout/types';
import type { ChapterRange, EpubDocument } from '../runtime/types';
import { loadFonts } from './font-loader';
import { loadImages } from './image-loader';
import { createCanvasTextMeasurer, type CachedTextMeasurer } from './canvas-text-measurer';
import { paginateWithMeta } from '../runtime/paginate';
import { createLogger, type Logger } from '../utils/logger';

/** Decoded assets (fonts registered, images decoded). Reusable across resizes. */
export interface LoadedAssets {
  readonly images: ReadonlyMap<string, ImageBitmap>;
  readonly measurer: CachedTextMeasurer;
}

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

/** Load fonts and decode images. Result is reusable across resizes. */
export async function loadAssets(
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  logger?: Logger,
): Promise<LoadedAssets> {
  const log = logger ?? createLogger();
  const [fontResult, imageResult] = await Promise.allSettled([
    loadFonts(doc, log),
    loadImages(doc, log),
  ]);
  if (fontResult.status === 'rejected') {
    log.warn('Font loading failed: %s', fontResult.reason);
  }
  if (imageResult.status === 'rejected') {
    log.warn('Image loading failed: %s', imageResult.reason);
  }
  const images =
    imageResult.status === 'fulfilled' ? imageResult.value : new Map<string, ImageBitmap>();

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context from canvas');
  const measurer = createCanvasTextMeasurer(ctx as CanvasRenderingContext2D);

  return { images, measurer };
}

/** Run pagination using pre-loaded assets. */
export function paginateWithAssets(
  doc: EpubDocument,
  config: LayoutConfig,
  assets: LoadedAssets,
  lineBreaking?: 'greedy' | 'optimal',
  logger?: Logger,
): Omit<Resources, 'images'> {
  const { pages, chapterMap, anchorMap } = paginateWithMeta(
    doc,
    config,
    assets.measurer,
    assets.images,
    lineBreaking,
    logger,
  );
  return { pages, chapterMap, anchorMap };
}

/**
 * Load fonts, decode images, paginate chapters, and return everything
 * needed to render spreads. Convenience wrapper around loadAssets + paginateWithAssets.
 */
export async function prepare(
  doc: EpubDocument,
  config: LayoutConfig,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Resources> {
  const assets = await loadAssets(doc, canvas);
  const { pages, chapterMap, anchorMap } = paginateWithAssets(doc, config, assets);
  return { pages, images: assets.images, chapterMap, anchorMap };
}

/** Release GPU/memory resources held by decoded images. */
export function disposeAssets(assets: LoadedAssets): void {
  for (const bitmap of assets.images.values()) {
    bitmap.close();
  }
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
