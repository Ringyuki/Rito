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
`hasSelection` and `selectionSourceLocator` instead. Revision invalidation, spread
changes, render-scale changes, cancellation, and disposal discard late async results.
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

The current native projection accepts ranges within one logical text flow and
requires deterministic retained shapes. Cross-paragraph legacy annotations and
host-measured text can therefore remain unavailable until those native capabilities
are expanded.

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
