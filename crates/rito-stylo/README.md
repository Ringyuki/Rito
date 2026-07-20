# rito-stylo

`rito-stylo` is Rito's private, direct adapter for Stylo. It is a separate
crate because implementing Stylo's host-node traits requires a small,
auditable amount of `unsafe` interior mutability, while `rito-core` and
`rito-source` keep `unsafe_code = "forbid"`.

This crate is the private Stylo backend used by `rito-core`'s strict
production style resolver. It is linked through `rito-core`, but it is not
re-exported by `rito-core`, WASM, or the TypeScript package and no Stylo type
crosses a public boundary. The adapter uses Stylo directly without Blitz, a
browser DOM, an HTML parser, Taffy, Parley, or resource-loading dependencies.

## Boundary

- Source input: `StyleDocument::from_source` accepts only an
  `Arc<rito_source::SourceArena>`. It has no constructor that accepts XHTML
  text and never parses the chapter itself.
- Shared identity: `StyleDocument` retains the supplied `Arc`, so Stylo,
  `rito-core`, locators, and interaction code can refer to the same immutable
  topology and the same stable `NodeId` values. It may build style-specific
  metadata and sidecars, but it does not duplicate or reparse the source tree.
- Platform boundary: no browser DOM, `window`, `document`, Web API, JavaScript
  runtime, or HTML parser is required. The word “DOM” in Stylo's upstream
  trait/crate names describes its generic host-tree interface, not a runtime
  dependency on a browser DOM.
- Other input: document/base URLs, viewport state, and ordered CSS sources
  with explicit cascade origins.
- Host adapter: a read-only namespace-aware view of `SourceArena`, plus a
  private element style/invalidation sidecar required by Stylo.
- Output: Rito-owned diagnostic `ResolvedStylesV0`/`ResolvedStylesV1`/
  `ResolvedStylesV2` projections plus the typed inline/layout projections used
  by the production core; no Stylo type crosses the facade.
- Traversal: sequential only. The adapter always calls Stylo with no Rayon
  pool.
- Version: Stylo, selectors, Stylo DOM, and Stylo static preferences are
  exactly pinned to `0.19.0`-compatible versions in `Cargo.toml`.

## Safety invariants

- The host adapter storage is pinned before any Stylo node handle can escape.
  The retained `Arc<SourceArena>` keeps source nodes and `NodeId` topology
  stable for the complete session lifetime.
- A Stylo node handle is exactly one pointer wide, as required by Stylo's
  type-erased style-sharing cache.
- A `StyleDocument` is neither `Send` nor `Sync`; a resolve owns it mutably and
  never supplies a parallel thread pool.
- `ElementDataRef` and `ElementDataMut` borrows for one sidecar slot must not
  overlap. Stylo's `ElementDataWrapper` dynamically checks this contract only
  in debug builds; release soundness relies on the adapter's exclusive,
  sequential, non-reentrant traversal call graph. Debug stress tests cover the
  current path; broader production use and future sidecar changes still
  require Miri coverage.
- The pinned host handles and retained source arena are dropped only after
  Stylo state containing opaque node identities.

## Production integration and measured status

Production style resolution is strict: it runs the Stylo-backed resolver and
returns a typed error when source topology, configuration, viewport, Stylo, or
materialization is rejected. The default `rito-core` and `rito-wasm` product
builds physically exclude the hand-written CSS parser, cascade, and prepared
legacy cache. They cannot automatically fall back to that implementation.
The old implementation remains available only behind the explicit
`legacy-css-diagnostics` feature, which enables compatibility analysis APIs
and is also implied by `bench-internals`. Normal publication loading keeps the
legacy `css` and `style` DTO fields present as `null`; it does not initialize a
legacy parser cache.

The final pinned production-corpus routing artifact is
[`stylo-production-corpus-wave5-20260719.json`](../../benchmarks/css-engine-spike/results/stylo-production-corpus-wave5-20260719.json):

- 290/290 chapters across 10 books used Stylo;
- all automatic legacy fallback counters were zero in that recorded routing
  build;
- sampled peak process-tree RSS was 410.0 MiB; and
- 10 strictly audited Duokan single-image wrappers used the then-current named
  `duokan-single-image-flex-elision` compatibility policy.

Those bullets describe the immutable wave5 benchmark snapshot, not the current
fallback or layout policy. The current layout path implements a real but
deliberately bounded flex subset: a block flex container with `row` + `nowrap`,
one image child, positive absolute height, and centering on both axes. It is no
longer an elision, but it is not general flexbox and provides no grid support;
other flex/grid shapes remain outside the supported production contract.

