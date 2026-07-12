---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
---

Replace the public TypeScript reader runtime with the Rust/WASM-backed native core, move the old
TypeScript engine behind a source-only parity oracle, and migrate Kit and React to the root Reader
contract. The public core package now ships its WASM runtime internally instead of exposing legacy
implementation subpaths. Kit reading positions now persist native source locators, and
`ReaderController.goToPosition` returns a Promise while resolving them through an atomic
Reader-owned revision transition. Exact revision bundles, search, footnotes and chapter text
indices now cross both in-process and Worker transports, and Browser frame/resource/search/release
operations bind the complete revision version in preparation for bounded incremental pagination.
