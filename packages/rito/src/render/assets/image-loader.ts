import { createLogger, type Logger } from '../../utils/logger';
import type { EpubAssetSource, ImageDecoder, ImageDimensions } from './types';

export interface ImageLoadOptions {
  /** Maximum number of images decoded concurrently. Defaults to 4. */
  readonly maxConcurrency?: number;
}

const DEFAULT_MAX_CONCURRENCY = 4;

/**
 * Decode all EPUB-embedded images through an injected platform decoder.
 */
export async function loadImagesWithDecoder<TImage extends ImageDimensions>(
  doc: Pick<EpubAssetSource, 'images'>,
  decoder: ImageDecoder<TImage>,
  logger?: Logger,
  options?: ImageLoadOptions,
): Promise<ReadonlyMap<string, TImage>> {
  const log = logger ?? createLogger();
  const result = new Map<string, TImage>();
  const entries = Array.from(doc.images.entries());
  const maxConcurrency = normalizeConcurrency(options?.maxConcurrency);
  let nextIndex = 0;

  async function decodeNext(): Promise<void> {
    while (nextIndex < entries.length) {
      const entry = entries[nextIndex++];
      if (!entry) continue;
      const [href, data] = entry;
      try {
        const bitmap = await decoder.decode({ href, bytes: data });
        result.set(href, bitmap);
      } catch (err: unknown) {
        log.warn('Failed to decode image: %s', href, err);
      }
    }
  }

  const workerCount = Math.min(maxConcurrency, entries.length);
  await Promise.all(Array.from({ length: workerCount }, () => decodeNext()));
  return result;
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CONCURRENCY;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError('maxConcurrency must be a positive integer');
  }
  return value;
}
