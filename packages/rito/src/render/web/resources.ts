import type { LayoutConfig, Page } from '../../layout/core/types';
import type { ChapterTextIndex } from '../../interaction/anchors/chapter-text-index';
import type { FootnoteEntry } from '../../runtime/footnote-extractor';
import type { ChapterRange, EpubDocument } from '../../runtime/types';
import { loadImagesWithDecoder } from '../assets';
import {
  canvasTextMeasurementBackend,
  type CachedTextMeasurer,
  type CanvasTextMeasurementTarget,
} from '../backends/canvas';
import { paginateWithMeta } from '../../runtime/paginate';
import { createLogger, type Logger } from '../../utils/logger';
import { loadFonts } from './asset-loaders';
import { createWebImageAssetResolver, createWebImageDecoder } from '../assets/web';
import type { ImageAssetResolver, ImageDecoder, ImageObjectUrlProvider } from '../assets/types';

/** Decoded Web assets (fonts registered, images decoded). Reusable across resizes. */
export interface LoadedAssets {
  readonly images: ReadonlyMap<string, ImageBitmap>;
  readonly imageResolver: ImageAssetResolver<ImageBitmap>;
  readonly imageObjectUrlProvider?: ImageObjectUrlProvider;
  readonly imageDecoder: ImageDecoder<ImageBitmap>;
  readonly measurer: CachedTextMeasurer;
}

/** Resources produced by {@link prepare}, needed for Web Canvas rendering. */
export interface Resources {
  /** Paginated pages ready for spread building and rendering. */
  readonly pages: readonly Page[];
  /** Decoded image bitmaps for rendering. */
  readonly images: ReadonlyMap<string, ImageBitmap>;
  /** Map from spine item idref to page range. */
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  /** Map from fragment identifier (id attribute) to page index. */
  readonly anchorMap: ReadonlyMap<string, number>;
  /** Source-based chapter text indices for annotation anchoring. */
  readonly chapterTextIndices: ReadonlyMap<string, ChapterTextIndex>;
  /** Map from `manifestHref#fragment` to structured footnote entry. */
  readonly footnoteMap: ReadonlyMap<string, FootnoteEntry>;
}

/** Load Web fonts and decode images. Result is reusable across resizes. */
export async function loadAssets(
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  logger?: Logger,
): Promise<LoadedAssets> {
  const log = logger ?? createLogger();
  const imageDecoder = createWebImageDecoder();
  const [fontResult, imageResult] = await Promise.allSettled([
    loadFonts(doc, log),
    loadImagesWithDecoder(doc, imageDecoder, log),
  ]);
  if (fontResult.status === 'rejected') {
    log.warn('Font loading failed: %s', fontResult.reason);
  }
  if (imageResult.status === 'rejected') {
    log.warn('Image loading failed: %s', imageResult.reason);
  }
  const images =
    imageResult.status === 'fulfilled' ? imageResult.value : new Map<string, ImageBitmap>();
  const imageResolver = createWebImageAssetResolver(images, doc.images);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context from canvas');
  const measurer = canvasTextMeasurementBackend.createTextMeasurer(
    ctx as CanvasTextMeasurementTarget,
  );

  return { images, imageResolver, imageObjectUrlProvider: imageResolver, imageDecoder, measurer };
}

/** Run pagination using pre-loaded Web assets. */
export function paginateWithAssets(
  doc: EpubDocument,
  config: LayoutConfig,
  assets: LoadedAssets,
  lineBreaking?: 'greedy' | 'optimal',
  logger?: Logger,
): Omit<Resources, 'images'> {
  const result = paginateWithMeta(
    doc,
    config,
    assets.measurer,
    assets.images,
    lineBreaking,
    logger,
  );
  return {
    pages: result.pages,
    chapterMap: result.chapterMap,
    anchorMap: result.anchorMap,
    chapterTextIndices: result.chapterTextIndices,
    footnoteMap: result.footnoteMap,
  };
}

/**
 * Load Web assets, paginate chapters, and return everything needed to render
 * spreads with the default Web Canvas backend.
 */
export async function prepare(
  doc: EpubDocument,
  config: LayoutConfig,
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Resources> {
  const assets = await loadAssets(doc, canvas);
  const pagination = paginateWithAssets(doc, config, assets);
  return { ...pagination, images: assets.images };
}

/** Release GPU/memory resources held by decoded Web images. */
export function disposeAssets(assets: LoadedAssets): void {
  for (const bitmap of assets.images.values()) {
    assets.imageDecoder.dispose(bitmap);
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
