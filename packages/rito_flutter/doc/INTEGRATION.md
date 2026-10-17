# rito_flutter integration reference

The stable host-facing API for embedding Rito's reader in a Flutter
application. Layout, pagination, and navigation run in the Rust core;
this package decodes its typed wire contracts and paints display lists
with a Canvas pen that is pixel-calibrated against the browser pen
(see [Fidelity contract](#fidelity-contract)).

## Libraries

| import                                            | purpose                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `package:rito_flutter/rito_flutter.dart`          | Everything a host app needs: gateway, session, page surface, font/image caches, request models.                                        |
| `package:rito_flutter/rito_flutter_protocol.dart` | Typed decoders and models for every wire contract (`RITOART1`, `RITODL1`, `RITONAV1`, …). Only needed for tooling or custom pipelines. |
| `package:rito_flutter/rito_flutter_native.dart`   | `RitoNativeBindings`, the blocking low-level ABI projection for custom embedders. Normal apps use the isolate gateway instead.         |

## Quick start

```dart
import 'package:rito_flutter/rito_flutter.dart';

final gateway = RitoIsolateGateway();
final session = await RitoReaderSession.open(
  gateway: gateway,
  publicationBytes: epubBytes,
  request: RitoArtifactRequest(
    sessionId: 1,
    requestId: 1,
    layout: const RitoLayoutRequest(
      viewportWidth: 390,
      viewportHeight: 720,
      marginTop: 24, marginRight: 20, marginBottom: 24, marginLeft: 20,
      spreadMode: RitoSpreadMode.single,
      firstPageAlone: false,
      spreadGap: 0,
      rootFontSize: 16,
    ),
    locator: const RitoLocator(href: 'chapter1.xhtml', progression: 0),
  ),
  // Required: the open fails without host faces. See Fonts.
  pinnedFontPolicy: RitoPinnedFontPolicy(faces: [
    RitoPinnedFontFace(
      bytes: serifBytes, // app asset, TTF/OTF
      genericRole: RitoPinnedFontGenericRole.serif,
    ),
  ]),
  imageCache: RitoArtifactImageCache(),
  imagePixelRatio: MediaQuery.devicePixelRatioOf(context),
);

// Paint the visible page.
Widget page = RitoPageSurface(artifact: session.firstArtifact);

// Turn the page.
final next = await session.turn(
  from: session.firstArtifact,
  requestId: session.nextRequestId,
  direction: RitoAdjacentDirection.next,
);

// Release the old page once the turn animation finishes.
await session.releaseArtifact(session.firstArtifact);

// Shutdown.
await session.dispose();
await gateway.close();
```

## Session lifecycle (`RitoReaderSession`)

`session.firstArtifact` and the results of `turn`, `peek`,
`requestArtifact`, and `requestAdjacent` are only ever
`RitoPreparedArtifact` — an artifact whose declared fonts are
registered before the future completes. `RitoPageSurface` cannot accept
anything else, so a page whose fonts are not ready can never reach the
screen. Images do not hold a page back: with an image cache configured
their reads and decodes start with the artifact and each joins it as it
lands, the surface repainting when it does. An image still on its way
after a second paints the engine's loading placeholder and fades in over
it; one that failed paints the broken placeholder.

| member                                                                                                                         | contract                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open(gateway:, publicationBytes:, request:, pinnedFontPolicy:, fontCache:, imageCache:, imagePixelRatio:, resourcePreparer:)` | Opens the publication and prepares the first artifact. `pinnedFontPolicy` is required in practice: an open without host faces fails. `imagePixelRatio` is the device-pixel ratio pages are resolved at when a layout names no `renderRatio`; pass the device pixel ratio. Images are decoded for the size the page draws them at on that grid.                   |
| `peek(from:, requestId:, direction:)`                                                                                          | Read-only neighbor fetch: returns the adjacent page as a prepared artifact **without changing the visible state**. A neighbor in another chapter is paginated on demand; null only at the book's terminal boundary (UI falls back to fade-in). The artifact counts against the live budget and must be released.                                                 |
| `turn(from:, requestId:, direction:)`                                                                                          | Adjacent-page navigation: a pure visible-artifact swap when the neighbour was peeked from `from` (below), otherwise the fixed 48-byte `RITONAV1` request. Never re-runs locator seek or layout.                                                                                                                                                                  |
| `requestArtifact(request)`                                                                                                     | Explicit seek or reflow (viewport change, font-size change, locator jump).                                                                                                                                                                                                                                                                                       |
| `readPublication()`                                                                                                            | Typed publication metadata (spine, TOC).                                                                                                                                                                                                                                                                                                                         |
| `page.hits[].bounds`, `page.semantics[].bounds`                                                                                | Rects in the artifact's **display-list space** — the coordinates `displayList` paints in, spread page offset and page margins included. Hit-test pointer positions on the painted surface directly; do not subtract margins.                                                                                                                                     |
| `advanceBackground(...).movesVisibleContent`                                                                                   | Whether adopting the candidate would put different content on screen. False is the ordinary handoff — the same page renumbered onto the whole-book layout, invisible to the reader. True means pagination resolved the reading position onto another page; adopt it and the reader moves, so release the candidate instead if the page must not move unprompted. |
| _artifact liveness_                                                                                                            | `search` / `textRangeGeometry` / `readFootnote` / `readResource` raise `RitoArtifactNotLiveException` when an artifact of this session was superseded (background adoption is the usual cause) — catch it and reissue against the current artifact. An artifact from another session stays an `ArgumentError`; retrying that loops forever.                      |
| `search(prepared, query, {caseSensitive, wholeWord, limit})`                                                                   | In-book search. Scope follows the artifact's revision: chapter-local before background handoff, whole book after. Hits carry a context snippet, page-text positions for `textRangeGeometry`, and a durable `locator` — store that, not the page index. `truncated` reports a `limit` cutoff; `searchedPageCount` reports how many pages the list came from.      |
| `textRangeGeometry(prepared, pageIndex:, start:, end:)`                                                                        | Rects for a text range on a published page, in the artifact's display-list space. Anchor highlights to source text (`page.textRuns` positions) instead of remembered pixels. Page text and run offsets already ship on every `page` — no extra call needed for those.                                                                                            |
| `readFootnote(prepared, key)`                                                                                                  | Footnote definition (`kind`, `text`, `html`) for a hit's `footnoteKey`. Pass the key verbatim — it is already canonical, so never normalize the link href yourself. Throws `RitoNativeException(status: 6)` while the definition is still being indexed (`hit.footnotePending`), so a popup can show a loading state and retry.                                  |
| `readResource(prepared, ref)`                                                                                                  | Ownership-checked bytes of a resource the artifact declares in `resources` (its images and fonts); any other reference is an `ArgumentError`.                                                                                                                                                                                                                    |
| `advanceBackground(...)` / `adoptBackground(...)`                                                                              | Host-scheduled background pagination; candidates never become visible implicitly.                                                                                                                                                                                                                                                                                |
| `releaseArtifact(prepared)`                                                                                                    | Frees a replaced artifact. Releasing the currently visible artifact is rejected — keep both alive through a page-turn animation.                                                                                                                                                                                                                                 |
| `dispose()`                                                                                                                    | Ends the session. Dispose the session before `gateway.close()`.                                                                                                                                                                                                                                                                                                  |
| `nextRequestId`                                                                                                                | Always allocate request IDs here. A peek consumes one, the continuations of an unpublished adjacent turn consume several internally, and an open or seek may be sent under a newer ID than the one passed, so one public call may burn several.                                                                                                                  |
| `visibleArtifactId`                                                                                                            | The committed visible artifact.                                                                                                                                                                                                                                                                                                                                  |

Peek → turn fast path: when the page being turned to was already
peeked from the current page, `turn` commits the peeked artifact with a
pure visible-artifact swap — zero layout, no new artifact — and returns
the same prepared instance. Gesture layers can therefore peek on touch
down, drive the page-turn animation with both surfaces, and commit (or
simply abandon the peek and release it) on gesture end; no optimistic
pre-turn or reverse-turn bookkeeping is needed. The live-artifact
budget is sized for this window: visible + outgoing + one peek per
direction + an in-flight candidate, with one slot of slack.

Navigation supersession: a newer `turn`/`requestArtifact` cancels an
in-flight one with `RitoNavigationSupersededException`. An exact open
or seek is never silently replaced by a page-one artifact: its chapter
is paginated whole in one native call, so the result is the exact
artifact or a terminal error. An unpublished adjacent turn resumes one
bounded native quantum per host turn until ready, terminal, or
superseded.

## Reader controller (`RitoReaderController`)

The session is the transport; most apps want one owner for the page on
screen. `RitoReaderController(session, layout: layout)` is that owner:

- `page` is the visible page; listeners hear every replacement and
  `lastChange` says why (`turn`, `jump`, `relayout`, `pagination`).
- `turn(direction)`, `jumpTo(locator)` and `relayout(layout)` replace it and
  release the page they replaced. A `jumpTo` / `relayout` superseded by a
  later one before it ran returns null.
- `neighbour(direction)` peeks the adjacent page once per page and keeps
  it; a turn that way lands on it with no further layout, and the
  controller releases it when the page changes. `canTurn(direction)`
  answers from the page itself, synchronously.
- Background pagination runs by itself and adopts the renumbered page
  (never one that would move the reader); `holdPagination()` pauses it.
  `paginationComplete` turns true when it stops: the whole book is laid
  out, or a step failed — the failure is reported through
  `FlutterError.reportError` and the book stays readable chapter by
  chapter. A `jumpTo` or `relayout` starts it again.
- All session work runs one operation at a time; `withPage(action)` runs
  host reads (resources, footnotes, geometry) in that order with the page
  guaranteed live.

Dispose the controller, then the session.

## Page turns

Three layers, each usable on its own:

1. `RitoReaderController` — the pages (above).
2. `RitoPageTurnController(reader:, vsync:)` — the turn: feed it a drag
   (`dragStart(position)` / `dragUpdate(position)` / `dragEnd(velocity)` /
   `dragCancel`, positions in the view's coordinates and the velocity in
   logical px/s) or call `turn(direction)` for taps and keys. It moves
   with the web reader's physics (`RitoPageTurnPhysics`, with the springs
   `RitoSpring.standard`, `snappy` and `gentle`): a release hands its
   velocity to the spring, a turn follows the same path at any refresh
   rate (the spring is solved in closed form) and, with these three
   springs, never bounces past the neighbour — a custom spring damped
   below critical does; a pull against the first or last page stretches.
   A turn commits on the reader the moment it is decided, so the page is
   ready on arrival. A tap, a turn back or a finger that arrives during a
   turn cuts into it: that turn ends once the reader has landed it,
   wherever its picture is, and the next begins where the page is and as
   fast as it moves, so nothing jumps (`RitoPageTurnPhysics.begins` says
   otherwise for physics of your own; a release is judged by how far the
   finger carried the turn, `RitoPageTurnRelease.from` being where it took
   it). `isMoving` is true while a turn or what is left of one is on
   screen. A jump or relayout mid-turn ends it. `events` brings one
   `RitoPageTurnStarted` and exactly one `RitoPageTurnEnded` (`committed`,
   `cancelled`, `interrupted`) per turn; `frame.progress` follows the page
   every frame. While no turn is on screen it lays out both neighbours
   and, once nothing moves, rasterizes them and the page on screen
   between frames (`prewarm`, on by default; three page images stay in
   memory at rest), so a turn starts with nothing to draw; a neighbour
   that arrives during a turn fades in. `jumpTo(locator, animateAs:)` plays a
   jump as a turn.
3. `RitoPageTurnView(controller:, child:)` — shows `child` (the live page)
   at rest and paints the effect during a turn. It reads horizontal drags
   itself (`dragToTurn`, on by default); pass `dragToTurn: false` to
   arbitrate gestures yourself and feed the controller's drag methods.
   It follows the platform's reduced-motion setting (turns cross-fade,
   unless the controller was built with `respectReducedMotion: false`)
   and pixel ratio.

Effects: `RitoPageTurnEffects.slide | cover | fade | none`, a
`RitoLayeredPageTurnEffect` returning whole pages per frame, or any
`RitoPageTurnEffect` painting the frame itself — `paint(scene, frame)`
gets the canvas, the page images (`scene.pages.image(slot)` at
`pixelRatio`, `reveal(slot)` for a late page's fade-in) and the paper
colour, which is how a curl is built. `scene.pages.spread(slot)` says
which spread of the book a slot shows, as `TransitionPage.spread` does on
the web: the next page's is one more than the current page's, a page
keeps it from one turn to the next, and a jump or relayout numbers its
page apart from every page before it — what an effect keys what it keeps
of a page by. It orders pages; it is not a page number. A frame says how far the turn has
gone (`offset`, `progress`), which neighbour is coming in, what is moving
it (`phase`: `held` by a finger, `landing` on the neighbour or
`returning` to the page it left), how fast (`velocity`) and the finger
that moved it (`touch.origin` and `touch.position`, null for a turn no
finger has held; `touch.farthest` is where the finger was when it had
carried the turn farthest the way the turn goes, so a finger short of it
has come back). An effect that moves on a clock of its own returns a
`Listenable` as `repaint`, and the view paints the turn again whenever it
notifies. Page textures are drawn by `paintPage` (default
`ritoPaintArtifactPage`); draw highlights or a theme there and call
`invalidatePages()` when they change. A page whose images land late is
rasterized again.

Physics: extend `RitoPageTurnPhysics` to move a turn another way.
`travel(origin, position)` says how far a finger has carried the turn — a
whole turn is one page width, and the way a drag first moves is the way
its page turns; `resist(travel, width)` says where a pull against the
first or last page leaves it; `lands(release)` decides whether letting go
turns the page; and `settle(from:, velocity:, to:)` returns the
`Simulation` that carries a released or tapped turn to rest. A turn left
alone stays on screen until that simulation is done.

## Rendering (`RitoPageSurface`)

```dart
RitoPageSurface(
  artifact: prepared,          // RitoPreparedArtifact
  resolveImage: (href) => ..., // optional ui.Image? Function(String)
)
```

- The surface sizes itself to `artifact.artifact.width/height` (layout
  viewport units) and repaints when the artifact identity or the
  `colorOverride` changes, and whenever one of the artifact's images
  lands, fades in or shows its placeholder.
- Images: if the session was opened with a `RitoArtifactImageCache`,
  the prepared artifact carries an image lease and no `resolveImage`
  callback is needed. Otherwise supply one; hrefs arrive exactly as the
  artifact declares them (relative paths, original case). Return `null`
  to skip an image. The painter performs no I/O and no decoding.
- The painter throws before painting anything on a text profile other
  than `platformStringRuns` (`UnsupportedError`), and stops at a
  malformed primitive stream (`RitoWireException`, `FormatException`).
  It refuses no CSS feature itself: what a page paints is decided by the
  engine, which lowers the bevel border styles (`groove`, `ridge`,
  `inset`, `outset`) to fills and leaves inset box shadows out.

## Themes (dark / sepia)

Pass a `colorOverride` to the page surface:

```dart
RitoPageSurface(
  artifact: prepared,
  colorOverride: const RitoCanvasColorOverride(
    foreground: Color(0xffe5e5e5),
    background: Color(0xff1a1a1a),
  ),
)
```

The override makes the same decisions as the browser reader's (parity
fixtures `theme-override-dark`, `theme-designed-page`,
`theme-white-page-inline-band`); the theme only takes over where the
book expressed no choice of its own:

- The theme background replaces the page ground, unless the book
  designed one — an opaque ground with relative luminance below 0.75
  stays the book's.
- Text over a ground the book declared — its own inline band, an opaque
  block fill around it, or a page ground the book kept — keeps its
  colour.
- Text over the theme background keeps its colour while it stays
  WCAG-readable (4.5:1) against it. Otherwise achromatic ink becomes
  the theme foreground exactly, and coloured ink keeps its hue and
  saturation and takes the theme foreground's lightness (falling back to
  the theme foreground if that is still unreadable).
- Decorations, shadows, block grounds, and images stay as authored.

Omit the override for light mode — the authored page paints unmodified.
`RitoPageTurnView` textures are drawn by the turn controller's
`paintPage`, whose default applies no override; pass one that does.

## Fonts

- **Pinned font policy (required).** Pass `pinnedFontPolicy` to
  `RitoReaderSession.open` with the app's bundled faces:

  ```dart
  pinnedFontPolicy: RitoPinnedFontPolicy(faces: [
    RitoPinnedFontFace(
      bytes: serifBytes, // app asset, TTF/OTF
      genericRole: RitoPinnedFontGenericRole.serif,
      language: 'ja',    // optional BCP47 selector
    ),
  ]),
  ```

  Layout shapes text with real face bytes — the pinned faces plus the
  publication's own embedded faces — and every artifact declares the
  faces its page paints with in `artifact.fonts`, which the font cache
  then registers automatically. **Without a policy the open fails**: the
  engine has no face to lay text out with and does not guess. SHA-256
  digests are computed automatically; variable fonts are rejected by the
  core.

  The session also registers each pinned face with `FontLoader` under
  its engine alias (`__RitoPinned_<sha256>`) before the first paint.
  Every painted run names the alias of the face that shaped it, so
  paint resolves to the same bytes layout measured with, and the app
  does **not** need to declare these faces in `pubspec.yaml`. The
  painter splits the run's comma-joined family stack into `fontFamily`
  and `fontFamilyFallback`, and the publication's faces, registered
  from `artifact.fonts` under their own aliases, resolve the same way.

- Fonts are prepared by `RitoArtifactFontCache.shared` by default:
  read through the artifact's native ownership, length-checked,
  registered with `FontLoader`, deduplicated process-wide by family +
  shape fingerprint. Failed loads are evicted for retry.
- **Font envelopes** (`RitoFontEnvelopeStore.shared`) are filled
  automatically from the same bytes. The engine places every baseline
  itself, so the pen anchors nothing by them; it reads one thing, the
  weight a face was declared with, so that a bold run does not embolden
  a face the book already ships as its bold. Nothing to do in the
  default path.
- WOFF and WOFF2 are not decoded. The engine shapes with TTF/OTF bytes
  only, so text set in a WOFF publication face is laid out and painted
  with the next face its family list resolves to, and no artifact
  declares the face. The default registrar (Flutter's `FontLoader`,
  OTF/TTF only) rejects WOFF bytes as well; a host can supply its own
  `RitoFontRegistrar` through `RitoArtifactFontCache(registrar:)`.
- A publication face this host cannot load can be taken out of layout
  with `session.markFontFamiliesUnavailable([font.family])`: the next
  request lays out without it, so text is never measured with one face
  and painted with another.

## Request models

- `RitoLayoutRequest`: viewport, margins, `spreadMode`
  (`single`/`double`), `firstPageAlone`, `spreadGap`, `rootFontSize`,
  optional `lineHeightOverride` / `fontFamilyOverride` (each outranks
  the book's own declarations unless `lineHeightForce` /
  `fontFamilyForce` is false) and optional `renderRatio` (device pixels
  per CSS pixel; the session's `imagePixelRatio` when null). Any change
  requires a new `requestArtifact` or the controller's `relayout`.
- `RitoLocator`: where to open — a required spine `href` plus an
  optional `anchorId`, `sourcePoint`, `sourceRange`, or `progression`.
  The artifact reports which match kind was honored
  (`RitoLocatorMatch`).
- `RitoTextProfile.platformStringRuns` is the only profile the painter
  accepts in v1.

## Threading and native assets

- `RitoIsolateGateway` runs all native work (parse, layout, seek,
  turn) on a persistent worker isolate; every public future completes
  on the calling isolate. The UI isolate only registers fonts and
  replays display lists.
- Native Assets builds `rito-ffi` automatically (Flutter ≥ 3.41.7,
  pinned Rust toolchain). Tests and diagnostics may bypass with
  `RitoIsolateGateway(diagnosticLibrary: ...)`.

## Fidelity contract

The engine resolves every page into device-pixel primitives, and the
Flutter pen blits the same bytes the browser pen does: border bands and
dash cadences, radii, box shadows, background sizing and tiling, inline
boxes, decoration lines and the cluster origins of every text run are
decided in the engine, not in either pen. The two pens are held
together by a pixel-diff instrument (`tools/paint-parity/run.mjs` at
the repo root) that fails when a fixture exceeds its budget. What the
pens still decide is confined to text rasterization, shadow blur,
typed-colour conversion to sRGB and the theme override; the remaining
divergence is rasterizer-level (glyph and edge anti-aliasing, blur
kernels, image interpolation rounding), itemized in
`tools/paint-parity/EXEMPTIONS.md`. When touching
`lib/src/render/**`, re-run the instrument; a fixture climbing the
report is a regression.

Known open semantics:

- A text run carries its string and its cluster origins, not glyph ids
  or a bidi direction; the pen draws the text from each origin up to
  the next as a left-to-right string through Flutter's own shaper, so
  right-to-left and complex-script text is not guaranteed to match the
  browser.
- Inset box shadows are not painted: the engine does not lower them.
- WOFF and WOFF2 publication faces are not decoded; their text falls to
  the next face of its family list (see Fonts).
- An artifact whose text profile is not `platformStringRuns` throws
  `UnsupportedError` before anything is painted.
