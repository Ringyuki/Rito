# @ritojs/core-wasm

Private build and decoder workspace for Rito's Rust/WASM browser runtime.

This workspace is intentionally not published. `@ritojs/core` invokes its build,
bundles the JavaScript binding and decoder modules, and copies the generated
`.wasm` into the public core tarball. Consumers therefore install only
`@ritojs/core`; the packed package has no runtime dependency on
`@ritojs/core-wasm`. Its private `0.0.0` manifest version is a workspace
sentinel, not a public release version.

The Rust `rito-wasm` crate now has a testable internal runtime facade for:

- typed publication metadata/resource inventory JSON,
- document/revision handles,
- revision navigation/chapter page-range JSON,
- spread frame JSON,
- packed frame command buffer metadata and bytes, including v2 command-count
  manifests, record stats, and payload tables for complex paint/transform
  command fields,
- hit target/page target JSON,
- page text-position JSON,
- text range geometry JSON,
- spread frame prefetch JSON,
- structured footnote JSON,
- href/anchor locator JSON,
- revision-scoped search JSON,
- JSON resource payloads without bytes, and
- transfer-id based resource prefetch, frame-resource prefetch, byte reads, and
  releases.

The Rust crate also exposes a minimal `wasm-bindgen` `RitoWasmDocument` wrapper
and is checked against the `wasm32-unknown-unknown` target. The package default
`build` script now produces the generated web-target JavaScript glue and `.wasm`
artifact; `build:placeholder` remains only for fast decoder/type-surface tests
that do not need to compile Rust.

The private `./decoder` export is the WASM-free browser runtime surface. Along
with the packed-buffer decoders and structured error helpers, it exposes the
pure-JavaScript reader compatibility and worker-client helpers needed on the
main thread. The full package root remains reserved for worker execution and
the lazy in-process fallback because it imports the wasm-bindgen glue.
The low-level `RITORB1` decoder reports its payload as a generic JSON value;
view-revision wrappers validate the operation-specific discriminants and
structure before exposing the typed response. Both generated entries reuse the
decoder runtime declaration files as their single signature source.
Each worker-client helper owns exactly one successfully opened publication
session; a failed open may be retried, while disposal is terminal.

For local WASM artifact builds:

```sh
pnpm --filter @ritojs/core-wasm run build
```

That script expects `wasm-bindgen` to be installed locally, builds
`crates/rito-wasm` for `wasm32-unknown-unknown`, and writes experimental web
target glue plus `.wasm` into `dist/`. The generated entry exports
`initRitoCoreWasmEngine()`, which wraps the raw `*Json` methods in a small
document API. The wrapper has explicit TypeScript shapes for revisions,
navigation, frames, packed command-buffer metadata, locators, search, text
geometry, footnotes, resource payloads, and resource prefetch responses; the
control payloads are still JSON-backed while render/resource hot paths move
toward packed buffers and transfer bytes. Rust-side structured failures are
normalized to `RitoCoreWasmError` by the generated wrapper. The packed-buffer
decoder exposes command-count/resource tables and reconstructs display-list
command objects from `RITOFCB2` records and payload tables, so consumers can
validate the byte path without fetching the debug frame JSON command list.

After building, a narrow fixture smoke test is available. It opens a fixture
EPUB, creates a line-breaking-aware revision, reads a paint-ready frame,
verifies the packed `RITOFCB2` command buffer through
`decodeRitoFrameCommandBuffer()`, checks page targets/search/text geometry,
frame-resource prefetch, and reads then releases one image transfer:

```sh
pnpm --filter @ritojs/core-wasm run smoke:wasm
```

For repeatable local verification that does not depend on existing ignored
`dist/` state:

```sh
pnpm --filter @ritojs/core-wasm run verify:wasm
```