A fresh post-gate strict-routing confirmation is recorded in
[`stylo-strict-routing-post-gate-20260719.json`](../../benchmarks/css-engine-spike/results/stylo-strict-routing-post-gate-20260719.json).
It again resolved 290/290 chapters with every fallback counter at zero while
loading and fully paginating 2,797 pages in 17,631.954 ms; guarded peak
process-tree RSS was 409.1 MiB. This is one sequential routing run. Its elapsed
time includes EPUB loading and full-book pagination, so it is not first-screen
or CSS-only latency evidence.

Wave4 records the preceding 265/290 state, including the 201-chapter gain from
typed `rotate()` support. The wave5 result also includes exact WHATWG
`body@bgcolor` presentational hints and resource-bearing body backgrounds
rendered through page paint. Since that run, the typed production bridge also
carries opacity, maps supported `page-break-before`/`page-break-after` aliases
to Rito pagination fields, and preserves root/body typography and
`font-family` through materialization and reader overrides. These are bounded
contract additions, not a claim of complete CSS, flex, grid, pagination, or
EPUB conformance.

The three-run Book10 production median is recorded in
[`book10-stylo-production-median-20260719.json`](../../benchmarks/css-engine-spike/results/book10-stylo-production-median-20260719.json):

- 25/25 chapter style resolutions used Stylo, with zero fallbacks and zero
  legacy prepared-base calls;
- median style time was 74.195 ms, **6.963× faster** than the historical
  bounded-pagination baseline;
- median end-to-end probe wall time was 1,237.575 ms, **1.396× faster** than
  that baseline; and
- median peak process-tree RSS was 148.9 MiB.

The current result is a three-run median; the comparison baseline is a
historical single run. It demonstrates a material production-path CSS gain,
not a complete cold-open, page-turn, navigation, or animation speedup.

The integrated WASM target compiles, but the current post-`wasm-bindgen`
module is **12,299,941 bytes** (**4,864,072 bytes gzip**). Compilation proves
portability, not release-size acceptability; this remains above the existing
bundle gates.

## Remaining strangler gates

- Extend the 21-field V2 increment to the complete typed Rito layout/paint
  contract and pass same-canonical-output differential tests.
- The EPUB source ledger now supplies linked and embedded stylesheets in
  author order. Add resolved `@import` while preserving URL base, media,
  supports, layers, order, and cycle semantics; the adapter intentionally does
  not pretend that a missing Stylo loader supports imports.
- Stylo 0.19's Servo selector parser hard-codes `:has()` and
  `:nth-child(... of ...)` parsing off. These are recorded capability gaps,
  not silently removed tests.
- Stylo 0.19's Servo profile does not expose the complete Gecko property set.
  Rito bridges the supported legacy `page-break-before`/`page-break-after`
  aliases into pagination, but broader pagination (`@page`, remaining
  `break-*`, `widows`/`orphans`), CJK typography, and counters require a
  measured Rito supplemental cascade or a small upstream-traceable patch set;
  adding fields to the projection cannot recover properties the profile did
  not compute.
- `@page` is currently accepted as a deliberate compatibility no-op. Neither
  the Stylo materializer nor the legacy behavior applies page-box margins; for
  example, Book10's 5 pt top/bottom page margins are ignored. A supplemental
  page cascade is required for standards accuracy.
- The visual golden difference for `border: currentColor inset 1px` is an
  intentional bug fix: Stylo maps unsupported `inset` to a stable drawable
  solid border while preserving computed width and `currentColor`; the legacy
  parser incorrectly consumed `inset` as a color. Golden review/update must
  record that difference instead of treating legacy pixels as the oracle.
- Replace the placeholder font-metrics provider with Rito's real font
  selection and shaping metrics.
- Production currently creates and drops a `StyleDocument` for each chapter
  resolution. Add retained/cached sessions, targeted source-state/style
  invalidation APIs, pseudo-element projection, Miri coverage for the sidecar,
  and retained-session book-scale benchmarks.

CSS resolution is switched to the strict Stylo path. The legacy implementation
is absent from default product builds and can run only when the explicit
diagnostics feature is enabled. Declaring full CSS or EPUB conformance remains
incorrect: unsupported input returns a typed production error, and the
capability gaps above remain open. Page-turn animation, locator restoration,
pagination scheduling, and TOC navigation are separate reader systems and were
neither removed nor made fast merely by changing the CSS backend.
