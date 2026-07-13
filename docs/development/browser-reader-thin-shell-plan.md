# Browser Reader Thin Shell Plan

This plan is the hard execution target for turning `@ritojs/core` into a Rust-owned
reader runtime with a small browser TypeScript shell.

It is intentionally separate from the broader Rust core plan. The purpose here is
not render parity, CSS completeness, or UI work. The purpose is to eliminate
TypeScript ownership of reader runtime policy.

## Scope

Counted TypeScript shell scope:

- `packages/rito/src/bindings/browser/reader/**/*.ts`
- `packages/rito/src/reader/**/*.ts`

Not counted:

- `packages/rito/src/reference/ts-core/**`
- tests
- docs
- generated `dist`
- Rust crates
- private `@ritojs/core-wasm` package wrapper

The old TypeScript core may remain under `src/reference/ts-core/**` as a runnable
reference oracle for Rust parity. It must not be exposed as public API and must
not become part of the production reader runtime.

## Baseline

Measured on 2026-05-07:

| Area                             | Files | Lines |
| -------------------------------- | ----: | ----: |
| `src/bindings/browser/reader/**` |    46 |  3314 |
| `src/reader/**`                  |     6 |   353 |
| Total counted shell              |    52 |  3667 |

Current browser binding line split:

| Area                                    | Lines | Problem                                                     |
| --------------------------------------- | ----: | ----------------------------------------------------------- |
| `pipeline/`                             |   842 | Owns reflow/runtime orchestration                           |
| `state/`                                |   315 | Stores runtime-like state instead of browser handles only   |
| `worker-main/`                          |   402 | Operation-level TS runtime proxy                            |
| `worker-client*` + `worker-protocol.ts` |  ~426 | Operation wrappers and protocol branching                   |
| `resources/`                            |   243 | Mostly legitimate browser resource lifecycle                |
| `methods/`                              |   286 | Compatibility facade for existing `Reader` API              |
| binding root support                    |  ~800 | Mixed facade, frame cache, navigation projection, bootstrap |

## Hard Final Target

The final shell target is:

| Area                             | Max Files | Max Lines |
| -------------------------------- | --------: | --------: |
| `src/bindings/browser/reader/**` |        20 |      1550 |
| `src/reader/**`                  |         6 |       360 |
| Total counted shell              |        26 |      1910 |

The target is not met if lines are merely moved to another TypeScript directory.
Reader runtime policy must move to Rust-owned APIs, not to new TS adapters.

### Production Bounded/Interaction Ceiling (2026-07-13)

The production bounded and native-interaction slices require a counted browser
adapter that binds page-target, semantic, footnote, source-range, locator,
frame/resource and search reads to the active Worker, revision version and browser
commit generation. It also owns small visible-window caches, pending-read
coalescing, candidate/current session replacement and exact-read suspension during
bounded growth. These are browser revision-lifecycle responsibilities and must
remain inside the counted reader directory.

The production switch is complete and the legacy preview/deferred-full scheduler
is deleted. As measured on 2026-07-13, the counted binding is 20 files / 2399
physical lines and the public Reader contract is 5 files / 637 physical lines.
This remains above the original final target, but the excess is no longer hidden
legacy scheduling policy. Future compaction must move semantic decisions behind
Rust-authored operations while keeping unavoidable browser lifecycle adapters in
scope; moving code elsewhere only to satisfy the older number is forbidden.

## Non-Negotiable Boundaries

- No new TypeScript reader runtime directory outside `src/bindings/browser/reader/**`.
- No new TS state machine for preview/full revision scheduling.
- No new browser-side spread warm policy.
- No new operation-specific worker runtime files after the command boundary is in
  place.
- No public `@ritojs/core/web` subpath for the migration shell.
- `src/reference/ts-core/**` remains source-only reference code and is not a
  production fallback.
- Browser TS may keep only platform concerns:
  - WASM loading
  - Worker creation
  - message correlation
  - transferable response handling
  - Canvas presentation
  - `ImageBitmap`, `FontFace`, object URL, and listener lifecycle
  - compatibility projection to the existing `Reader` interface

## Execution Rounds

Each round must update this plan's status row before being considered complete.
If a round cannot hit its budget, the reason must be written here before moving
on.

### Round 1 - Rust-Owned View Runtime Command

Goal: replace browser-side preview/full revision planning with one Rust-owned
view update command.

Required changes:

- Add Rust runtime request/response for view updates:
  - layout config
  - line-breaking
  - active spread
  - previous revision context
  - requested mode: preview or full
