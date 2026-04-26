import type { EpubDocument } from '../../runtime/types';
import { createLogger, type Logger } from '../../utils/logger';
import type { ImageDecoder, ImageDimensions } from './types';

/**
 * Decode all EPUB-embedded images through an injected platform decoder.
 */
export async function loadImagesWithDecoder<TImage extends ImageDimensions>(
  doc: EpubDocument,
  decoder: ImageDecoder<TImage>,
  logger?: Logger,
): Promise<ReadonlyMap<string, TImage>> {
  const log = logger ?? createLogger();
  const result = new Map<string, TImage>();
  const entries = Array.from(doc.images.entries());

  const promises = entries.map(async ([href, data]) => {
    try {
      const bitmap = await decoder.decode({ href, bytes: data });
      result.set(href, bitmap);
    } catch (err: unknown) {
      log.warn('Failed to decode image: %s', href, err);
    }
  });

  await Promise.all(promises);
  return result;
}
