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

## RESOLVED in the third pass — book-10 far-TOC request budget

**Was: p95 18 > 16 window ops. Now: 9 ops, first frame 92.7 ms — every
usability gate threshold passes on all three corpus books.** The fix is the
designed one below: chapter-local create/continue accept an optional
`maxQuanta` (1..=16, absent = 1 = old behavior). Core loops advance + append
plus a locator-resolution check per meter and publishes once, stopping the
moment the target resolves — no overshoot, and the work that produces the
first visible frame is front-loaded. The browser preview passes `maxQuanta: 4`
(`LOCAL_QUANTA_PER_REQUEST` in `chapter-local-preview/task.ts`); Reader v1's
own quanta loop and rollover stay at one meter. The JS request validators
forward the field and scale the advance work bound to `nodes × quanta`.

Attribution history (kept because the refuted path is easy to re-propose):

- The 18-op window held chapter-local create + 8 continues (the preview)
  interleaved 1:1 with resolve + 8 `continueRevisionTowardSourceLocator`
  (the parallel exact path at its pre-composite `quanta=1` batch level).
  Each continue sealed ≈1 page because one Worker request ran one
  `LayoutWorkMeter` whose line/text quanta drain after roughly a dense page.
- Preview OFF is far worse (measured A/B): 146 requests, 2087 ms first
  frame. The preview is a large net win.
- **Bigger quanta for everyone is refuted by measurement.** A bounded
  meter-refill in `advance_record` (4 meters/request) was implemented and
  reverted: it doubled preview CPU through overshoot (the target-resolution
  check only ran between requests) and head-of-line-blocked the preview
  behind packed exact-path ops on the single worker thread — first frame
  went 100 → 180 ms and window ops 18 → 21-23. The shipped fix differs
  exactly in checking resolution per meter inside the mutation.

## Round 5 started — the browser is now the only baseline

Decision (2026-07-21): the TypeScript core is demoted from visual authority to
regression fixture, exactly as the deletion ledger prescribes. The pinned
browser is the only layout baseline from now on.

First working increment, `apps/reader/tests/e2e/browser-line-baseline.e2e.test.ts`
(report-first; thresholds gate only after their independent baseline review):

- Pinned bundled Chromium renders one dense fixture chapter (book-01
  Section001) at the native content width with the same pinned font bytes,
  registered under the same `__RitoPinned_<sha256>` family names the native
  paint commands carry, so font resolution is identical by construction.
- Per-character Range geometry merges into browser lines; the native side
  decodes the same chapter's paintText commands per page. The comparator
  reports line-break parity, first divergence, and x/width deltas to
  `test-results/browser-baseline/section001-line-baseline.json`.
- First run: **the first 401 lines match the browser exactly, line by line,
  with x/width deltas p50 = p95 = 0 px** (max 3.8/7.7 px inside matched
  lines). Font measurement and greedy line breaking agree with Chromium on
  plain paragraphs.
- The first divergence is not a line-breaking bug: the oracle page rendered
  an `epub:type="footnote"` aside ("注：纸张飘落的声音") into the flow, which
  a reader excludes, and the noteref inline difference shifted the break of
  its paragraph. Next increment: pin the reader-UA semantics into the oracle
  page (hide footnote asides, match noteref rendering), then re-measure —
  the plan's "Pin … UA/reader styles" step, made concrete by data.

## OPEN — after the third pass

1. **Memory gate: 3 items over budget — attribution now complete.** Every
   dispose acknowledgement now reports the WASM linear-memory high-water mark
   (`wasmMemoryByteLength`), recorded per session in the gate's
   worker-lifecycle report. What the measurements establish:
   - **Core is exonerated.** Across every run the recycled Worker's WASM
     instance is 28.5 MiB after the first session and a flat 39.6 MiB from
     the third onward — no growth over eight replacement cycles. A recycle
     byte-budget is unnecessary; the earlier "wasm ratchet" hypothesis is
     refuted.
   - The `replacementGrowthMiB` overrun (measured 95.6 / 171.4 / 198.1 across
     runs against 96; one run passes) lives in renderer-internal, non-JS-heap
     memory: page JS heap (~6-9 MB), page backing store (~33 MB), GPU,
     browser, and network processes are all flat while the single renderer
     process saw-tooths upward. The `disposed` checkpoint falls **below** the
     `reflow` level, so nothing is retained unboundedly; product-side
     `ImageBitmap.close()` discipline is in place on every release path. The
     residue is decoded-image/Blink cache memory with lazy reclaim.
   - The checkpoint stability window (3 × 250 ms samples, ≤8 MiB range) is
     shorter than that reclaim cycle, which is exactly where the run-to-run
     variance comes from. Making the replacement checkpoints wait out the
     reclaim (or measuring retention at a settled point) is a
     **gate-methodology change that needs its independent baseline review**
     before it can be used to pass the gate.
   - The one failed open at ordinal 11 is `disposeThroughInvalidFile` — the
     scenario's deliberate invalid-file teardown; `releasedDocument: false`
     with no document created is benign.
   - Decoded bitmaps are now byte-bounded: book-01's 36 images decode to
     141.1 MiB total (front matter alone 82 MiB), previously resident for the
     whole session. `decoded-image-cache.ts` evicts least-recently painted
     bitmaps above a 96 MiB budget, protecting pending loads and the active
     spread; an evicted image re-warms on demand through the existing
     missing-image path. This bounds real full-book reading residency (the
     plan's Round-2 byte-budget requirement) but does **not** move this gate:
     the scenario never decodes past the budget, and a verification run
     measured the same metrics within run-to-run variance (loadedDelta
     196.9-205.0, peak 509.9-582.6, replacementGrowth 124.7-184.5, disposed
     208.8-224.0 — `disposedRetainedMiB` crossed its threshold in this batch
     purely on that variance). All four metrics stay open pending the
     sampling-methodology review above; iterating product changes against a
     noise-dominated measurement is explicitly not the next step.
2. **Release-path fail-granularity**: `releaseChapterLocalRevision` still
   fail-closes the session on any typed release error; distinguishing
   unknown-revision (benign, already gone) from a live-owner release failure
   would narrow the blast radius further.
3. Evidence coverage after the third pass: local `flutter test` (141/141)
   and every Rust/JS suite are green; the release-protocol E2E passes; the
   usability gate passed twice consecutively and real-book smoke is 81/81.
   **iOS simulator adapter build smoke passes**: a minimal
   `packages/rito_flutter/example` host app builds `Runner.app` with the
   Rust Native Asset compiled and embedded as `rito_ffi.framework`
   (a fat x86_64 + arm64 simulator binary; the missing rustup targets were
   the only obstacle and are named by the hook's own error). **Android build
   smoke passes**: `flutter build apk --debug --target-platform
android-arm64` cross-compiles rito-ffi through the hook and embeds
   `lib/arm64-v8a/librito_ffi.so` in app-debug.apk (SDK, NDK 28.2, and
   licenses were already present; the `cmdline-tools` gap `flutter doctor`
   flags is not required by Gradle). On-device/runtime Flutter integration
   remains unrun.

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
