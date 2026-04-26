import { buildHrefResolver } from '../../utils/resolve-href';
import { createLogger, type Logger } from '../../utils/logger';
import type { ImageAssetResolver, ImageDecoder, ImageDimensions } from './types';

/**
 * A lazy image decoder with LRU eviction.
 *
 * Instead of decoding all images upfront, this decodes on demand and
 * keeps at most `maxSize` decoded images in memory. When the cache is full,
 * the least recently used entry is evicted through the decoder's disposer.
 */
export interface LazyImageLoader<
  TImage extends ImageDimensions,
> extends ImageAssetResolver<TImage> {
  /** Get a decoded image, decoding on demand if not cached. */
  get(src: string): Promise<TImage | undefined>;
  /** Get a synchronously cached image, or undefined if not yet decoded. */
  getCached(src: string): TImage | undefined;
  /** Pre-decode specific images (e.g., for the current spread). */
  preload(srcs: readonly string[]): Promise<void>;
  /** Release all cached images. */
  dispose(): void;
}

class LruCache<TImage extends ImageDimensions> {
  private readonly cache = new Map<string, TImage>();
  private readonly order: string[] = [];
  constructor(
    private readonly maxSize: number,
    private readonly disposeImage: (image: TImage) => void,
  ) {}

  get(key: string): TImage | undefined {
    return this.cache.get(key);
  }

  set(key: string, image: TImage): void {
    this.cache.set(key, image);
    this.touch(key);
    this.evict();
  }

  touch(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(key);
  }

  clear(): void {
    for (const image of this.cache.values()) this.disposeImage(image);
    this.cache.clear();
    this.order.length = 0;
  }

  private evict(): void {
    while (this.order.length > this.maxSize) {
      const oldest = this.order.shift();
      if (oldest) {
        const image = this.cache.get(oldest);
        if (image) this.disposeImage(image);
        this.cache.delete(oldest);
      }
    }
  }
}

export function createLazyImageLoaderWithDecoder<TImage extends ImageDimensions>(
  imageData: ReadonlyMap<string, Uint8Array>,
  decoder: ImageDecoder<TImage>,
  maxSize = 50,
  logger?: Logger,
): LazyImageLoader<TImage> {
  const log = logger ?? createLogger();
  const resolve = buildHrefResolver(imageData);
  const lru = new LruCache<TImage>(maxSize, (image) => {
    decoder.dispose(image);
  });

  async function decode(src: string, data: Uint8Array): Promise<TImage> {
    const image = await decoder.decode({ href: src, bytes: data });
    lru.set(src, image);
    return image;
  }

  const loader: LazyImageLoader<TImage> = {
    async get(src: string): Promise<TImage | undefined> {
      const cached = lru.get(src);
      if (cached) {
        lru.touch(src);
        return cached;
      }
      const data = resolve(src);
      if (!data) return undefined;
      try {
        return await decode(src, data);
      } catch (err: unknown) {
        log.warn('Failed to decode image: %s', src, err);
        return undefined;
      }
    },
    getCached: (src: string) => lru.get(src),
    resolveImage: (src: string) => lru.get(src),
    async preload(srcs: readonly string[]): Promise<void> {
      await Promise.all(srcs.map((s) => loader.get(s)));
    },
    dispose(): void {
      lru.clear();
    },
  };
  return loader;
}
