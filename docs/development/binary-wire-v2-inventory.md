# Binary Wire V2 Inventory

This inventory is the working checklist for the `RITORB1` runtime bundle
milestone. `RITOFCB2` continues to own display command bytes; `RITORB1` is for
runtime metadata that currently crosses the Rust/WASM to JavaScript boundary as
JSON strings.

## Current JSON Boundary

Normal reader open and reflow use these JSON paths today:

| Method                                       | Current caller                                               | Classification                      | RITORB1 action                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicationJson()`                          | `openDocument()` reader setup                                | cold public metadata                | Leave JSON for now, or fold into a later publication bundle. Not first migration target.                                                                                                 |
| `createReaderViewRevisionBundleJson/Bytes()` | normal initial preview, resize preview, deferred full reflow | hot runtime payload                 | Reader-private projection for both wire choices; generic `createViewRevisionBundleJson/Bytes()` keeps the original shape for direct/debug/benchmark use.                                 |
| `getFrameCommandBufferMetadataJson()`        | direct metadata reads, diagnostics                           | debug/cold direct metadata          | Keep JSON on the production reader path for now; frame-window metadata can join the opt-in bundle after revision parity is stable.                                                       |
| `prefetchPlannedFrameResourcesJson()`        | direct/debug planned resource inspection                     | debug/cold direct metadata          | Keep JSON on the production reader path for now; resource planning can join the opt-in bundle after revision parity is stable.                                                           |
| `getResourcePayloadJson()`                   | explicit resource reads, diagnostics                         | warm runtime payload                | Keep JSON on the production reader path for now; production delivery consumes bytes with `takeResourceTransfer()`, while non-consuming read/release remains available for compatibility. |
| `searchJson()`                               | reader search                                                | warm interaction                    | Defer until revision/frame path is proven.                                                                                                                                               |
| `resolveLocatorJson()`                       | TOC/link navigation                                          | warm interaction                    | Defer until revision/frame path is proven.                                                                                                                                               |
| `getPageTargetsJson()`                       | page target lookups                                          | warm interaction                    | Defer; may share target/geometry tables with later interaction bundle.                                                                                                                   |
| `getPageTextPositionsJson()`                 | text position lookup                                         | warm interaction                    | Defer; large text payloads need a dedicated table strategy.                                                                                                                              |
| `getTextRangeGeometryJson()`                 | selection/search geometry                                    | warm interaction                    | Defer; likely same later geometry table as page text positions.                                                                                                                          |
| `getFootnoteJson()` / `getFootnotesJson()`   | footnote UI and revision bundle content                      | warm interaction / bundled metadata | Individual lookups can remain JSON initially; revision-bundle footnote maps should be represented by `RITORB1` when they are part of revision.                                           |
| `getChapterTextIndicesJson()`                | anchor/search compatibility data                             | warm interaction / bundled metadata | Same as footnotes: individual method can wait, revision-bundle content belongs in `RITORB1`.                                                                                             |
| `getFrameJson()`                             | tests, diagnostics, fixture/debug paths                      | debug-only                          | Keep JSON for fixture and parity inspection. Do not use in normal reader runtime.                                                                                                        |

JSON request inputs are also present for reflow/search/locator/resource/geometry
requests. They are less urgent than response payloads because the largest
runtime cost is Rust serializing large metadata objects and JS parsing them back
on every reflow. Do not add new JSON-only request shapes for hot paths.

## First RITORB1 Payload

The first bundle should model the JS shape currently returned by
`createReaderViewRevision()`:

- view revision envelope: `kind`, `display`, optional `followUp`;
- revision result: `preview`, `frameSelection`, revision summary;
- navigation summary: page/spread counts, spread navigation, chapter ranges;
- TOC targets needed by committed full revisions;
- revision-scoped footnote and chapter-text-index metadata currently included in
  `RuntimeRevisionBundle`;
- `fontFamilies`;
- initial frame window:
  - warm plan;
  - frame command-buffer metadata for each planned spread;
  - resource transfer payload metadata and missing-resource records per spread.

Frame display command bytes stay outside this bundle and continue to use
`readFrameCommandBuffer()` / `RITOFCB2`.

## Current Implementation Progress

- This file is the inventory and migration boundary for the next `RITORB1`
  attempt.
- The attempted `RITORB1` runtime/wasm/decoder slice was backed out of the
  active code after it correlated with a page-turn UX regression.
- A new private `RITORB1` first slice now exists for
  `createViewRevisionBundleBytes()`. It encodes the same
  `WasmViewRevisionResponse` model used by the JSON path into a versioned binary
  value bundle with string interning, table offsets/lengths, counts, checksum,
  and strict Rust/JS decoder validation.
- Production reader metadata remains on the previous JSON methods by default.
  The binary path is reachable only through the private reader wire switch
  (`globalThis.__RITO_CORE_WASM_READER_WIRE__ = 'ritorb1'`) or direct private
  wasm runtime calls.
- JSON/binary agreement covers initial preview, active visual preview, full
  revision, and resource-bearing frame-window metadata.
- The Rust encoder and both decoders share a 574-byte golden vector covering
  every value tag, nested/repeated values, Unicode, safe integer boundaries,
  and an own `__proto__` object key. Rust rejects integer values outside the
  JavaScript safe range and count fields that cannot fit their section before
  allocating containers.
- The encoder reuses value indexes for repeated primitive records while leaving
  arrays and objects distinct. This is wire-compatible with the existing V1
  decoder and avoids changing observable JavaScript identity for composite
  values. In a 420 x 640 single-page full-revision calibration, `RITORB1` is
  78.6% to 81.2% of JSON across `book-01`, `book-06`, and `book-10`; before
  primitive reuse those same payloads were 111.4% to 117.9% of JSON. String and
  scalar intern indexes use hash lookup; index assignment still follows first
  encounter order, so the byte-exact V1 wire remains unchanged.
- The JavaScript decoder preserves the V1 FNV-1a checksum and normal object
  semantics while computing the checksum with exact u32 lanes instead of a
  `BigInt` allocation per byte. Ordinary keys use fast assignment; inherited
  keys still use own data-property descriptors, preserving `__proto__` and
  polluted-prototype safety without paying that cost for every field.
- The reader-private projection deduplicates document-stable full
  `chapterTextIndices.entries` on both JSON and `RITORB1`. The first full cache
  miss inlines entries with scope `chapter-text-v1:full`; later full cache hits
  send only revision id plus scope. Preview revisions stay inline. This does
  not change the generic `createViewRevisionBundleJson/Bytes()` shape,
  `RITORB1` V1 bytes/golden, or the public object returned by `@ritojs/core`.
- The historical app-level JSON/binary ABBA harness recorded revision round
  trips, committed spread counts, page-turn readiness, rAF gaps, Long Tasks,
  browser errors, raw bytes, Rust encode time, WASM time, JavaScript decode time,
  and Worker time. It was retired when production moved from
  `createViewRevision` to bounded versioned commands; the transport remains
  covered by core-wasm compatibility tests and the decode benchmark.
- Local ABBA runs matched preview/full/reflow results and showed no page-turn
  regression. The instrumented report now exposes the cost at each wire
  boundary, but JSON remains the default while the result and the smaller
  payload are repeated on representative machines and books.
- `pnpm --filter @ritojs/core-wasm bench:runtime-wire` builds a fresh WASM
  artifact, creates matching full-revision JSON/RITORB1 payloads once from a
  real fixture, and then alternates repeated decode-only batches. It reports raw
  samples plus median/p95 without defining a CI performance threshold; run it
  in independent processes and treat a single result as diagnostic only. Set
  `RITO_WIRE_EPUB=/absolute/path/book.epub` on this command to use a
  representative local EPUB rather than the built-in fixture.

## Required Compatibility During Migration

- Keep all existing `*Json()` Rust/WASM methods until parity fixtures,
  diagnostics, and debug tooling are moved or explicitly retired.
- JSON fixture views and `RITORB1` decoded views must be derived from the same
  typed Rust structs.
- The JS decoder should be the only hand-written JS schema projection. Public
  `@ritojs/core` objects remain object-shaped after the facade decodes bytes.
- `packages/rito-core-wasm` stays a private build workspace; do not expose
  `RITORB1` names from public `@ritojs/core` package exports.

## Decoder Rejection Cases

The JS decoder must reject:

- wrong magic;
- unsupported version;
- truncated header or table data;
- table offset/length pairs outside the byte length;
- unsorted or overlapping table ranges;
- invalid UTF-8/string indexes;
- invalid value-table indexes;
- integers outside the JavaScript safe range and non-finite floats;
- string/value/array/object counts that cannot fit the remaining section;
- mismatched declared and decoded record counts.

Resource, page, frame, target, and geometry relationships belong to the typed
revision envelope and its consumer agreement tests; the generic value-table
decoder cannot validate those business relationships by itself.

## Exit Criterion For The First Slice

The opt-in reader path, always-on browser smoke, and ABBA harness now exist.
Fifteen fresh-process decode runs and three complete `book-01` ABBA runs are
recorded in [`binary-wire-v2-evidence.md`](./binary-wire-v2-evidence.md).
Ordinary turns still use JSON frame-window metadata plus `RITOFCB2`, so turn
metrics are a no-regression probe rather than a claim that turns themselves use
`RITORB1`.

The local result is an explicit no-go for making the binary path default:
payloads are smaller, but eager encode/decode costs are materially higher. Do
not move another payload yet. Reader full-reference hits now skip stable
chapter-text construction through a lazy full-document scope; continue with
value-table and first-inline materialization work only without changing V1
bytes, repeat the same report, and add another machine class before changing
the default. `RITOFCB2` command bytes, transfer bytes, and JSON fixture/debug
output remain available throughout that work.
