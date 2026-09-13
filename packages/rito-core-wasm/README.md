# @ritojs/core-wasm

Private build and decoder workspace for Rito's Rust/WASM browser runtime.

This workspace is not published. `@ritojs/core` runs its build, bundles
the JavaScript binding and decoder modules, and copies the generated
`.wasm` into the public tarball; consumers install only `@ritojs/core`.
The private `0.0.0` version is a workspace sentinel.

## What it contains

- `scripts/build-wasm.mjs` — builds `crates/rito-wasm` for
  `wasm32-unknown-unknown` with a locally installed `wasm-bindgen` CLI and
  writes the web-target glue plus `.wasm` into `dist/`; `build:placeholder`
  writes a WASM-free surface for fast decoder and type tests
- `src/` — the document runtime wrapper over the raw `*Json` and byte
  methods (`initRitoCoreWasmEngine()`), the versioned and chapter-local
  runtimes, the bounded reader session, the `RITODL1` frame command buffer
  decoder, and the typed shapes of every wire message
- `tests/` — Node tests of the decoders, the Worker client helpers and the
  runtime wrappers; `tests/fixtures/reader-session-primitive-list.hex` holds
  bytes the Rust encoder wrote for one of every primitive
- `./decoder` — the WASM-free surface the reader's main thread imports:
  the frame command buffer decoder, structured errors and the Worker
  client helpers. The package root imports the wasm-bindgen glue and is
  reserved for the Worker and the in-process fallback.

The engine exposes frames to the browser only as lowered `RITODL1` bytes
plus metadata; there is no JSON display list. See
[Wire Format](../../docs/development/wire-format.md).

## Commands

```sh
pnpm --filter @ritojs/core-wasm build
pnpm --filter @ritojs/core-wasm test
pnpm --filter @ritojs/core-wasm typecheck
pnpm --filter @ritojs/core-wasm verify:wasm
```

`verify:wasm` rebuilds and verifies the artifact without depending on an
existing `dist/`.