- WASM exposes a single command that returns:
  - view revision kind: preview or full
  - revision bundle snapshot
  - selected frame/window/resource plan
- Browser `pipeline/reflow.ts` stops choosing initial-preview vs active-preview
  vs full-revision paths itself.

Exit budget:

- `pipeline/` <= 520 lines
- browser binding <= 42 files
- browser binding <= 2950 lines

### Round 2 - Thin Worker Message Boundary

Goal: remove operation-level TS worker runtime proxy.

Required changes:

- Rust/WASM owns the reader runtime command dispatch surface.
- Browser worker-main becomes:
  - parse message
  - call runtime command
  - collect transferables
  - post response
- Delete or collapse operation files under `worker-main/`.
- Worker protocol stops mirroring each runtime operation as a hand-written TS
  branch where Rust can provide the response shape.

Exit budget:

- `worker-main/` <= 140 lines
- browser binding <= 35 files
- browser binding <= 2500 lines

### Round 3 - Browser State Snapshot

Goal: shrink `BrowserReaderState` into browser handles plus current runtime
snapshot.

Required changes:

- Rust view response becomes the source of truth for:
  - revision bundle
  - active visual frame selection
  - pages/spreads/navigation compatibility snapshot
  - pending/full revision state
- Browser state keeps:
  - worker/client handles
  - canvas/context
  - decoded frame cache
  - image/font/object URL caches
  - listeners
  - current snapshot
- Remove duplicated runtime fields where Rust snapshot already owns the data.

Exit budget:

- `state/` <= 170 lines
- `pipeline/` <= 320 lines
- browser binding <= 30 files
- browser binding <= 2200 lines

### Round 4 - Reader Facade Compatibility Cleanup

Goal: keep the existing public `Reader` interface working while removing
projection logic that should come from the runtime snapshot.

Required changes:

- `methods/` collapsed where methods are thin reads or command forwards.
- `navigation.ts` projection reduced to snapshot mapping only, or moved behind
  Rust-owned compatibility output.
- `reader.ts` only opens runtime, creates state, builds facade, and defines
  accessors.

Exit budget:

- `methods/` <= 200 lines
- binding root support <= 520 lines
- browser binding <= 24 files
- browser binding <= 1850 lines

### Round 5 - Final Shell Compaction And Guards

Goal: hit the final target and prevent regression.

Required changes:

- Add architecture invariants for:
  - maximum counted browser shell files
  - maximum counted browser shell lines
  - no TS runtime policy files outside allowed browser shell directories
  - no public export of reference TS core
- Remove compatibility helpers that are no longer consumed.
- Update docs to mark the thin shell target complete.

Exit budget:

- `src/bindings/browser/reader/**` <= 20 files and <= 1550 lines
- `src/reader/**` <= 6 files and <= 360 lines
- counted total <= 26 files and <= 1910 lines

## Per-Round Verification

Every round must run:

```sh
cargo test -p rito-core
cargo test -p rito-wasm
cargo clippy -p rito-core --all-targets -- -D warnings
cargo clippy -p rito-wasm --all-targets -- -D warnings
pnpm --filter @ritojs/core-wasm build
pnpm --filter @ritojs/core-wasm test
pnpm --filter @ritojs/core-wasm typecheck
pnpm --filter @ritojs/core typecheck
pnpm --filter @ritojs/core test
pnpm --filter @ritojs/core build
pnpm lint
git diff --check
```

Every round must also record these metrics:

```sh
find packages/rito/src/bindings/browser/reader -type f -name '*.ts' -print | wc -l
find packages/rito/src/bindings/browser/reader -type f -name '*.ts' -print | sort | xargs wc -l
find packages/rito/src/reader -type f -name '*.ts' -print | wc -l
find packages/rito/src/reader -type f -name '*.ts' -print | sort | xargs wc -l
```

## Status Ledger

