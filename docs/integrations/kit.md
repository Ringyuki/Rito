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
import { createController, springPresets } from '@ritojs/kit';

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
  transition: { ...springPresets.default, effect: 'slide' },
});

controller.mount(container);
controller.goToSpread(0);
```

`mount()` puts the display canvas given to `createController` into the container,
and with `a11y` enabled the accessibility mirror with it. Turns and overlays are
composited into that one canvas; pointer and touch listeners sit on the canvas from
`createController` on, and keyboard shortcuts listen on the document element.

## Page Turns

A turn is physics plus an effect. The physics say how it moves — the drag, the
decision to turn, the way to rest and the pull at the first and last spread — and
the effect what a frame shows. The built-in physics are a spring: a release hands
the finger's momentum to it, it is solved in closed form, so a turn follows the
same path at any refresh rate, and the presets never bounce: past the neighbour,
or back past the starting page, there may be no page to show. A custom spring
damped below critical (`damping < 2√stiffness`) bounces, and shows that gap.

- `effect`: `'slide'` (the spread moves, the neighbour follows), `'cover'` (later
  pages slide over earlier ones with a shadow), `'fade'` (cross-fade in place) or
  `'none'` (a turn lands at once), or a custom `TransitionEffect` of either kind:
  - layered — `layers({ dx, width, incoming })` returns whole pages to draw bottom
    to top (`{ slot, x, opacity?, shadow? }`). A `shadow` is cast from that edge of
    the sheet onto the page beneath it: it reaches 24 CSS px and fades as the sheet
    leaves the frame, so it is gone when the sheet is;
  - painted — `paint(scene, frame)` draws the frame itself, for looks that bend or
    cut the pages such as a curl. `scene.context` is the cleared display canvas,
    `scene.page(slot)` gives a page's bitmap and overlay (`{ spread, content, overlay,
pixelRatio }`, or `null` while it is not painted yet) and
    `scene.drawPage(slot, x, opacity?)` draws one whole.

  A frame's `dx` and `width`, like the scene's `width` and `height`, are in the
  display canvas's own pixels; `scene.cssPixel` is the length of a CSS pixel in
  them. A frame also says what is moving the turn (`phase`: `'held'` by a finger,
  `'landing'` on the neighbour or `'returning'` to the spread it left), how fast
  `dx` is changing (`velocity`, per second) and the finger that moved it
  (`touch.origin` and `touch.position`, `null` for a turn no finger has held).
  An effect of either kind may have a `prepare()`: it is called when the effect is
  set, before any turn, for work that would otherwise hold up the first frame of
  the first turn, and may be called more than once.
  `scene.spine` is where the pages are bound — the left edge when a spread is one
  page, the middle when it is two — and a page's `version` changes whenever its
  bitmap or overlay is painted again, so an effect can keep a texture of it. A
  page's `spread` is which spread of the book it is: what tells it from every
  other from one turn to the next.

- `springPresets.default | snappy | gentle` (or your own `stiffness` / `damping`).
- `physics`: your own rules in place of the built-in ones, each part optional.
  `travel(touch, bounds)` says how far a finger has carried the turn (CSS px, one
  viewport width for a whole turn; the way a drag first moves is the way it
  turns), `resist(travel, width)` where a pull against the first or last spread
  leaves the page, `lands(release)` whether letting go turns the page
  (`release.from` is where the turn was when the finger took it, 0 unless it began
  from what a turn in flight had left, so `release.dx - release.from` is how far
  the finger carried it), and
  `settle(from, velocity, to)` returns the motion that carries a released turn to
  rest: a function of the seconds since, answering `{ x, velocity, done }`. A turn
  left alone stays on screen until it is `done`. `begins(leftover)` says where a
  turn that cuts into another begins and how fast, told where the picture is
  (`dx`), its `velocity`, and whether the two turns are between the same two
  spreads (`sameSpreads`); left out, the turn begins where the picture is and as
  fast, so nothing jumps, and physics that answer otherwise leave what was left of
  the other turn to their effect. An effect may bring the physics it is made for
  as its own `physics`; the option outranks them.
- `respectReducedMotion` (default `true`): while the system asks for reduced motion,
  turns cross-fade whatever the effect.

Change any of it live with `controller.configureTransition({ effect: 'cover' })`.

`createPaperTurn()` is a painted effect with physics of its own: the page turns as
paper does. With two pages a spread it is a leaf of a book. The leaf stays bound at
the spine, bends round a cone as it lifts — arched in the air, the corner it is
taken by leading — swings over the spine, and comes down on the far side edge
first, the arch settling after. Paper bends without stretching, and the leaf is
never folded. Under a finger the point taken hold of stays under it; turned by a
key or a call the leaf is off at once and lands softly in about 0.4 s on a wide
spread, less on a narrow one. With one page a spread the page is curled over on
itself instead: see below. Either way it is drawn with WebGL in
three dimensions, seen from above the spread. One light serves the leaf's shading
and its shadow, so they agree: a soft lamp over the reader's left shoulder and the
light of the room. The shadow on the pages is sharp where the leaf meets them and
soft where it stands high above them, and where the leaf hides the sky from a page
the page dims, less than it would if white paper did not hand light back. By the
spine the leaf's shade runs on into the page beside it and fades there, as it does
where pages are bound together, instead of stopping at the spine. With two
pages a spread the leaf carries the next page
on its back. With one page a spread the page is peeled back over itself round a
small roll, from its outer edge or from a corner, its back showing its own print
faintly and the wrong way round, until the line it leaves the page at reaches the
spine; that line never crosses the spine, and stands the more upright the nearer
it comes. The lifted edge goes as far as the finger does, keeping the distance from
it that it had when the finger came down, so a page taken at its edge has its edge
under the finger; a page taken low on the page lifts by its lower corner, high on
the page by its upper one, and at mid height by its whole edge, and the line leans
on as the finger moves up or down. Turned by a key or a call the line is upright
and sweeps across in about a quarter of a second, the page leaving the frame while
still on the move. A turn that cuts into another does
not stop its page: turned back, the same page slows, stops and comes back from
where it is; turned on, it carries on by itself while the next lifts, so
several are in the air at once (up to three going by themselves) and none
passes through another; and a finger that takes a leaf in the air holds it by the
point it touched, a curled page where it is. A leaf lying flat is exactly the page's own colours. The effect
hands the GPU its shaders when it is set and does not wait for them: a turn begun
before they are compiled is drawn as the built-in `cover` to its end, so no turn is
held up, and so is every turn where WebGL is not to be had. At two device pixels or
more to a CSS pixel the canvas is not multisampled and a leaf's edge is softened
where it is drawn instead. It keeps the leaves in the air, so make one per
controller:

```ts
import { createPaperTurn } from '@ritojs/kit';

