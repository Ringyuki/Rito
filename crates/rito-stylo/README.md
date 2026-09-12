# rito-stylo

`rito-stylo` is Rito's private, direct adapter for Stylo. It is a separate
crate because implementing Stylo's host-node traits requires a small,
auditable amount of `unsafe` interior mutability, while `rito-core` and
`rito-source` keep `unsafe_code = "forbid"`.

This crate is the Stylo backend of `rito-core`'s style resolver. It is
linked through `rito-core`, but it is not re-exported by `rito-core`, WASM,
or the TypeScript package and no Stylo type crosses a public boundary. The
adapter uses Stylo directly without Blitz, a browser DOM, an HTML parser,
Taffy, Parley, or resource-loading dependencies.

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
  with explicit cascade origins. The reading-system UA stylesheet lives in
  `src/ua.rs` and is the single place reading-system defaults are declared.
- Host adapter: a read-only namespace-aware view of `SourceArena`, plus a
  private element style/invalidation sidecar required by Stylo.
- Output: the typed inline and layout projections of `rito-style-contract`
  (`InlineStyleTableV1`, `LayoutStyleTableV1`), indexed by source node; no
  Stylo type crosses the facade.
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

## Known gaps

- Stylesheets arrive from the EPUB source ledger in author order; resolved
  `@import` is not supported, and the adapter does not pretend that a
  missing Stylo loader supports it.
- Stylo 0.19's Servo selector parser hard-codes `:has()` and
  `:nth-child(... of ...)` parsing off. These are recorded capability gaps,
  not silently removed tests.
- Stylo 0.19's Servo profile does not expose the complete Gecko property set.
  Broader pagination (`@page`, the remaining `break-*` properties,
  `widows`/`orphans`), CJK typography, and counters require a measured Rito
  supplemental cascade or a small upstream-traceable patch set; adding fields
  to the projection cannot recover properties the profile did not compute.
- `@page` is accepted as a deliberate no-op: page-box margins declared there
  are ignored.
- Font metrics for `ex`/`ch` units come from a placeholder provider, not from
  the shaping engine's faces.
- Production creates and drops a `StyleDocument` for each chapter resolution.
  Retained sessions, targeted invalidation, pseudo-element projection and
  Miri coverage for the sidecar remain open.
