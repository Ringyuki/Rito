import { describe, expect, it, vi } from 'vitest';

import {
  openableBrowserReaderPublication,
  retainBrowserReaderPublication,
} from '../../src/bindings/browser/publication-source';

describe('browser reader publication source', () => {
  it('keeps a private copy of an archive and opens each worker from a fresh one', () => {
    const archive = Uint8Array.of(1, 2, 3).buffer;
    const retained = retainBrowserReaderPublication(archive);
    expect(retained).not.toBe(archive);
    const opened = openableBrowserReaderPublication(retained);
    expect(opened).not.toBe(retained);
    expect(new Uint8Array(opened as ArrayBuffer)).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('asks the host for a shard once however many workers open the book', async () => {
    const loadShards = vi.fn((ids: readonly number[]) =>
      Promise.resolve(ids.map((id) => ({ id, bytes: Uint8Array.of(id) }))),
    );
    const key = new Uint8Array(32).fill(1);
    const retained = retainBrowserReaderPublication({
      skeleton: Uint8Array.of(9).buffer,
      key,
      loadShards,
    });
    const source = openableBrowserReaderPublication(retained);
    if (source instanceof ArrayBuffer) throw new Error('expected a sharded source');
    expect(source.key).toEqual(key);
    expect(source.key).not.toBe(key);

    expect((await source.loadShards([2, 3])).map((shard) => shard.id)).toEqual([2, 3]);
    expect((await source.loadShards([3, 4])).map((shard) => shard.id)).toEqual([3, 4]);
    expect(loadShards.mock.calls).toEqual([[[2, 3]], [[4]]]);
  });

  it('returns only the shards the host produced', async () => {
    const source = retainBrowserReaderPublication({
      skeleton: Uint8Array.of(9).buffer,
      loadShards: () => Promise.resolve([]),
    });
    if (source instanceof ArrayBuffer) throw new Error('expected a sharded source');
    expect(await source.loadShards([5])).toEqual([]);
  });
});
