# @ritojs/pack

Server-side tools for the Rito reader, for Node: split an EPUB into the
shards a reader opens it from, and check that the reader can read an EPUB
at all.

Both run the engine's own code (the same Rust as the reader, compiled to
WASM), in the calling process.

## Install

```bash
pnpm add @ritojs/pack
```

Node 22 or later. Use the same version as the `@ritojs/core` your readers
run: a reader refuses a skeleton packed in another shard format, or under
other image size rules ("pack the publication again").

## Packing

```ts
import { packPublication } from '@ritojs/pack';

const packed = await packPublication(epubBytes, { encrypt: true });

await storage.put(`${bookId}/skeleton`, packed.skeleton.bytes);
for (const shard of packed.shards) {
  await storage.put(`${bookId}/${shard.id}`, shard.bytes);
}
// Keys belong behind the service that decides who may read what.
await keyStore.put(
  bookId,
  [packed.skeleton, ...packed.shards].map((shard) => ({ id: shard.id, key: shard.key })),
);
```

- `skeleton` (id `0`) holds every file layout reads: chapters, stylesheets,
  fonts, navigation, the file table and the size of every image. A reader
  opens the book from it.
- `shards` hold one image, audio or video file each, by ascending id.
- With `encrypt`, every shard is sealed with its own random 256-bit key
  (XChaCha20-Poly1305) and carries it as `key`; without it, no shard has a
  key.
- Each shard's `{ id, bytes, key }` is exactly what a reader's
  `loadShards` returns for it. `files` lists the EPUB paths it carries.
- `bookId` is random per packing: a reading session refuses shards from
  another packing of the same book.

The promise rejects with the engine's reason when the EPUB cannot be
opened. See [Sharded publications](../../docs/integrations/sharded-publications.md)
for what sharding protects and how a reader loads shards.

## Checking

```ts
import { checkPublication } from '@ritojs/pack';

const check = await checkPublication(epubBytes);
if (!check.readable) reject(check.error);
for (const problem of check.problems) warn(`${problem.path}: ${problem.message}`);
```

Unreadable means the reader fails on the book, and `error` is the error
it fails with: the archive or its package document does not open, a
chapter or font the package lists cannot be read, or a chapter links a
stylesheet the package does not have. A readable book lists in `problems`
the files the reader shows degraded: a chapter whose XHTML does not parse
shows no content, and a listed stylesheet, font or image the archive lacks
is left out. The check does not lay the book out, which depends on the
reading device's fonts and page size.

## Command line

```bash
npx rito-pack book.epub out/ --encrypt
npx rito-pack --check book.epub
```

The first writes `skeleton.rshd`, `shards/<id>.rshd`, `manifest.json` (the
book id and, per shard, its file, byte length and EPUB paths; no keys) and,
with `--encrypt`, `keys.json` (`{ "bookId", "keys": { "<id>": "<64 hex digits>" } }`).
The second prints the verdict and exits 1 when the reader cannot read the
book.

## Running on a server

Each call runs on a worker thread of its own, so the caller's event loop
keeps serving while a book is packed, and the memory the engine used
(several times the book) is released when the call ends. Starting the
thread costs about 45 ms. On a 123-book test corpus (692 MB, Apple M3),
packing took 28 ms of CPU per MB of EPUB and checking 6 ms; the largest
book (37 MB) took 0.8 s to pack. Calls run in parallel, one thread each:
limit how many run at once to suit the machine.

The package loads its worker and its `.wasm` beside its own files. When
bundling server code, keep `@ritojs/pack` external.
