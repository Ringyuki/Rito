---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
---

Replace the public TypeScript reader runtime with the Rust/WASM-backed native core, move the old
TypeScript engine behind a source-only parity oracle, and migrate Kit and React to the root Reader
contract. The public core package now ships its WASM runtime internally instead of exposing legacy
implementation subpaths.
