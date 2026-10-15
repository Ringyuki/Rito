import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { initSync, packPublication as packOnThisThread } from '@ritojs/core-wasm/pack';

import { BOOK, LARGE_BOOK, archiveFiles, arrayBufferOf, pack } from './helpers';

const MAGIC = 'RITOSHD1';

describe('packPublication', () => {
  it('splits a book into a skeleton and one shard per image, carrying every file once', async () => {
    const packed = await pack.packPublication(BOOK);
    const all = [packed.skeleton, ...packed.shards];

    expect(packed.skeleton.id).toBe(0);
    expect(packed.shards.map((shard) => shard.id)).toEqual(
      packed.shards.map((_, index) => index + 1),
    );
    expect(packed.formatVersion).toBe(3);
    expect(packed.bookId).toMatch(/^[0-9a-f]{32}$/);
    expect(packed.encrypted).toBe(false);
    for (const shard of all) {
      expect(Buffer.from(shard.bytes.subarray(0, 8)).toString('latin1')).toBe(MAGIC);
      expect(shard.key).toBeUndefined();
    }

    const carried = all.flatMap((shard) => shard.files);
    expect(new Set(carried).size).toBe(carried.length);
    expect([...carried].sort()).toEqual(Object.keys(archiveFiles(BOOK)).sort());
    const images = Object.keys(archiveFiles(BOOK)).filter((path) => /\.(jpe?g|png)$/.test(path));
    expect(packed.shards.map((shard) => [...shard.files]).sort()).toEqual(
      images.map((path) => [path]).sort(),
    );
  });

  it('seals every shard under a key of its own and draws a new book id per packing', async () => {
    const first = await pack.packPublication(BOOK, { encrypt: true });
    const second = await pack.packPublication(arrayBufferOf(BOOK), { encrypt: true });

    const keys = [first.skeleton, ...first.shards].map((shard) => shard.key);
    expect(first.encrypted).toBe(true);
    for (const key of keys) expect(key?.length).toBe(32);
    expect(new Set(keys.map((key) => Buffer.from(key ?? []).toString('hex'))).size).toBe(
      keys.length,
    );
    expect(second.bookId).not.toBe(first.bookId);
  });

  it("rejects what is not an EPUB with the engine's reason", async () => {
    await expect(pack.packPublication(strToU8('plain text'))).rejects.toThrow(/Invalid EPUB ZIP/);
    await expect(pack.packPublication('book.epub' as unknown as Uint8Array)).rejects.toThrow(
      TypeError,
    );
  });

  it("packs on a worker thread, leaving the caller's event loop free", async () => {
    const onThisThread = await longestStall(async () => {
      await Promise.resolve();
      initSync({ module: readFileSync(new URL('../dist/rito_pack_bg.wasm', import.meta.url)) });
      packOnThisThread(LARGE_BOOK, true, (buffer: Uint8Array<ArrayBuffer>) => {
        webcrypto.getRandomValues(buffer);
      }).free();
    });
    expect(onThisThread.stall, 'the measurement sees a blocked thread').toBeGreaterThan(
      onThisThread.elapsed / 2,
    );

    const onWorker = await longestStall(() => pack.packPublication(LARGE_BOOK, { encrypt: true }));
    expect(onWorker.stall).toBeLessThan(onWorker.elapsed / 2);
  });
});

/** The longest pause between 2 ms timer ticks while `work` runs. */
async function longestStall(
  work: () => Promise<unknown>,
): Promise<{ stall: number; elapsed: number }> {
  const start = performance.now();
  let last = start;
  let stall = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    stall = Math.max(stall, now - last);
    last = now;
  }, 2);
  try {
    await work();
    await new Promise((resolve) => setTimeout(resolve, 5));
  } finally {
    clearInterval(timer);
  }
  return { stall, elapsed: performance.now() - start };
}
