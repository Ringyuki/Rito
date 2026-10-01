# `@ritojs/kit`

`@ritojs/kit` is the framework-agnostic orchestration layer built on top of the
root reader and interaction primitives from `@ritojs/core`.

Use it when the core `Reader` is too low-level and you want a production-oriented reading surface:

- page transitions
- overlay composition
- search / selection / annotations wiring
- keyboard integration
- position storage hooks

## Main Exports

```ts
import { createController } from '@ritojs/kit';
```

Core exports:

- `createController`
- `ReaderController`
- `ReaderControllerEvents`
- `ControllerOptions`
- `InteractionMode`
- `AddAnnotationInput`

Supporting exports:

- `createKeyboardManager`
- `KeyboardManager`
- `createLocalStorageAnnotationAdapter`
- `createLocalStoragePositionAdapter`
- `PositionStorageAdapter`

Interaction data tools:

- `parseReadingPosition` and the `ReadingPosition` type
- `AnnotationRecord`, `AnnotationRecordPatch`, `RecordStorageAdapter`, `ResolvedAnnotation`
- `SearchResult`
- `OverlayLayer`
- `Rect`
- `TransitionDriverOptions`
- `createEmitter`
- `TypedEmitter`
- `createDisposableCollection`
- `DisposableCollection`

## Typical Use

```ts
import { createReader } from '@ritojs/core';
import { createController } from '@ritojs/kit';

const container = document.getElementById('reader');
const canvas = document.createElement('canvas');

if (!container) throw new Error('Expected #reader container');

const reader = await createReader(epubData, canvas, {
  width: 800,
  height: 600,
  // Required: the engine shapes text with pinned font bytes.
  pinnedFontPolicy: await loadPinnedFontPolicy(),
});

const controller = createController(reader, canvas, {
  transition: { stiffness: 180, damping: 22 },
});

controller.mount(container);
controller.goToSpread(0);
```

The controller owns the mounted reading surface after `mount()`: transition layers,
overlay canvas, and interaction bindings are attached under that container.

## Responsibilities

`@ritojs/kit` adds the app-facing interaction layer on top of core rendering:

- display-surface management
- buffer pool and overlay composition
- transition driver and frame scheduling
- selection/search/annotation/position engines
- pointer/touch/keyboard wiring
- optional storage-backed position and annotations

Every interaction reads the reader's committed revision through `reader.interactions`;
the controller holds no page geometry of its own. `Reader.spreads` is the navigation
record, `{ index, pageIndexes, leftPageIndex, rightPageIndex? }`, and every revision is
laid out complete, so `totalSpreads` is final and a navigation target beyond it is simply
out of range. The controller maps pointer input to page-local coordinates from the layout
geometry and that record. `createController` requires `reader.interactions.textSelection`
and throws without it.

Deciding a gesture: `controller.hitTestContent({ clientX, clientY })` answers
synchronously whether interactive content sits under a point and which kind —
`'link'`, `'footnote'`, `'image'`, `'annotation'`, or `null` — with no payload and
no side effect. A host that must choose on `pointerup` between a page turn and the
content cannot wait for the content events: only `linkClick` is raised
synchronously, `footnoteClick` waits for the footnote read and `imageClick` for the
image blob. Turning the page first and undoing it does not work either, because the
turn advances the content-interaction generation, which disowns the in-flight image
request and revokes its blob, so `imageClick` never arrives at all. The query reads
the same resolution the click dispatcher runs, in the same priority order
(annotation first, then the page target in reverse paint order), so it predicts the
event a click would raise; a pending footnote therefore reports `'link'`, which is
what the dispatcher does with it. It returns `null` whenever a click would be
dropped, including while a preview disables the reader's interactions.

