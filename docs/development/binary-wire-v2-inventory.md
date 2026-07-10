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
- The next implementation must use that opt-in path for A/B or benchmark
  validation before replacing any default reader call.

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
- invalid resource, page, frame, target, or geometry indexes;
- mismatched declared and decoded record counts.

## Exit Criterion For The First Slice

The first slice is not ready to become default until an opt-in binary reader
path proves it does not regress page-turn UX. `RITOFCB2` command bytes, transfer
bytes, and JSON fixture/debug output remain available. The next slice should add
an A/B switch or benchmark harness before moving another payload such as search,
locator, page targets, page text positions, or text range geometry.
