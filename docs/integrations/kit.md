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
- `PagePainter`, `PagePaint`

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

The controller draws with WebGL2 on that canvas: the pages it keeps painted are
textures in the canvas's context, painted by `reader.renderSpreadTo` into their
framebuffers, and every frame is drawn on the GPU. Where the browser gives no
WebGL2 — hardware acceleration turned off, a GPU it blocks — `createController`
throws `WebGlUnavailableError`; `canDrawWithWebGl2()` answers ahead of time, so a
host can say so before it opens a book (`useRitoReader` does: its `error` says it
without opening the book). The canvas's drawing buffer is as large as the
screen and only ever grows: a window resized through a new size every frame
would otherwise reallocate it, and wait for the GPU, on every frame. The
canvas shows the buffer's bottom-left corner, as large as the canvas's box at
the screen's ratio, one buffer pixel per device pixel (the controller sets the
canvas's `zoom`, `object-fit` and `object-position` for it); its box keeps the
size the controller gives it. The canvas keeps its drawing buffer, so a host
can read the display back at any time — that corner of it (`drawImage`). A
context the browser takes away is asked back; when it returns, every page is
painted again and the effect prepared again.

The controller keeps the book laid out at the screen's pixel ratio: when the page
zooms or the window goes to another screen, the reader lays the book out again at
the new ratio, as the browser does its own page, so the canvas holds one pixel per
device pixel it is shown on. While it does, the controller sets
`image-rendering: pixelated` on the canvas so the browser shows those pixels as
they are instead of filtering them; while the canvas is stretched — a pinch
magnifying the page, or the moment between a zoom and the pages painted at the
new ratio — it sets `auto` and the browser smooths it, as it smooths the page.

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
    cut the pages such as a curl. `scene.gl` is the display's WebGL2 context, its
    own framebuffer bound and cleared, and the effect draws the frame into it.
    `scene.page(slot)` gives a page as one texture of that context with its
    overlay over it (`{ spread, texture, width, height, pixelRatio, version }`,
    premultiplied, its last row the top of the page as in any framebuffer; `null`
    while it is not painted yet) and `scene.drawPage(slot, x, opacity?)` draws one
    whole. Either may paint the page first, which changes the context's program,
    vertex array, textures and blending; the display's framebuffer is bound again
    after.

  A frame's `dx` and `width`, like the scene's `width` and `height`, are in the
  display canvas's own pixels; `scene.cssPixel` is the length of a CSS pixel in
  them. A frame also says what is moving the turn (`phase`: `'held'` by a finger,
  `'landing'` on the neighbour or `'returning'` to the spread it left), how fast
  `dx` is changing (`velocity`, per second) and the finger that moved it
  (`touch.origin` and `touch.position`, `null` for a turn no finger has held;
  `touch.farthest` is where the finger was when it had carried the turn farthest
  the way the turn goes, so a finger short of it has come back).
  An effect of either kind may have a `prepare(gl)`: it is called with the
  display's context when the effect is set, before any turn, for work that would
  otherwise hold up the first frame of the first turn such as compiling programs;
  it may be called more than once, and again after the context was lost and
  given back. A painted effect may also have a `warm(scene)`: it is called once
  the pages beside the one shown are painted and no turn is under way, for work
  on those pages that a turn would otherwise do in its first frame — the paper
  turn copies them into its own textures then.
  `scene.spine` is where the pages are bound — the left edge when a spread is one
  page, the middle when it is two — and a page's `version` changes whenever its
  texture or overlay is painted again, so an effect can keep a copy of it. A
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
  the finger carried it; `release.touch` is the finger and `release.spine` where
  the pages are bound), and
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
and its shadow, so they agree: mostly the soft light of the room, with a tenth
from a large window over the reader's left shoulder. The shadow on the pages is
sharp where the leaf meets them and soft where it stands high above them, and
where the leaf hides the sky from a page the page dims, little, for the paper
that hides it is lit itself and hands most of that light back. By the
spine the leaf's shade runs on into the page beside it and fades there, as it does
where pages are bound together, instead of stopping at the spine. With two
pages a spread the leaf carries the next page
on its back. With one page a spread the page is peeled back over itself round a
soft roll, its radius about an eighth of the page's width, from its outer edge or from
a corner, its back white and showing its own print through, the wrong way round,
until the line it leaves the page at reaches the
spine; that line never crosses the spine, and stands the more upright the nearer
it comes. Under a finger the edge of the paper turned over is where the finger is,
at the finger's height, wherever on the page the finger came down: for the first
24 CSS px of the finger's way it goes as far as the finger does, so a tap that
slips lifts next to nothing, and once the finger has gone that far the way the
turn goes the edge comes to it in about a tenth of a second and stays under it. A
page brought back by a finger going the other way comes in the same way, until its
edge is under the finger and the page lies flat on the finger's left. A page taken
low on the page lifts by its lower corner, high on the page by its upper one, and
at mid height by its whole edge, and the line leans on as the finger moves up or
down, no more than keeps the paper lifted where the finger is and the corner it is
peeled from beside it. Let go, the page finishes by itself from where it is, and
its turn is over when it is out of the frame or lying flat again. It turns if the
finger had pulled it 24 CSS px or more and had not come back: a finger come back
24 CSS px from its farthest, or a quarter of its farthest pull where that is more,
or going back faster than 500 CSS px a second as it lets go, leaves the page where
it was. Turned by a key or a call the line is upright
and sweeps across in about a quarter of a second, the page leaving the frame while
still on the move. A turn that cuts into another does
not stop its page: turned back, the same page slows, stops and comes back from
where it is; turned on, it carries on by itself while the next lifts, so
several are in the air at once (up to three going by themselves) and none
passes through another; and a finger that takes a leaf in the air holds it by the
point it touched, a curled page where it is. A leaf lying flat is exactly the page's own colours. The effect
hands the GPU its shaders when it is set and does not wait for them: a turn begun
before they are compiled is drawn as the built-in `cover` to its end, so no turn is
held up, and so is every turn where its shaders cannot run. It draws in the
display's own context, taking the pages from their textures, into a frame of its
own that is multisampled below two device pixels to a CSS pixel; at two or more a
leaf's edge is softened where it is drawn instead. It keeps the leaves in the air, so make one per
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

