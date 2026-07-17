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
and preserve the latest valid in-flight drag result when pointer release lands outside text or races a
cancelled exact-read response.
Rust-authoritative ICU word and retained-flow paragraph selection now power mouse double/triple click,
repeated-click drag, and touch long press while preserving exact cross-page source ranges.
Released native selections now survive asynchronous image/frame content repaints. Candidate revisions
calibrate browser font advances and exact-size vertical font boxes before becoming interactive, so
caret/highlight geometry matches native selection without shrinking the forgiving line-height hit area.
Captured touch handles can now grow an unpublished bounded spread and continue across the appended
revision through an atomic stable-prefix caret-to-point operation; replacement layouts still invalidate
the selection, and stale growth cannot supersede a newer navigation or layout intent.
Primary mouse/pen and touch long-press selection drags now use the same exact gesture lease to dwell
across already-published or lazily appended spread edges, replay through the new coordinate projection,
retain precise copied text after immediate release, and suppress target activation after a physical turn.
Every physical selection press now claims one latest-input barrier before resolving coordinates, cancels
older spread/locator/portable-position work without invalidating a stable reading position, and passes the
same claim to derived mouse semantics or the delayed long-press instead of letting them reclaim ownership.
Canvas-focused keyboard selection now uses an atomic Rust fixed-anchor movement contract for physical
characters, platform-specific word and paragraph boundaries, sticky visual lines, line edges and
same-chapter edges. Serialized Kit commands retry append-staled reads, preserve collapsed caret continuity,
fail closed when a newer input or navigation owns the surface, and grow/reveal a lazy chapter tail without
dropping the retained highlight.
The locale-aware ICU auto data increases the release WASM by about 2.5 MB raw (1.9 MB gzip) and
37 initial memory pages; this preserves Chinese, Japanese, Thai, and locale-tailored word behavior.
