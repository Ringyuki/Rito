import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserReaderCanvasImageLease,
  BrowserReaderCanvasTransientImageRead,
  type BrowserReaderCanvasImageSource,
} from '../../src/bindings/browser/reader-session-canvas-image-lease';

const bitmap = { close: vi.fn() } as unknown as ImageBitmap;

function source(load: (href: string) => Promise<string>): BrowserReaderCanvasImageSource {
  return {
    load,
    resolve: (key) => (key === 'key:plate' ? bitmap : undefined),
    release: vi.fn(),
    disposed: false,
  };
}

async function flush(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
}

describe('reader session canvas image lease', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the loading placeholder past a second and fades a late image in', async () => {
    let land!: (key: string) => void;
    const lease = new BrowserReaderCanvasImageLease(
      new Set(['plate']),
      source(() => new Promise((resolve) => (land = resolve))),
    );
    const changed = vi.fn();
    lease.subscribe(changed);

    vi.advanceTimersByTime(999);
    expect(lease.fallback('plate')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(lease.fallback('plate')).toBe('loading');
    expect(changed).toHaveBeenCalled();

    land('key:plate');
    await flush();
    expect(lease.resolve('plate')).toBe(bitmap);
    expect(lease.fallback('plate')).toBe('loading');
    expect(lease.opacity('plate')).toBe(0);
    vi.advanceTimersByTime(200);
    expect(lease.opacity('plate')).toBe(1);
    expect(lease.fallback('plate')).toBeUndefined();
    await lease.settled;
    lease.release();
  });

  it('reads a failure that can pass again after 2s while subscribed, never a final one', async () => {
    let reads = 0;
    const lease = new BrowserReaderCanvasImageLease(
      new Set(['plate']),
      source(() => {
        reads += 1;
        return reads === 1
          ? Promise.reject(new BrowserReaderCanvasTransientImageRead(new Error('offline')))
          : Promise.resolve('key:plate');
      }),
    );
    lease.subscribe(() => undefined);
    await flush();
    expect(lease.fallback('plate')).toBe('broken');
    vi.advanceTimersByTime(2000);
    await flush();
    expect(reads).toBe(2);
    expect(lease.resolve('plate')).toBe(bitmap);
    lease.release();

    let finalReads = 0;
    const broken = new BrowserReaderCanvasImageLease(
      new Set(['plate']),
      source(() => {
        finalReads += 1;
        return Promise.reject(new Error('unsupported format'));
      }),
    );
    broken.subscribe(() => undefined);
    await flush();
    vi.advanceTimersByTime(60000);
    await flush();
    expect(finalReads).toBe(1);
    expect(broken.fallback('plate')).toBe('broken');
    broken.release();
  });

  it('waits for a subscriber before reading a failed image again', async () => {
    let reads = 0;
    const lease = new BrowserReaderCanvasImageLease(
      new Set(['plate']),
      source(() => {
        reads += 1;
        return reads === 1
          ? Promise.reject(new BrowserReaderCanvasTransientImageRead(new Error('offline')))
          : Promise.resolve('key:plate');
      }),
    );
    await flush();
    vi.advanceTimersByTime(30000);
    await flush();
    expect(reads).toBe(1);
    lease.subscribe(() => undefined);
    await flush();
    expect(reads).toBe(2);
    lease.release();
  });
});