## Drawing On Pages

`paintPage` in `ControllerOptions` draws over each page as part of it: a page
number, a running head. The controller calls it whenever it paints a page, right
after the engine, on the page's own picture, so what it draws moves with the page
in every turn, a paper turn's leaf included, and lies under highlights and the
selection. Its `context` is clipped to the page, with its origin at the page's
top-left corner, in the layout's CSS pixels (the device pixel ratio and
`renderScale` already applied), and is restored afterwards. `page` gives
`pageIndex` in the committed layout, `side`, `width`, `height` and `margins`, and
`bookPageIndex` and `bookPageCount`: the page's number in the whole book and the
book's page count. Both are `null` while only the chapter being read is laid out,
when page indexes count from that chapter; hide page numbering then. The book's
layout paints every page again with both.

```ts
const controller = createController(reader, canvas, {
  paintPage(context, page) {
    if (page.bookPageIndex === null) return;
    context.font = '12px serif';
    context.textAlign = 'center';
    context.fillText(
      `${page.bookPageIndex + 1} / ${page.bookPageCount}`,
      page.width / 2,
      page.height - page.margins.bottom / 2,
    );
  },
});
```

The pages on either side of the one on screen are painted ahead of a turn, so a
painter draws from `page`, not from where the reader is. When what it draws changes
on its own (the host's colours, a setting), `controller.repaintPages()` paints
every page again. A painter that throws leaves the page as the engine painted it
and is reported on the `error` event (source `'page-painter'`); it never holds a
page or a turn back. In a paper turn a lifted leaf is seen nearer and larger, so
what is drawn at a page's very edge, such as a number low in the bottom margin, can
pass the canvas's edge while the leaf is up.

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
first and last spread. A newly committed layout — the book following the chapter, a
resize, a typography or render-scale change — invalidates the selection before it is
painted and then shows it again, as a browser keeps a selection through a resize: its
source range is resolved in the new layout and shown when it lands on the spread on
screen, no later layout or turn came first, and no other selection was started. While a
selection is being made, the book's layout waits for it to be made.
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
and is persisted as the engine wrote it. `insertAnnotation(record)` stores a whole
record as given (its id, colour, note and timestamps), to undo a removal or an edit:
it replaces the stored record with that id where it stands, and otherwise goes in
creation order, which is the order annotations are painted in, so a removed record
put back lies under and over the same neighbours. It is persisted like any change and
returns `false` once the controller is disposed.

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
rather than tested against stale geometry. `annotationClick` carries `screenBounds`, the
box around the annotation's rectangles on the clicked page, in the screen coordinates
of `imageClick.screenBounds`; its `x`, `y` is that box's top centre. A popover can sit
above or below the box without covering the highlight.

Focus: the controller makes the Canvas focusable (`tabindex="0"`) so it receives keys,
and sets its inline `outline-style` to `none`, since the browser's focus ring would
outline the whole reading surface after a key press. Disposal gives the Canvas back the
`tabindex` and `outline-style` it had. A host that wants a ring sets the Canvas's
inline `outline` after `createController`.

Search: `controller.search(query, { caseSensitive, wholeWord })` matches case or whole
words only when asked (both off by default) and keeps the options when the book is
searched again after a relayout. Results come from `reader.search()`; highlight rectangles for the visible spread
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