| Date       | Round         | Browser Files | Browser Lines | Reader Files | Reader Lines | Status      |
| ---------- | ------------- | ------------: | ------------: | -----------: | -----------: | ----------- |
| 2026-05-07 | Baseline      |            46 |          3314 |            6 |          353 | In progress |
| 2026-05-07 | Round 1       |            38 |          2944 |            6 |          353 | Complete    |
| 2026-05-07 | Round 2       |            31 |          2563 |            6 |          353 | Complete    |
| 2026-05-07 | Round 3       |            15 |          2186 |            6 |          353 | Complete    |
| 2026-05-07 | Round 4       |            15 |          1846 |            6 |          353 | Complete    |
| 2026-05-07 | Round 5a      |            15 |          1781 |            6 |          353 | Complete    |
| 2026-05-07 | Round 5b      |            12 |          1449 |            6 |          353 | Complete    |
| 2026-05-07 | Round 5c      |            11 |          1479 |            6 |          353 | Complete    |
| 2026-07-10 | Hardening     |            11 |          1512 |            6 |          354 | Complete    |
| 2026-07-11 | Session cache |            12 |          1537 |            6 |          354 | Complete    |
| 2026-07-13 | Bounded prod. |            20 |          2399 |            5 |          637 | Complete    |

The round descriptions below are historical checkpoint notes. References to a
preview/full or deferred-full scheduler describe code that the 2026-07-13
production bounded switch later removed.

At the 2026-07-11 checkpoint, the session-cache increment kept one Reader-scoped
cache/factory in the browser shell while the cache implementation and protocol
validation remained in the private core-wasm workspace. The architecture
invariant's split-line count was 1549/1550 for the browser binding (and 360/360
for `src/reader/**`). The later bounded-production and interaction rows supersede
those measurements.

Round 2 completed the intended boundary change: browser `worker-main/` is now
140 lines and delegates operation payload construction to the private
`@ritojs/core-wasm` wrapper through `readerWorkerPayload(...)`. The browser
binding is still 63 lines over the original Round 2 line budget because
`revision/visual-preview.ts` remains necessary for active-chapter preview display
mapping. Deleting it before Rust exposes a directly committable visual snapshot
would break current resize preview semantics. Round 3 must remove that carry-over
by moving the visual preview snapshot into the Rust-owned view response.

Round 3 completed the state snapshot cleanup. Rust view revisions now declare the
display policy and selected frame; browser reflow only schedules
`createViewRevision(...)` and delegates commit application to `revision.ts`.
Duplicated `pages`, `spreads`, and `chapterMap` fields were removed from
`BrowserReaderState`; compatibility accessors now read from the current Rust
revision bundle. The old `state/`, `methods/`, `resources/`, `revision/`, and
`worker-main/` subdirectories were collapsed. Browser-owned visual preview state
still exists only as a presentation cache for the frame Rust selected, not as a
browser-side revision planning policy.

Round 4 moved the generic worker request/response client and worker-side message
handler into the private `@ritojs/core-wasm` wrapper. `@ritojs/core` now keeps
only worker creation, in-process fallback selection, canvas/resource lifecycle,
and the existing `Reader` compatibility facade. Browser-side resource warming no
longer keeps a separate spread resource scheduler map; it applies Rust-planned
resource bytes and invalidates the spread after decode. The browser binding is
now under the Round 4 line budget, but the final 1500-line target still requires
shrinking the remaining preview/full reflow scheduler, `Reader` facade methods,
and compatibility navigation projection.

Round 5a moved the remaining navigation compatibility projection
(`pages`/`spreads`/`chapterMap`/TOC target lookup/footnote and chapter text map
creation) behind private `@ritojs/core-wasm` helper functions. The browser
binding still has the same public Reader compatibility surface, but it no longer
owns the projection algorithms directly. The final gap to 1500 lines is now the
browser preview/full reflow scheduler plus the legacy `Reader` method facade.

Round 5b starts the remaining scheduler cleanup by moving deferred-full follow-up
policy into the Rust-owned view revision response. Rust now decides whether a
preview needs a follow-up full revision and returns the complete delayed full
request with the delay. Browser reflow still owns timer execution, Worker
selection, rebinding the active spread at dispatch, and dropping a revision id
that belongs to another Worker session; it no longer reconstructs layout,
line-breaking, or mode policy from browser state. The private reader client
validates that a follow-up preserves the preview request's layout and
line-breaking semantics before hydration, and releases the new revision if that
contract is violated.
The browser resource and Canvas presentation adapters were also moved out of
`src/bindings/browser/reader/**` into `src/bindings/browser/` because they are
platform adapters, not reader runtime policy. This hits the counted final reader
shell target without hiding runtime policy in another TypeScript directory. The
remaining non-counted browser adapter code is still TypeScript by necessity:
FontFace/ImageBitmap/object URL lifecycle and the production Canvas presentation
adapter. That adapter is now independent of the TypeScript reference core; the
reference renderer remains only in parity and diagnostic tooling. A focused
Playwright differential loads the published adapter and the reference reader in
one Chromium page, waits for the production full revision and ready frame, and
requires exact pixels for representative paint commands.

