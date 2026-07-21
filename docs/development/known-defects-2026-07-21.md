# Known Defects — found by gate runs, 2026-07-21

Recorded from real-book smoke and the load-profile gate. Each is a real defect
with a known trigger; none is speculative. Ordered by how much it blocks
delivery, not by how deep the code is.

## Fixed in the second pass (2026-07-21, later)

### Chapter-local frame resource payloads reported the wrong href (core)

The former OPEN item below. `store_chapter_local_resource`
(`crates/rito-wasm/src/chapter_local/frame.rs`) reported the
manifest-canonical `resource.href` while the frame's `resource_table` keys by
the display-command href; resolution tolerates relative/percent-encoded forms,
so the two strings diverge (book-01 `Theatre01.xhtml`) and
`requireFrameResourceRefs` rejected the aggregate as "unreferenced". The
payload now echoes the lookup key. Same-family fix in Reader v1:
`read_resource` (`crates/rito-core/src/runtime/reader_v1/session.rs`) now also
echoes the requested href instead of the canonical one — the Dart session
validates the response against the reference it asked for, so the FFI path had
the identical latent mismatch. Usability gate: book-01 including the far-TOC
theatre jump now passes.

### EOCD preflight rejected real books with upload trailers (core)

`preflight.rs` (new in e330bcb) required the ZIP end-of-central-directory
comment to end exactly at EOF. Books saved from multipart HTTP uploads keep a
`------WebKitFormBoundary...--` trailer (and often a prefix, which the central
directory shift scan already tolerated), so byte-identical, previously-passing
corpus books were refused as "Invalid EPUB ZIP end of central directory"
(book-04 and 2/81 smoke books). The scan now runs a strict exact-EOF pass
first, then accepts exactly one in-bounds footer; two parseable candidates
stay fail-closed. Real-book smoke: 79/81 -> 81/81; gate book-04 passes.

### A typed chapter-local worker error disposed the whole reader session

`mutationResult` (`reader-worker-chapter-local-client-runtime.js`) disposed
the shared Worker session whenever a create rejected with no recoverable
owner, and double-released the predicted N+1 owner on continue — but a typed
`{ok:false}` reply proves the worker-side payload runtime already rolled back
(or freed) its own owner. An optional preview failure therefore killed the
session the main TOC jump was running on: the concrete "preview failure fails
the whole TOC jump" mechanism. Typed worker errors now propagate without
disposal or client-side rollback; channel-level failures (worker death,
postMessage loss) keep the dispose. The worker payload runtime now also frees
the document when a committed advance carries no valid owner identity, so the
"typed error ⇒ already contained" invariant holds in every corner.

### Flutter adapter could not compile, then failed 24/141 tests

`reader_session.dart` tested `gateway is RitoResumableExactSeekGateway` on a
declared `RitoReaderGateway`; Dart never promotes to an unrelated interface,
so all five capability calls were undefined methods. Rewritten as if-case
patterns that bind the capable view. After the compile fix, first-ever test
runs surfaced: the lifecycle mock modeled the old canonical-href gateway
behavior (fixed with the core echo fix above), one font test contradicted the
pinned no-resource-fails contract, and two architecture assertions were
malformed (`allMatches(...)` compared to a number; a source string that never
existed). Suite now 141/141 with `dart analyze` clean of errors.

## OPEN — after the second pass

1. **book-10 far-TOC worker requests: p95 18 > 16.** Only remaining usability
   gate failure; book-01/book-04 pass every threshold. The threshold is not to
   be raised. Attribution is complete:
   - The window (click → first preview frame) holds 18 ops: chapter-local
     create + 8 continues (the preview) interleaved 1:1 with resolve + 8
     `continueRevisionTowardSourceLocator` (the parallel exact path at its
     pre-composite `quanta=1` batch level).
   - The preview's continues each seal ≈1 page because one Worker request runs
     one `LayoutWorkMeter` whose line/text quanta (32 line boxes / 16K UTF-16
     units) drain after roughly a dense page. `processedTopLevelNodes` is 0 for
     most of them; the 32-node public budget is never the binding constraint.
   - Preview OFF is far worse (measured A/B): 146 requests, 2087 ms first
     frame. The preview is a large net win; only its request granularity and
     the parallel exact path's window ops exceed the budget.
   - **Bigger quanta for everyone is refuted by measurement.** A bounded
     meter-refill in `advance_record` (4 meters/request) was implemented and
     reverted: it doubled preview CPU through overshoot (the target-resolution
     check only runs between requests) and head-of-line-blocked the preview
     behind packed exact-path ops on the single worker thread — first frame
     went 100 → 180 ms and window ops 18 → 21-23.
   - **Designed fix (not yet implemented):** pack quanta for the chapter-local
     mutation _inside Core_ with an early exit — the continue mutation accepts
     an optional per-request quantum cap, loops advance/append plus a
     locator-resolution check per meter, publishes once, and stops the moment
     the target resolves. No overshoot (the check is per-meter), front-loads
     exactly the work that produces the first visible frame, and cuts the
     window to roughly create, resolve, one or two continues, and a few
     exact-path ops. Alternatively (or additionally) the
     adaptive-continuation-batch could hold the exact path's continuation at
     `quanta=0` until the preview composites or is invalidated, with a
     defensive timeout.
