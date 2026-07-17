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

When the Reader exposes `interactions.textSelection`, Kit treats that capability
as authoritative: pointer samples are resolved asynchronously against the committed
Rust revision, exact rectangles drive the overlay, selected source text drives copy,
and the returned source range anchors annotations. `selectionRange` remains available
for legacy readers but is intentionally `null` for an exact native selection; use
`hasSelection` and `selectionSourceLocator` instead. Layout revision invalidation, spread
changes, render-scale changes, cancellation, and disposal discard late async results. A
content-only resource repaint, such as an image decode or frame warmup completing, keeps
the committed selection because its Rust revision and source range remain valid.
Append-only bounded pagination also preserves the native selection session: Kit
invalidates reads from the older revision, replays only the latest pointer or
handle sample through the atomic caret-to-point API, and can continue a captured
handle or active primary mouse/pen/touch drag into a newly published spread after
edge dwell. The projection handoff is authorized by the exact active gesture and
is consumed once, so a released or replacement selection cannot inherit it. A
replacement layout or new worker session still invalidates the selection before it is painted.
While the Canvas owns focus, Kit also maps the host platform's Shift-modified
character, word, line, paragraph, and chapter-edge chords onto the native movement
capability. Commands are serialized around one fixed anchor, retain sticky visual-line
x, retry append-only pagination (including a complete final miss with no new spread),
and reveal an offscreen focus spread without releasing the exact highlight. Disabling
or disposing `controller.keyboard`, blurring the Canvas, newer navigation, or a new
physical selection gesture cancels the queue before a late result can publish.
The initial `pointerdown`, `touchstart`, or valid handle press also owns a private latest-input barrier.
It retires older deferred navigation and portable-position work before coordinate mapping; semantic
mouse restarts and delayed long-press selection inherit that same barrier, while a stable serialized
reading position remains valid. This prevents an older physical press from resuming after newer input.
Persistent annotation target creation now preserves the exact native source range;
when `interactions.resolveExactSourceRange` is present, Kit also treats it as
authoritative for annotation re-projection. It resolves selector fallbacks to a
durable source range with a canonical manifest resource href first, then obtains
page-content rectangles from the committed Rust revision. Preview, stale, pending,
unavailable, and failed reads never fall back to legacy HitMaps or leave old
rectangles installed. Geometry is cached only for the active revision and invalidated
before a replacement layout is painted. Readers without this capability retain the
legacy synchronous annotation path.
Native `ResolvedAnnotationSegment.range` is intentionally `null`; consumers must
use its exact page-content `rects` and durable selectors instead of assuming a
legacy layout-local `TextRange` exists.

When `interactions.getPageSemantics` is present, the optional accessibility mirror
also becomes native-authoritative. Kit loads both visible pages against the active
committed revision, rejects late or mismatched results, clears the mirror during
visual previews, and routes accessible link activation through native page targets
instead of allowing raw EPUB-relative browser navigation. An empty image `alt` is
treated as decorative; a missing `alt` remains an image with unknown alternative
text. Readers without the capability retain the legacy layout-derived mirror.

When `interactions.getPageReadingAnchor` is present, Kit persists the first
source-resolved locator from the visible spread rather than treating page or
spread indexes as durable identity. Restore and `goToPosition` resolve that
locator against the current Rust revision; legacy archives are upgraded through
their canonical manifest href when possible. `goToPosition` is asynchronous and
returns `Promise<number | undefined>`. When a bounded preview has not paginated
the target, the Reader atomically replaces preview/deferred work with a
locator-owned full revision, commits Rust's selected frame, and verifies the
final exact projection before the Promise settles. Layout callbacks do not
restart that navigation or cause a second jump. Newer user navigation and
disposal abort the old intent, and position storage never falls back to a stale
page index. Readers without the native capability retain the legacy synchronous
projection internally, exposed through the same Promise API.
Position action promises preserve completion semantics: an awaited `savePosition()`
means the exact position has settled and the adapter write has completed. Storage
adapter `load()` and `save()` callbacks must therefore not call controller position
actions before their own Promise settles. During synchronous action setup, an owned
restore load, or an active adapter write, `savePosition()` explicitly rejects instead
of entering a dependency cycle; adapters must not rely on reentrant restore or
navigation. Outside adapter callbacks, concurrent restores and navigation retain
their normal latest-wins behavior.

The current native projection accepts exact source-backed ranges across retained
logical text flows in document order within one chapter and requires deterministic
shapes. Cross-chapter ranges and host-measured text remain typed unavailable rather
than using interpolated geometry.

## When Not To Use It

Skip `@ritojs/kit` when:

- you only need the core reader without controller orchestration
- you are doing source-level diagnostics against the old TypeScript reference implementation
- you already have a controller/orchestration layer
- you want a very custom interaction model and only need core primitives

## Related Docs

- [Reader API](../api/reader.md)
- [Specialized Subpaths](../api/subpaths.md)
- [Using `@ritojs/react`](./react.md)