controller.configureTransition({ effect: createPaperTurn() });
```

`transitionStart` and `transitionEnd` bracket every visible turn: each start is
answered by exactly one end, whose `outcome` says whether the turn landed
(`committed`), went back (`cancelled`), or was cut off by a relayout or a jump
(`interrupted`). A newer turn, by key or by a finger that starts to drag, settles the
turn in flight at once, which reports `committed`, or `cancelled` if it was already
heading back; its picture is not stopped: the newer turn begins where the page is and
as fast as it moves, so a second turn, a turn back and a finger all take the page on
without a jump. A finger that only comes down on a moving page leaves it alone.
`rito_flutter` reports
the same outcomes; one table of scenarios holds both test suites to them. In between, `transitionProgress` reports every painted
frame with `progress` from 0 at rest to 1 on arrival, for chrome that follows the
page. In React, `useReaderTransition(controller)` gives `{ isTransitioning,
direction }` and `useReaderTransitionProgress(controller)` the progress.

## Responsibilities

`@ritojs/kit` adds the app-facing interaction layer on top of core rendering:

- display-surface management
- buffer pool and overlay composition
- transition driver and frame scheduling
- selection/search/annotation/position engines
- pointer/touch/keyboard wiring
- optional storage-backed position and annotations

Every interaction reads the reader's committed layout through `reader.interactions`;
the controller holds no page geometry of its own. `Reader.spreads` is the navigation
record, `{ index, pageIndexes, leftPageIndex, rightPageIndex? }`. The reader commits a
layout twice — the chapter being read, then the whole book (`Reader.layoutScope`) — and
the controller speaks book-wide throughout: while the chapter is the committed layout,
page numbers and progress keep their last book-wide values, a turn by key or API
past the chapter's edge and a jump outside it wait for the book and land there, a drag
past that edge rubber-bands as at the end of the book, and a turn inside the chapter
is immediate. The controller maps pointer input to page-local coordinates from
the layout geometry and that record. `createController` requires `reader.interactions.textSelection`
and throws without it.

Deciding a gesture: `controller.hitTestContent({ clientX, clientY })` answers
synchronously whether interactive content sits under a point and which kind —
`'link'`, `'footnote'`, `'image'`, `'annotation'`, or `null` — with no payload and
no side effect. A host that must choose on `pointerup` between a page turn and the
content cannot wait for the content events: `linkClick` and `annotationClick` are
raised synchronously, but `footnoteClick` waits for the footnote read and `imageClick`
for the image blob. Turning the page first and undoing it does not work either, because the
turn advances the content-interaction generation, which disowns the in-flight image
request and revokes its blob, so `imageClick` never arrives at all. The query reads
the same resolution the click dispatcher runs, in the same priority order
(annotation first, then the page target in reverse paint order), so it predicts the
event a click would raise; a pending footnote therefore reports `'link'`, which is
what the dispatcher does with it. It returns `null` whenever a click would be
dropped.

Text selection: pointer samples are resolved asynchronously against the committed
revision through `interactions.textSelection`, exact rectangles drive the overlay,
selected source text drives copy, and the returned source range anchors annotations.
Use `hasSelection` for presence, `selectionSourceLocator` for the durable source range
(present when both endpoints share a resource), and `selectionSourceSpan` for the
resource-qualified endpoints. Layout revision invalidation, spread changes, render-scale
changes, cancellation, and disposal discard late async results. A content-only resource
repaint, such as an image decode or frame warmup completing, keeps the committed
selection because its layout and source range remain valid. A captured handle or an
active primary mouse/pen/touch drag can continue into an adjacent spread after edge
dwell; the projection handoff is authorized by the exact active gesture and consumed
once, so a released or replacement selection cannot inherit it. The dwell stops at the
first and last spread. A newly committed layout — the book following the chapter
included — invalidates the selection before it is painted.
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
before a replacement layout is painted. Stale, pending, unavailable, and
failed reads leave no rectangles installed. `ResolvedAnnotationSegment` carries a page
index and page-content `rects`.

Clicks: links, footnotes, and images are the reader's page targets
(`interactions.getPageTargets`), hit-tested in reverse paint order after annotations.
A click whose targets were read from a layout that is no longer committed is dropped
rather than tested against stale geometry.

Search: results come from `reader.search()`; highlight rectangles for the visible spread
are resolved from each result's source range through `interactions.resolveExactSourceRange`.

Accessibility: the optional mirror loads both visible pages' semantics
(`interactions.getPageSemantics`) against the committed layout, rejects late or
mismatched results, fills the mirror once the reader is at rest on the spread —
after the frame that shows it, and after a turn onto it has ended, so laying out
the mirror never holds a page back — and routes accessible link
activation through page targets instead of raw EPUB-relative browser navigation. An
empty image `alt` is treated as decorative; a missing `alt` remains an image with
unknown alternative text.

Position persistence: Kit publishes the visible spread's reading position as the
engine's source locator for its first page (`sourceLocator`: the chapter's href and a
position in its source), with the page and spread it falls on in the committed layout
(`projection`) and `progress`. A stored position comes back through the asynchronous
`restorePosition()`, which loads from `positionStorage` when no serialized value is
passed; `goToPosition(position)` goes to a position the host holds. Both resolve
`Promise<number | undefined>`: they navigate the reader to the locator, so a position
survives a relayout, and resolve `undefined` when the locator does not resolve. A
position that carries no locator is placed by its stored `projection` instead. Newer user
navigation and disposal abort an in-flight restore. `controller.position` is the position last
published by `positionChange`; it resolves a beat after the spread it describes, so
UI showing where the reader is (a chapter, a page number, a percentage) should read
all of it from the position rather than mix it with `spreadChange`.
Position action promises preserve completion semantics: an awaited `savePosition()`
means the exact position has settled and the adapter write has completed. Storage
adapter `load()` and `save()` callbacks must therefore not call controller position
actions before their own Promise settles. During synchronous action setup, an owned
restore load, or an active adapter write, `savePosition()` explicitly rejects instead
of entering a dependency cycle; adapters must not rely on reentrant restore or
navigation. Outside adapter callbacks, concurrent restores and navigation retain
their normal latest-wins behavior.

Exact source-backed ranges are accepted across logical text flows in document order.
A selection that crosses chapters carries `sourceSpan`, each end with its own href,
and no single-chapter `sourceLocator`; `resolveExactSourceRange` takes one chapter's
`href` and range.

## When Not To Use It

Skip `@ritojs/kit` when:

- you only need the core reader without controller orchestration
- you already have a controller/orchestration layer
- you want a very custom interaction model and only need core primitives

## Related Docs

- [Reader API](../api/reader.md)
- [Public Entry](../api/subpaths.md)
- [Using `@ritojs/react`](./react.md)