Text selection: pointer samples are resolved asynchronously against the committed
revision through `interactions.textSelection`, exact rectangles drive the overlay,
selected source text drives copy, and the returned source range anchors annotations.
Use `hasSelection` for presence, `selectionSourceLocator` for the durable source range
(present when both endpoints share a resource), and `selectionSourceSpan` for the
resource-qualified endpoints. Layout revision invalidation, spread changes, render-scale
changes, cancellation, and disposal discard late async results. A content-only resource
repaint, such as an image decode or frame warmup completing, keeps the committed
selection because its revision and source range remain valid. A captured handle or an
active primary mouse/pen/touch drag can continue into an adjacent spread after edge
dwell; the projection handoff is authorized by the exact active gesture and consumed
once, so a released or replacement selection cannot inherit it. The dwell stops at the
first and last spread. A replacement layout or new worker session invalidates the
selection before it is painted.
While the Canvas owns focus, Kit also maps the host platform's Shift-modified
character, word, line, paragraph, and chapter-edge chords onto the native movement
capability. Commands are serialized around one fixed anchor, retain sticky visual-line
x, and reveal an offscreen focus spread without releasing the exact highlight. Disabling
or disposing `controller.keyboard`, blurring the Canvas, newer navigation, or a new
physical selection gesture cancels the queue before a late result can publish.
The initial `pointerdown`, `touchstart`, or valid handle press also owns a private latest-input barrier.
It retires older deferred navigation and portable-position work before coordinate mapping; semantic
mouse restarts and delayed long-press selection inherit that same barrier, while a stable serialized
reading position remains valid. This prevents an older physical press from resuming after newer input.

Annotations: the engine builds and reads every annotation target, so a record stored
here resolves the same way in any other Rito host. `addAnnotation()` reads the selection
synchronously (a host may clear it right after calling) and resolves once
`interactions.createAnnotationTarget` has built the target from the selection's exact
source range; a failed build is reported on the `error` event (source
`'annotation-target'`) and resolves `undefined`. The target is versioned JSON —
`{ version: 1, href, sourceRange, quote: { exact, prefix, suffix }, position: { start,
end, chapterLength } }`, offsets in UTF-16 units over the chapter's raw parsed text —
and is persisted as the engine wrote it.

Re-projection is two engine reads. `interactions.resolveAnnotationTarget` finds the
stored target in the chapter as it is now, trying the source range (checked against
its quote), then the quote with the best-matching context, then the stored offsets,
then the length-scaled position; `ResolvedAnnotation.status` names the level that found
it (`'exact'`, `'quote'`, `'position'`, `'progression'`) or `'orphaned'`. The located
target then goes through `interactions.resolveExactSourceRange` for page-content
rectangles from the committed revision. Locations depend only on the source and
survive relayouts; geometry is cached only for the active revision and invalidated
before a replacement layout is painted. Preview, stale, pending, unavailable, and
failed reads leave no rectangles installed. `ResolvedAnnotationSegment` carries a page
index and page-content `rects`.

Clicks: links, footnotes, and images are the reader's page targets
(`interactions.getPageTargets`), hit-tested in reverse paint order after annotations.
While a visual preview disables the interactions, clicks are dropped rather than tested
against stale geometry.

Search: results come from `reader.search()`; highlight rectangles for the visible spread
are resolved from each result's source range through `interactions.resolveExactSourceRange`.

Accessibility: the optional mirror loads both visible pages' semantics
(`interactions.getPageSemantics`) against the committed revision, rejects late or
mismatched results, stays empty during visual previews, and routes accessible link
activation through page targets instead of raw EPUB-relative browser navigation. An
empty image `alt` is treated as decorative; a missing `alt` remains an image with
unknown alternative text.

Position persistence: Kit stores the visible spread's reading position and
restores it through the asynchronous `goToPosition`
(`Promise<number | undefined>`). Exact source-anchored locators are the design
target, but under the fragment engine durable source-locator projection
currently resolves unavailable (see the limitations page), so persistence and
restore operate on page-indexed positions today. Newer user navigation and
disposal abort an in-flight restore.
Position action promises preserve completion semantics: an awaited `savePosition()`
means the exact position has settled and the adapter write has completed. Storage
adapter `load()` and `save()` callbacks must therefore not call controller position
actions before their own Promise settles. During synchronous action setup, an owned
restore load, or an active adapter write, `savePosition()` explicitly rejects instead
of entering a dependency cycle; adapters must not rely on reentrant restore or
navigation. Outside adapter callbacks, concurrent restores and navigation retain
their normal latest-wins behavior.

Exact source-backed ranges are accepted across logical text flows in document order
within one chapter and require deterministic shapes. Cross-chapter ranges and
host-measured text are typed unavailable rather than given interpolated geometry.

## When Not To Use It

Skip `@ritojs/kit` when:

- you only need the core reader without controller orchestration
- you already have a controller/orchestration layer
- you want a very custom interaction model and only need core primitives

## Related Docs

- [Reader API](../api/reader.md)
- [Public Entry](../api/subpaths.md)
- [Using `@ritojs/react`](./react.md)
