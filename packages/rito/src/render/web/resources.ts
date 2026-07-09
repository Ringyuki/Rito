import { loadFontsWithRegistry, loadImagesWithDecoder } from '../assets';
import {
  canvasTextMeasurementBackend,
  type CachedTextMeasurer,
  type CanvasTextMeasurementTarget,
} from '../backends/canvas';
import { createLogger, type Logger } from '../../utils/logger';
import {
  createWebFontRegistry,
  createWebImageAssetResolver,
  createWebImageDecoder,
} from '../assets/web';
import type {
  FontRegistry,
  EpubAssetSource,
  ImageAssetResolver,
  ImageDecoder,
  ImageObjectUrlProvider,
} from '../assets/types';

const disposedAssets = new WeakSet();

/** Decoded Web assets (fonts registered, images decoded). Reusable across resizes. */
export interface LoadedAssets {
  readonly images: ReadonlyMap<string, ImageBitmap>;
  readonly imageResolver: ImageAssetResolver<ImageBitmap>;
  readonly imageObjectUrlProvider?: ImageObjectUrlProvider;
  readonly imageDecoder: ImageDecoder<ImageBitmap>;
  readonly fontRegistry?: FontRegistry;
  readonly measurer: CachedTextMeasurer;
}

/** Load Web fonts and decode images. Result is reusable across resizes. */
export async function loadAssets(
  doc: EpubAssetSource,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  logger?: Logger,
): Promise<LoadedAssets> {
  const log = logger ?? createLogger();
  const imageDecoder = createWebImageDecoder();
  const fontRegistry = createWebFontRegistry();
  const [fontResult, imageResult] = await Promise.allSettled([
    loadFontsWithRegistry(doc, fontRegistry, log),
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
  try {
    const imageResolver = createWebImageAssetResolver(images, doc.images);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context from canvas');
    const measurer = canvasTextMeasurementBackend.createTextMeasurer(
      ctx as CanvasTextMeasurementTarget,
    );

    return {
      images,
      imageResolver,
      imageObjectUrlProvider: imageResolver,
      imageDecoder,
      fontRegistry,
      measurer,
    };
  } catch (error: unknown) {
    disposeLoadedResources(images, imageDecoder, fontRegistry);
    throw error;
  }
}

/** Release GPU/memory resources held by decoded Web images. */
export function disposeAssets(assets: LoadedAssets): void {
  if (disposedAssets.has(assets)) return;
  disposedAssets.add(assets);
  disposeLoadedResources(assets.images, assets.imageDecoder, assets.fontRegistry);
}

function disposeLoadedResources(
  images: ReadonlyMap<string, ImageBitmap>,
  imageDecoder: ImageDecoder<ImageBitmap>,
  fontRegistry: FontRegistry | undefined,
): void {
  for (const bitmap of images.values()) imageDecoder.dispose(bitmap);
  fontRegistry?.dispose?.();
}