Round 5c split the remaining oversized browser reader facade functions and moved
the private `@ritojs/core-wasm` contract re-export to `src/bindings/browser/`.
That contract file is package-binding glue, not reader runtime policy. The counted
reader shell remains below budget, and lint no longer reports max-lines warnings
for the browser reader facade.

The 2026-07-10 hardening pass deliberately raises the browser shell ceiling from
1500 to 1550 lines without moving responsibility outside the counted directory.
The binding is 1512 lines by `wc -l` and 1523 lines under the invariant's
newline-splitting count, leaving a small safety increment. The added code owns
necessary browser lifecycle duties: explicit Rust revision release, a bounded
12-frame LRU cache, and correct preview/full handoff between the foreground and
full-reflow workers, with regression coverage for switching back.

The 2026-07-11 native-interaction pass added the atomic public interaction
capability and its exact-version browser adapter under the checkpoint ceiling
documented above. Its cache was revision-scoped and visual previews were
non-interactive at that checkpoint. The matching Kit slice consumes link,
footnote and standalone-image targets. Subsequent slices completed exact
selection/copy, source annotations and re-projection, portable reading positions
and visible-spread accessibility. Native search now transports a proven durable
source range, and Kit resolves visible-result geometry through the exact
source-range capability without a legacy fallback. Runtime publication verifies
the raw parsed-source slice before exposing a resolved range, and a production
Worker E2E proves an embedded-font demo result paints and clears its Canvas
highlight.

The 2026-07-13 integration pass keeps the host boundary narrow while completing
the product wiring: accessibility mirror content survives navigation, mirrored
links return through native target dispatch, image clicks resolve native resource
bytes with latest-request/Blob-URL cleanup, and partial-boundary Next requests
bounded growth. Footnote HTML safety is owned by the Rust allowlist serializer,
not by a new browser sanitizer. The production path passed 74 Downloads EPUBs
and the complete strict zero-threshold reader parity matrix. These runs validate
the switch but do not close the formal usability/latency gate.

### Production Bounded Revision Contract

The bounded core/WASM path entered production through the private core-wasm
session controller, not another browser-owned reflow policy branch. Its contract
remains:

- keep at most one continuation quantum in flight for one revision, coalesce
  requested target spreads with latest-request priority, and yield between
  quanta. A retarget to an already-known spread must prevent the next quantum
  from starting;
- attach the full Worker-session and Rust revision handle to every request and
  response; an accepted advance rebinds the active handle before any follow-up
  read can start;
- invalidate pending frame/resource work from the previous version. The current
  production slice clears decoded frame caches on advance; retaining a
  stable-prefix frame later requires an explicit version-retagging invariant;
- release or cancel the latest accepted handle. A stale handle must never fall
  back to an ID-only revision release;
- keep incomplete chapter text indices inline and revision-scoped; never store
  them under the `chapter-text-v1:full` publication cache key;
- consume the failed revision summary carried by an engine-failure response so
  failed work can be inspected and released without guessing the next version;
- use the complete current navigation snapshot after growth until a typed
  appended-spread/chapter-upsert delta is justified by profiling.

Production now selects bounded revisions. Candidate growth suspends exact reads
until the next presentation commits, partial extents remain distinct from final
extents, and Browser/Kit race tests cover session replacement and stale work.
The cross-chapter footnote index is lazy-state-safe and now parses each available
spine source once, but its first full-spine scan remains outside the work budget.
Top-level Greedy leaf paragraphs yield between line boxes; nested containers,
tables, Optimal paragraphs and individual shaping calls remain atomic quanta.

The private controller now implements the single-pump, target-coalescing,
task-yielding and latest-handle cleanup rules above, including an exact-version
frame/resource window. It now publishes exact slim presentation metadata and
can grow to a source locator or drain to completion. Exact revision bundles,
search, footnotes and chapter text indices still cross both in-process and
Worker transports for explicit consumers. Browser frame,
resource, search and release operations have also moved off revision-ID-only
methods. The 3060 split-counted / 3033 physical-line checkpoint was the
pre-switch ceiling. The legacy preview/deferred-full machinery has since been
deleted, and the current physical count is recorded in the ledger above. The
remaining thin-shell work is to turn candidate/current
commit, cache and font-reflow semantics into explicit Rust-authored host
operations, not to build another continuation scheduler.
