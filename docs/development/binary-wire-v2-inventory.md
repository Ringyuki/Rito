# Binary Wire V2 Inventory

This inventory is the working checklist for the `RITORB1` runtime bundle
milestone. `RITOFCB2` continues to own display command bytes; `RITORB1` is for
runtime metadata that currently crosses the Rust/WASM to JavaScript boundary as
JSON strings.

## Current JSON Boundary

Normal reader open and reflow use these JSON paths today:

| Method                                     | Current caller                                               | Classification                      | RITORB1 action                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicationJson()`                        | `openDocument()` reader setup                                | cold public metadata                | Leave JSON for now, or fold into a later publication bundle. Not first migration target.                                                       |
| `createViewRevisionBundleJson()`           | normal initial preview, resize preview, deferred full reflow | hot runtime payload                 | First future target, but only behind an opt-in A/B path until page-turn smoothness is proven.                                                  |
| `getFrameCommandBufferMetadataJson()`      | direct metadata reads, diagnostics                           | debug/cold direct metadata          | Keep JSON on the production reader path for now; frame-window metadata can join the opt-in bundle after revision parity is stable.             |
| `prefetchPlannedFrameResourcesJson()`      | direct/debug planned resource inspection                     | debug/cold direct metadata          | Keep JSON on the production reader path for now; resource planning can join the opt-in bundle after revision parity is stable.                 |
| `getResourcePayloadJson()`                 | explicit resource reads, diagnostics                         | warm runtime payload                | Keep JSON on the production reader path for now; transfer bytes still use `readResourceTransfer()` and metadata migration should be opt-in.    |
| `searchJson()`                             | reader search                                                | warm interaction                    | Defer until revision/frame path is proven.                                                                                                     |
| `resolveLocatorJson()`                     | TOC/link navigation                                          | warm interaction                    | Defer until revision/frame path is proven.                                                                                                     |
| `getPageTargetsJson()`                     | page target lookups                                          | warm interaction                    | Defer; may share target/geometry tables with later interaction bundle.                                                                         |
| `getPageTextPositionsJson()`               | text position lookup                                         | warm interaction                    | Defer; large text payloads need a dedicated table strategy.                                                                                    |
| `getTextRangeGeometryJson()`               | selection/search geometry                                    | warm interaction                    | Defer; likely same later geometry table as page text positions.                                                                                |
| `getFootnoteJson()` / `getFootnotesJson()` | footnote UI and revision bundle content                      | warm interaction / bundled metadata | Individual lookups can remain JSON initially; revision-bundle footnote maps should be represented by `RITORB1` when they are part of revision. |
| `getChapterTextIndicesJson()`              | anchor/search compatibility data                             | warm interaction / bundled metadata | Same as footnotes: individual method can wait, revision-bundle content belongs in `RITORB1`.                                                   |
| `getFrameJson()`                           | tests, diagnostics, fixture/debug paths                      | debug-only                          | Keep JSON for fixture and parity inspection. Do not use in normal reader runtime.                                                              |

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
  primitive reuse those same payloads were 111.4% to 117.9% of JSON.
- Normal reader E2E includes a real binary-wire WebWorker smoke. The opt-in
  `pnpm test:e2e:wire-ab` harness runs JSON/binary ABBA sessions and records
  revision round trips, committed spread counts, page-turn readiness, rAF
  gaps, long tasks, and browser errors.
- Two local ABBA runs, including one after primitive reuse, matched
  preview/full/reflow results and showed no page-turn regression. The
  post-change run kept both wires at a 17.7 ms page-turn rAF p95 with no
  per-turn long tasks. JSON remains the default while the result and the new
  smaller payload are repeated on representative machines and books.

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

The opt-in reader path, always-on browser smoke, and ABBA harness now exist, and
the first local run did not reproduce the old page-turn regression. Ordinary
turns still use JSON frame-window metadata plus `RITOFCB2`, so turn metrics are a
no-regression probe rather than a claim that turns themselves use `RITORB1`.

Do not make the binary path default or move another payload solely from one
local run. Repeat the report on representative machines/books and measure raw
wire, encode/decode, and worker round-trip costs separately before changing the
default. `RITOFCB2` command bytes, transfer bytes, and JSON fixture/debug output
remain available throughout that work.
