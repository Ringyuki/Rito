import type { EpubDocument } from '../../runtime/types';
import type { Logger } from '../../utils/logger';
import {
  createLazyImageLoaderWithDecoder,
  loadFontsWithRegistry,
  loadImagesWithDecoder,
  type LazyImageLoader,
} from '../assets';
import { createWebFontRegistry, createWebImageDecoder } from '../assets/web';

/**
 * Register EPUB-embedded fonts through the Web FontFace API.
 *
 * This is the Web convenience wrapper. Platform integrations should use
 * `loadFontsWithRegistry()` with their own `FontRegistry`.
 */
export function loadFonts(doc: EpubDocument, logger?: Logger): Promise<void> {
  return loadFontsWithRegistry(doc, createWebFontRegistry(), logger);
}

/**
 * Decode all EPUB-embedded images into ImageBitmaps for Web Canvas rendering.
 *
 * Platform integrations should use `loadImagesWithDecoder()` with their own
 * `ImageDecoder`.
 */
export function loadImages(
  doc: EpubDocument,
  logger?: Logger,
): Promise<ReadonlyMap<string, ImageBitmap>> {
  return loadImagesWithDecoder(doc, createWebImageDecoder(), logger);
}

/** Create a Web ImageBitmap lazy loader backed by `createImageBitmap()`. */
export function createLazyImageLoader(
  imageData: ReadonlyMap<string, Uint8Array>,
  maxSize = 50,
  logger?: Logger,
): LazyImageLoader<ImageBitmap> {
  return createLazyImageLoaderWithDecoder(imageData, createWebImageDecoder(), maxSize, logger);
}
