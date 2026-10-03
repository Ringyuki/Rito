import type { ReaderPublicationShard, ReaderShardedPublication } from '@ritojs/core';

interface ShardManifest {
  readonly bookId: string;
  readonly format: string;
  readonly shards: readonly { readonly id: number; readonly file: string }[];
}

interface ShardKeys {
  readonly keys: Readonly<Record<string, string>>;
}

/** Where `pnpm pack:shards-demo` writes the demo book split by `rito-pack`. */
const SHARDS_DEMO_BASE = `${import.meta.env.BASE_URL}shards-demo/`;

/**
 * The demo book as a sharded publication: the reader opens from the
 * skeleton alone and fetches an image's shard the first time it paints.
 *
 * The keys sit next to the shards only because this is a demo; in a real
 * deployment the shards may live on a CDN while the keys come from the
 * service that decides who may read the book.
 */
export async function fetchShardedDemo(): Promise<{
  readonly bookId: string;
  readonly publication: ReaderShardedPublication;
}> {
  const [manifest, keys] = await Promise.all([
    fetchJson<ShardManifest>('manifest.json'),
    fetchJson<ShardKeys>('keys.json'),
  ]);
  if (manifest.format !== 'rito-publication-shards') {
    throw new Error('shards-demo/manifest.json is not a rito-pack manifest');
  }
  const files = new Map(manifest.shards.map((shard) => [shard.id, shard.file]));
  const key = (id: number) => hexBytes(keys.keys[String(id)]);
  const publication: ReaderShardedPublication = {
    skeleton: await fetchBytes('skeleton.rshd'),
    key: key(0),
    loadShards: (ids) =>
      Promise.all(
        ids.map(async (id): Promise<ReaderPublicationShard> => {
          const file = files.get(id);
          if (file === undefined) throw new Error(`shard ${String(id)} is not in the manifest`);
          return { id, bytes: await fetchBytes(file), key: key(id) };
        }),
      ),
  };
  return { bookId: manifest.bookId, publication };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(SHARDS_DEMO_BASE + path);
  // The dev server answers a missing file with the app's HTML.
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new Error('The sharded demo is not packed yet: run `pnpm pack:shards-demo`.');
  }
  return (await response.json()) as T;
}

async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(SHARDS_DEMO_BASE + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${String(response.status)}`);
  return response.arrayBuffer();
}

function hexBytes(hex: string | undefined): Uint8Array | undefined {
  if (hex === undefined) return undefined;
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
