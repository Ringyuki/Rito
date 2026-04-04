import { buildHrefResolver } from '../../utils/resolve-href';
import { createLogger, type Logger } from '../../utils/logger';

/**
 * A lazy image decoder with LRU eviction.
 *
 * Instead of decoding all images upfront, this decodes on demand and
 * keeps at most `maxSize` ImageBitmaps in memory. When the cache is full,
 * the least recently used entry is evicted (and its bitmap closed).
 */
export interface LazyImageLoader {
  /** Get a decoded ImageBitmap, decoding on demand if not cached. */
  get(src: string): Promise<ImageBitmap | undefined>;
  /** Get a synchronously cached bitmap, or undefined if not yet decoded. */
  getCached(src: string): ImageBitmap | undefined;
  /** Pre-decode specific images (e.g., for the current spread). */
  preload(srcs: readonly string[]): Promise<void>;
  /** Release all cached bitmaps. */
  dispose(): void;
}

class LruCache {
  private readonly cache = new Map<string, ImageBitmap>();
  private readonly order: string[] = [];
  constructor(private readonly maxSize: number) {}

  get(key: string): ImageBitmap | undefined {
    return this.cache.get(key);
  }

  set(key: string, bitmap: ImageBitmap): void {
    this.cache.set(key, bitmap);
    this.touch(key);
    this.evict();
  }

  touch(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(key);
  }

  clear(): void {
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
    this.order.length = 0;
  }

  private evict(): void {
    while (this.order.length > this.maxSize) {
      const oldest = this.order.shift();
      if (oldest) {
        this.cache.get(oldest)?.close();
        this.cache.delete(oldest);
      }
    }
  }
}

export function createLazyImageLoader(
  imageData: ReadonlyMap<string, Uint8Array>,
  maxSize = 50,
  logger?: Logger,
): LazyImageLoader {
  const log = logger ?? createLogger();
  const resolve = buildHrefResolver(imageData);
  const lru = new LruCache(maxSize);

  async function decode(src: string, data: Uint8Array): Promise<ImageBitmap> {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const blob = new Blob([buffer as ArrayBuffer]);
    const bitmap = await createImageBitmap(blob);
    lru.set(src, bitmap);
    return bitmap;
  }

  const loader: LazyImageLoader = {
    async get(src: string): Promise<ImageBitmap | undefined> {
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
    async preload(srcs: readonly string[]): Promise<void> {
      await Promise.all(srcs.map((s) => loader.get(s)));
    },
    dispose(): void {
      lru.clear();
    },
  };
  return loader;
}
