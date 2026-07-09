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
    const previous = this.cache.get(key);
    if (previous && previous !== image) this.disposeImage(previous);
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
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new RangeError('maxSize must be a positive integer');
  }
  return new DecoderBackedLazyImageLoader(imageData, decoder, maxSize, logger ?? createLogger());
}

class DecoderBackedLazyImageLoader<
  TImage extends ImageDimensions,
> implements LazyImageLoader<TImage> {
  private readonly pending = new Map<string, Promise<TImage | undefined>>();
  private readonly resolveHref: (src: string) => string | undefined;
  private readonly lru: LruCache<TImage>;
  private disposed = false;

  constructor(
    private readonly imageData: ReadonlyMap<string, Uint8Array>,
    private readonly decoder: ImageDecoder<TImage>,
    maxSize: number,
    private readonly logger: Logger,
  ) {
    this.resolveHref = buildHrefResolver(
      new Map(Array.from(imageData.keys(), (href) => [href, href] as const)),
    );
    this.lru = new LruCache(maxSize, (image) => {
      decoder.dispose(image);
    });
  }

  async get(src: string): Promise<TImage | undefined> {
    if (this.disposed) return undefined;
    const href = this.resolveHref(src);
    if (!href) return undefined;
    const cached = this.lru.get(href);
    if (cached) {
      this.lru.touch(href);
      return cached;
    }
    const inFlight = this.pending.get(href);
    if (inFlight) return inFlight;
    return this.startDecode(href);
  }

  getCached(src: string): TImage | undefined {
    return this.resolveCached(src);
  }

  resolveImage(src: string): TImage | undefined {
    return this.resolveCached(src);
  }

  async preload(srcs: readonly string[]): Promise<void> {
    await Promise.all(Array.from(new Set(srcs), (src) => this.get(src)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lru.clear();
  }

  private startDecode(href: string): Promise<TImage | undefined> {
    const data = this.imageData.get(href);
    if (!data) return Promise.resolve(undefined);
    const request = this.decode(href, data)
      .catch((err: unknown) => {
        this.logger.warn('Failed to decode image: %s', href, err);
        return undefined;
      })
      .finally(() => this.pending.delete(href));
    this.pending.set(href, request);
    return request;
  }

  private async decode(href: string, data: Uint8Array): Promise<TImage | undefined> {
    const image = await this.decoder.decode({ href, bytes: data });
    if (this.disposed) {
      this.decoder.dispose(image);
      return undefined;
    }
    this.lru.set(href, image);
    return image;
  }

  private resolveCached(src: string): TImage | undefined {
    const href = this.resolveHref(src);
    return href ? this.lru.get(href) : undefined;
  }
}
