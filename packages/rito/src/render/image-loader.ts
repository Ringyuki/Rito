import type { EpubDocument } from '../runtime/types';
import { createLogger, type Logger } from '../utils/logger';

/**
 * Decode all EPUB-embedded images into ImageBitmaps for canvas rendering.
 *
 * Must be called before rendering. Returns a map from image href to decoded ImageBitmap.
 *
 * @example
 * ```ts
 * const images = await loadImages(doc);
 * render(spread, ctx, config, { images });
 * ```
 */
export async function loadImages(
  doc: EpubDocument,
  logger?: Logger,
): Promise<ReadonlyMap<string, ImageBitmap>> {
  const log = logger ?? createLogger();
  const result = new Map<string, ImageBitmap>();
  const entries = Array.from(doc.images.entries());

  const promises = entries.map(async ([href, data]) => {
    try {
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const blob = new Blob([buffer as ArrayBuffer]);
      const bitmap = await createImageBitmap(blob);
      result.set(href, bitmap);
    } catch (err: unknown) {
      log.warn('Failed to decode image: %s', href, err);
    }
  });

  await Promise.all(promises);
  return result;
}