2. **Memory gate: now 3 items over budget** (was 4; `disposedRetainedMiB`
   passes at 162.4 < 200 after this pass's fixes). Current p95 over 3 runs:
   `loadedDeltaMiB` 203.8 > 200 (marginal), `checkpointPeakPhysFootprintMiB`
   527.0 > 480, `replacementGrowthMiB` 148.4 > 96 (the real miss). Run
   variance is high — one run measured 199.6/466.6/78.7, all under budget —
   so the replacement-growth overrun is the only comfortably reproducible
   signal. The replacement scenario also records one failed open (ordinal 11,
   `openSucceeded: false`, `releasedDocument: false` on dispose); whether that
   dispose is benign (no document was created) or retains WASM memory is the
   first question for the attribution pass. Needs WASM-heap vs JS-heap vs
   browser-cache attribution, not another threshold guess.
3. **Release-path fail-granularity**: `releaseChapterLocalRevision` still
   fail-closes the session on any typed release error; distinguishing
   unknown-revision (benign, already gone) from a live-owner release failure
   would narrow the blast radius further.
4. Cross-language guarded matrix and device-level Flutter suites have not
   rerun this pass; local `flutter test` and Rust/JS suites are green.

## Fixed this pass

### Reader-v1 could not build from source

`reader-v1.ts` referenced `./reader-v1-worker-entry.mjs`, which only existed in
`dist/`. Any source-mode bundler (the demo app, a product Vite/Nuxt build)
failed to resolve it, so Reader-v1 had never actually run outside the packaged
artifact. Added the source facade next to the bounded path's existing one.

### CSS source gate refused ~30% of real books

The gate rejected a whole publication for any declaration outside a hardcoded
allowlist — author typos, extension-injected custom properties, `@charset`,
duplicate manifest entries, and CSS the typed contract cannot yet carry.
Rebuilt it as a classifier: Stylo is the authority on what CSS defines,
unrepresentable declarations are recorded (ignored/degraded) in a
publication-level `style_capabilities` report, and only security/unscannable
syntax still fails closed. Real-book smoke: 57/81 -> 79/81.

### `position` was a migration regression

The frozen layout engine supports `position`/relative offsets; the Stylo
migration dropped the field from `LayoutFormattingStyleV1`. Restored
`PositionV1` + physical inset through contract, projection, and materializer.
Also `@media` (Stylo evaluates it — the gate now scans the group), `z-index`
(no-op for the flow consumer), `text-wrap-mode` (already in the contract).

### reflow deadlock from a leaked exact-read suspension

resize / typography / spread / line-breaking all reflow through a bounded
session that suspends "exact reads" and hands them back on commit. Three paths
left the suspension stranded, so `waitForExactReads` spun forever with no
timeout and no error — a silent deadlock on core interactions. Fixes, all
defensive and worth keeping regardless of the root cause below:

- `restoreBrowserReaderExactReads` no longer throws when the controller is
  already dead (reading a dead snapshot); it returns false so the caller runs
  its retirement path instead of skipping cleanup.
- `retireBrowserReaderBoundedOwner` unconditionally releases a suspension the
  retired owner still holds — covers every session-death path at one point.
- `waitForExactReads` no longer throws when the current session is gone: a
  reflow builds its own candidate, so a missing session just means no in-flight
  reads to drain; the anchor capture falls back to the last active spread. A
  bounded timeout reclaims a session whose gate never reopens.

## RESOLVED in the second pass — the reflow deadlock's true trigger

(Kept for the trigger analysis; the fix is recorded above.)

**`createBoundedChapterLocalRevision` returns a frame with an unreferenced
image resource.** Core-level data inconsistency: a chapter-local frame lists an
image in its `resources` whose href is absent from that frame's
`resourceTable`, so `requireFrameResourceRefs`
(`packages/rito-core-wasm/src/chapter-local-frame-validation-runtime.js:170`)
rejects it. That rejection tears down the worker, which is what stranded the
reflow suspension above.

Trigger: TOC jump to a far chapter with an image (book-01 `Theatre01.xhtml`).

Why it is not being fixed now: chapter-local preview is an **optional,
unverified** acceleration exposed through a pluggable capability
(`chapter-local-capability.ts`, `Symbol.for('@ritojs/core/browser/chapter-local-preview-presentation')`).
It is part of the `e330bcb` "statically connected, not new green evidence"
batch. The defensive fixes above already turn its failure from a deadlock into
a recoverable error. The remaining product gap is that a preview failure fails
the whole TOC jump instead of falling back to an ordinary jump — a
fail-granularity problem to fix in the kit/browser layer, not a reason to chase
the core resource-table inconsistency before the feature is even validated.

Fix the core inconsistency when chapter-local preview enters real validation.
Locate at the `createBoundedChapterLocalRevision` aggregate response builder in
`crates/rito-core` — its resource set and resource table must be built from one
source of truth.
