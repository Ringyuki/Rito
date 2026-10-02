# Sharded publications

A reader can open a book without ever receiving the whole EPUB. The book
is split once on the server into a small **skeleton** and **content
shards**. The skeleton carries all of the book's text, styles and fonts
and the size of every image, so the reader lays the whole book out from
it; each image arrives in its own shard the first time a page paints
it. Pages drawn from shards are byte-identical to pages drawn from the
archive: the corpus check opens every book both ways and compares every
chapter's display list, and no chapter's layout ever waits on a shard.

## What it protects, and what it does not

Sharding raises the cost of copying a book. It does not make copying
impossible: whatever a reader can display exists, decrypted, in its
memory.

- The client never holds a complete EPUB file. A copy has to be
  assembled shard by shard.
- Images, nearly all of a book's bytes, are separate requests, so the
  server decides who gets them and how fast. It can authorize,
  rate-limit and revoke per shard.
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
| `skeleton.rshd`    | Shard 0: every file layout reads, the file table, every image's dimensions          |
| `shards/<id>.rshd` | One content shard per image, audio or video file                                    |
| `manifest.json`    | Book id, and per shard its file, byte length and the EPUB paths it carries; no keys |
| `keys.json`        | `{ "bookId", "keys": { "<id>": "<64 hex digits>" } }`, with `--encrypt` only        |

Store `keys.json` apart from the shards. Shards may sit on a CDN; keys
belong behind the service that decides who may read what.

Every shard is deflated before it is sealed, when that makes it
smaller: ciphertext does not compress on the way to the reader, so the
compression has to happen first. A book's shards together weigh about
what its EPUB does.

The skeleton holds every file that is not an image, audio or video:
container, package document, navigation, chapters, stylesheets and
fonts. On the test corpus it is a median of 7% of the archive (a
quarter of books under 3%, a quarter over 11%). Each image, audio or
video file is a content shard of its own, and the skeleton records each
image's intrinsic size, so layout never needs the image itself.

## Images ahead of need

The skeleton records, for each image, the first chapter that draws it.
While the reader is idle, the client supplies image shards ahead of
need: those of the chapter being read first, then the next chapter, the
previous one, and so on outward. It supplies one shard at a time and only
while no other call is in flight, so a page turn waits behind at most
the one supply already under way. Moving to another chapter reorders
what is left. A shard that fails to load ahead of need is loaded again
by the read that needs it, which reports the failure.

Over a whole session this fetches what the EPUB would have weighed; it
only changes when.

## Serving

The reader asks for shards by id. A typical server:

1. delivers `skeleton.rshd` and the skeleton key (`keys["0"]`) when a
   reading session starts;
2. answers each shard request with the shard bytes and that shard's key,
   after checking that the user may read it.

## Web

`createReader`, `openBrowserReaderSession` and React's `useRitoReader`
`load` take a sharded publication wherever they took an `ArrayBuffer`:

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

Opening, whole-book pagination, seeking and turning never call
`loadShards`. A page whose image has not arrived paints at once without
it, and repaints when the image does. When a page reads an image the session does not have yet,
the engine names its shard; the client calls `loadShards`, hands the
shard to the worker and retries the read. A rejected `loadShards` fails
only that read. A reader that reopens in a new worker after a layout
change resupplies the shards it already loaded, without calling
`loadShards` again.

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

Opening, seeks, turns, peeks and `advanceBackground` never wait on a
shard. Reading an image loads its shard and retries transparently, and
image shards are supplied ahead of need as on the web.

## C ABI

- `rito_open_shards_with_pinned_fonts` opens from the skeleton and
  requests the initial artifact.
- `rito_supply_shard` hands the session one content shard and writes the
  shard's id.
- `rito_content_shards_near` writes every content shard id as
  little-endian `u32`s, ordered for supplying ahead of need from a
  chapter href: that chapter's images first, then the chapters around it.

Only a resource read can need a missing shard. It then returns
`RITO_STATUS_RESOURCE_PENDING`.
`error_out` then carries a `RITOPSH1` message instead of UTF-8:

```text
"RITOPSH1"   8 bytes magic
u32          version, 1
u64          total length
u32          shard count (at least 1)
u32...       shard ids, ascending and distinct, never 0
string       message (u32 length, UTF-8)
```

Supply the shards and retry the read.

## Versioning

A shard's header carries a format version. The skeleton also records
the revision of the image size rules it was packed with. A reader built
on a different revision refuses the skeleton with "pack the publication
again". Repack whenever the engine reports that.
