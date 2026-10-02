# Sharded publications

A reader can open a book without ever receiving the whole EPUB. The book
is split once on the server into a small **skeleton** and **content
shards**; the reader opens from the skeleton and receives each shard the
first time it is needed. Pages drawn from shards are byte-identical to
pages drawn from the archive: the corpus check opens every book both
ways and compares every chapter's display list.

## What it protects, and what it does not

Sharding raises the cost of copying a book. It does not make copying
impossible: whatever a reader can display exists, decrypted, in its
memory.

- The client never holds a complete EPUB file. A copy has to be
  assembled shard by shard.
- Every shard is a separate request, so the server decides who gets
  which chapter and how fast. It can authorize, rate-limit and revoke
  per shard.
- With `--encrypt`, every shard is sealed with its own random 256-bit key
  (XChaCha20-Poly1305). A shard without its key is useless. The header
  is authenticated, so a shard cannot be replayed under another book or
  another id.
- Each packing gets a fresh random book id. If you pack per user (for
  example after watermarking the content), shards from one user's
  packing are refused by another user's session.

## Packing

```sh
cargo run --release -p rito-pack -- book.epub out/ --encrypt
```

`out/` then holds:

| File               | Contents                                                                            |
| ------------------ | ----------------------------------------------------------------------------------- |
| `skeleton.rshd`    | Shard 0: what opening reads, the file table, each chapter's footnote scan           |
| `shards/<id>.rshd` | One content shard per file                                                          |
| `manifest.json`    | Book id, and per shard its file, byte length and the EPUB paths it carries; no keys |
| `keys.json`        | `{ "bookId", "keys": { "<id>": "<64 hex digits>" } }`, with `--encrypt` only        |

Store `keys.json` apart from the shards. Shards may sit on a CDN; keys
belong behind the service that decides who may read what.

A content shard holds one spine chapter together with the images only
that chapter uses, or one other file: a shared image, a font, an
unreferenced file. The skeleton holds exactly what the engine's own open
path reads: container, package document, navigation and stylesheets.

## Serving

The reader asks for shards by id. A typical server:

1. delivers `skeleton.rshd` and the skeleton key (`keys["0"]`) when a
   reading session starts;
2. answers each shard request with the shard bytes and that shard's key,
   after checking that the user may read it.

## Web

`createReader` and `openBrowserReaderSession` take a sharded publication
wherever they took an `ArrayBuffer`:

```ts
const reader = await createReader(
  {
    skeleton, // ArrayBuffer
    key: skeletonKey, // Uint8Array(32), when encrypted
    loadShards: async (ids) => fetchShards(ids), // [{ id, bytes, key }]
  },
  canvas,
  options,
);
```

When a call needs a shard the session does not have, the engine names
it. The client calls `loadShards`, hands the shard to the worker and
retries the call. A rejected `loadShards` fails only that call. A reader
that reopens in a new worker after a layout change resupplies the
shards it already loaded, without calling `loadShards` again.

`createReader` paginates the whole book when it opens, for page numbers
and the table of contents. That reads every chapter, so `loadShards` is
asked for all of them before the first page appears.
`openBrowserReaderSession` opens one chapter at a time and asks only for
what the requested page needs. In that API, whole-book pagination runs
only when the host drives `advanceBackgroundOnce`.

## Flutter

```dart
final session = await RitoReaderSession.openShards(
  gateway: RitoIsolateGateway(),
  skeletonBytes: skeleton,
  skeletonKey: skeletonKey,
  loadShards: (ids) => fetchShards(ids), // List<RitoPublicationShard>
  request: request,
  pinnedFontPolicy: policy,
);
```

Seeks, turns, peeks, footnotes, resources and queries load their shards
and retry transparently. `advanceBackground` (whole-book page numbers)
reads every chapter, so it loads every shard. A host that must not fetch
the whole book does not run it.

## C ABI

- `rito_open_shards_with_pinned_fonts` opens from the skeleton and
  requests the initial artifact.
- `rito_supply_shard` hands the session one content shard and writes the
  shard's id.

A call that needs missing shards returns `RITO_STATUS_RESOURCE_PENDING`.
`error_out` then carries a `RITOPSH1` message instead of UTF-8:

```text
"RITOPSH1"   8 bytes magic
u32          version, 1
u64          total length
u32          shard count (at least 1)
u32...       shard ids, ascending and distinct, never 0
string       message (u32 length, UTF-8)
```

Supply the shards and retry. A request that carries a request id must
retry with a newer one, because the engine consumed the old one. A
sharded open whose first request is pending keeps its session open,
unlike every other open failure.

## Behaviour while shards are missing

- A footnote whose definition lives in a chapter not yet supplied is
  marked pending on the page. Reading it loads that chapter.
- Chapter page numbers are local to the chapter until whole-book
  pagination has run, as for any chapter-first open.
- Fonts: the first layout needs every publication font, because faces
  register with the shaping engine once. Their shards are requested
  together with the first chapter.

## Versioning

A shard's header carries a format version. The skeleton also records
the revision of the footnote attribute scan it was packed with. A
reader built on a different scan revision refuses the skeleton with
"pack the publication again". Repack whenever the engine reports that.
