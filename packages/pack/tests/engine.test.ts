// The packed output opened by the reader engine itself, through the session
// worker's handler and client wired together on this thread: the way a
// page opens a sharded publication, without a browser.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  initRitoCoreWasm,
  RitoReaderSession,
  createRitoCoreWasmReaderSessionWorkerClient,
  createRitoCoreWasmReaderSessionWorkerHandler,
  type RitoCoreWasmReaderSessionWorkerClient,
  type RitoReaderSessionWorkerLike,
} from '@ritojs/core-wasm';

import type { PackedPublication, PackedShard } from '../src/index';
import { BOOK, archiveFiles, arrayBufferOf, pack } from './helpers';

const repo = new URL('../../../', import.meta.url);
await initRitoCoreWasm({
  module_or_path: readFileSync(new URL('packages/rito-core-wasm/dist/rito_wasm_bg.wasm', repo)),
});
const font = new Uint8Array(
  readFileSync(new URL('apps/reader/src/assets/fonts/Tinos-Regular.ttf', repo)),
);
const POLICY = {
  metadataJson: JSON.stringify({
    schemaVersion: 1,
    faces: [
      { expectedSha256: createHash('sha256').update(font).digest('hex'), genericRole: 'serif' },
    ],
  }),
  faces: [font],
};
const REQUEST = {
  layout: {
    renderRatio: 1,
    viewportWidth: 420,
    viewportHeight: 640,
    marginTop: 24,
    marginRight: 24,
    marginBottom: 24,
    marginLeft: 24,
    spreadMode: 'single',
    firstPageAlone: true,
    spreadGap: 0,
    rootFontSize: 16,
  },
  locator: { href: '' },
  textProfile: 'platform-string-runs',
} as const;

describe('a packed publication', () => {
  it('opens in the reader engine, which reads each image from its shard, byte for byte', async () => {
    const packed = await pack.packPublication(BOOK, { encrypt: true });
    const client = await openShards(packed, (shard) => shard);
    const opened = await client.open(...openArgs(packed, client.loadShards));
    const image = opened.resources.find((resource) => resource.kind === 'image');
    expect(image, 'the first page draws an image').toBeDefined();

    const resource = await client.readResource(opened.artifactId, 'image', image?.href ?? '');
    const read = Buffer.from(resource.bytes);
    const original = Object.entries(archiveFiles(BOOK)).find(([, bytes]) =>
      read.equals(Buffer.from(bytes)),
    );
    expect(original, 'the bytes are an image of the EPUB').toBeDefined();
    expect(packed.shards.some((shard) => shard.files.includes(original?.[0] ?? ''))).toBe(true);
    await client.dispose();
  });

  it('opens only under its skeleton key, and an image reads only under its own key', async () => {
    const packed = await pack.packPublication(BOOK, { encrypt: true });
    const wrongKey = packed.shards[0]?.key ?? new Uint8Array(32);
    const locked = await openShards(packed, (shard) => shard);
    await expect(
      locked.open(...openArgs({ ...packed, skeleton: { ...packed.skeleton, key: wrongKey } })),
    ).rejects.toThrow();

    const swapped = await openShards(packed, (shard) => ({
      ...shard,
      key: packed.skeleton.key ?? new Uint8Array(32),
    }));
    const opened = await swapped.open(...openArgs(packed, swapped.loadShards));
    const image = opened.resources.find((resource) => resource.kind === 'image');
    await expect(
      swapped.readResource(opened.artifactId, 'image', image?.href ?? ''),
    ).rejects.toThrow();
    await swapped.dispose();
  });
});

type LoadShards = (ids: readonly number[]) => Promise<readonly PackedShard[]>;

/** A client on a fresh session, and the `loadShards` that serves `packed`. */
async function openShards(
  packed: PackedPublication,
  serve: (shard: PackedShard) => PackedShard,
): Promise<RitoCoreWasmReaderSessionWorkerClient & { loadShards: LoadShards }> {
  await Promise.resolve();
  const loadShards: LoadShards = (ids) =>
    Promise.resolve(
      ids.map((id) => {
        const shard = packed.shards.find((candidate) => candidate.id === id);
        if (shard === undefined) throw new Error(`no shard ${String(id)}`);
        return serve(shard);
      }),
    );
  return Object.assign(createRitoCoreWasmReaderSessionWorkerClient(connectedWorker()), {
    loadShards,
  });
}

function openArgs(
  packed: PackedPublication,
  loadShards: LoadShards = () => Promise.resolve([]),
): Parameters<RitoCoreWasmReaderSessionWorkerClient['open']> {
  const skeleton = arrayBufferOf(packed.skeleton.bytes);
  const key = packed.skeleton.key;
  return [{ skeleton, ...(key === undefined ? {} : { key }), loadShards }, REQUEST, POLICY];
}

/** A client transport wired straight into a real worker handler on this thread. */
function connectedWorker(): RitoReaderSessionWorkerLike {
  type Listener = (event: { readonly data: unknown }) => void;
  let toHandler: Listener | undefined;
  let toClient: Listener | undefined;
  createRitoCoreWasmReaderSessionWorkerHandler(
    {
      addEventListener: (_type, listener) => {
        toHandler = listener;
      },
      postMessage: (message) => {
        queueMicrotask(() => toClient?.({ data: message }));
      },
    },
    { initRitoCoreWasm: () => Promise.resolve(undefined), RitoReaderSession },
  );
  const worker = {
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') toClient = listener;
    },
    removeEventListener: () => undefined,
    postMessage: (message: unknown) => {
      queueMicrotask(() => toHandler?.({ data: message }));
    },
    terminate: () => undefined,
  };
  return worker as RitoReaderSessionWorkerLike;
}
