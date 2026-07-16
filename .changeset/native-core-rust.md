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
Bounded sessions now publish a slim exact-version presentation without cumulative footnote or
chapter-text payloads, can grow directly to a durable source locator, and can explicitly drain to a
complete revision. Locator transport echoes its normalized request, and recoverable locator/frame
reads fail only their target instead of releasing a healthy session.
Native text ranges now span exact retained flows within a chapter, preserve native line and block
separators, survive reflow through durable source ranges, and expose TOC-backed destination labels
for internal-link previews. Production Reader gestures retain their anchor while reversing direction
and preserve the latest valid in-flight drag result when pointer release lands outside text.
