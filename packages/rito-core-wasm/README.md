# @ritojs/core-wasm

Private build and decoder workspace for Rito's Rust/WASM browser runtime.

This workspace is not published. `@ritojs/core` runs its build, bundles
the JavaScript binding and decoder modules, and copies the generated
`.wasm` into the public tarball; consumers install only `@ritojs/core`.
The private `0.0.0` version is a workspace sentinel.

## What it contains

- `scripts/build-wasm.mjs` — builds `crates/rito-wasm` (the reader) and
  `crates/rito-pack` (packing and the readability check, which
  `@ritojs/pack` bundles as `./pack`) for `wasm32-unknown-unknown` with a
  locally installed `wasm-bindgen` CLI and writes the web-target glue plus
  `.wasm` into `dist/`; `build:placeholder` writes a WASM-free surface for
  fast decoder and type tests
- `src/` — the reader session runtime: the Worker that hosts a session
  and the client that speaks to it, the encoders of every request and the
  decoders of every answer (artifacts, the `RITODL1` primitive list,
  publications, queries), the pinned font policy check, and the typed
  shapes of every wire message
- `tests/` — Node tests of the decoders, the Worker and its client;
  `tests/fixtures/` holds bytes the Rust encoder wrote, among them
  `reader-session-primitive-list.hex` with one of every primitive
- `./decoder` — the WASM-free surface the reader's main thread imports:
  the artifact and primitive list decoders, structured errors and the
  Worker client. The package root imports the wasm-bindgen glue and is
  reserved for the Worker.

The engine hands a page to the browser as a session artifact whose paint
is lowered `RITODL1` bytes; there is no JSON display list. See
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
