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
    work: const RitoWorkBudget(
      maxTopLevelNodesPerQuantum: 8,
      maxForegroundQuanta: 2,
      localPageCap: 16,
    ),
  ),
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
  work: const RitoWorkBudget(
    maxTopLevelNodesPerQuantum: 8,
    maxForegroundQuanta: 2,
    localPageCap: 16,
  ),
);

// Release the old page once the turn animation finishes.
await session.releaseArtifact(session.firstArtifact);

// Shutdown.
await session.dispose();
await gateway.close();
```

## Session lifecycle (`RitoReaderSession`)

`open`, `turn`, `requestArtifact`, and `requestAdjacent` return only
`RitoPreparedArtifact` — an artifact whose declared fonts are
registered (and images decoded, when an image cache is configured)
before the future completes. `RitoPageSurface` cannot accept anything
else, so an unprepared page can never reach the screen.

| member                                                                                                      | contract                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open(gateway:, publicationBytes:, request:, fontCache:, imageCache:, imagePixelRatio:, resourcePreparer:)` | Opens the publication and prepares the first artifact. `imagePixelRatio` scales decoded image budgets; pass the device pixel ratio.                     |
| `turn(from:, requestId:, direction:, work:)`                                                                | Adjacent-page navigation via the fixed 60-byte `RITONAV1` request. Never re-runs locator seek or layout.                                                |
| `requestArtifact(request)`                                                                                  | Explicit seek or reflow (viewport change, font-size change, locator jump).                                                                              |
| `readPublication()`                                                                                         | Typed publication metadata (spine, TOC).                                                                                                                |
| `readResource(prepared, ref)`                                                                               | Ownership-checked resource bytes (images, stylesheets) for the given artifact.                                                                          |
| `advanceBackground(...)` / `adoptBackground(...)`                                                           | Host-scheduled background pagination; candidates never become visible implicitly.                                                                       |
| `releaseArtifact(prepared)`                                                                                 | Frees a replaced artifact. Releasing the currently visible artifact is rejected — keep both alive through a page-turn animation.                        |
| `dispose()`                                                                                                 | Ends the session. Dispose the session before `gateway.close()`.                                                                                         |
| `nextRequestId`                                                                                             | Always allocate request IDs here. Exact-seek and unpublished-adjacent continuations consume native IDs internally, so one public call may burn several. |
| `visibleArtifactId`                                                                                         | The committed visible artifact.                                                                                                                         |

Navigation supersession: a newer `turn`/`requestArtifact` cancels an
in-flight one with `RitoNavigationSupersededException`. An exact open
or seek is never silently replaced by a page-one artifact; pending
exact seeks and unpublished adjacent turns resume one bounded native
quantum per host turn until ready, terminal, or superseded.

## Rendering (`RitoPageSurface`)

```dart
RitoPageSurface(
  artifact: prepared,          // RitoPreparedArtifact
  resolveImage: (href) => ..., // optional ui.Image? Function(String)
)
```

- The surface sizes itself to `artifact.artifact.width/height` (layout
  viewport units) and repaints only when the artifact identity changes.
- Images: if the session was opened with a `RitoArtifactImageCache`,
  the prepared artifact carries an image lease and no `resolveImage`
  callback is needed. Otherwise supply one; hrefs arrive exactly as the
  artifact declares them (relative paths, original case). Return `null`
  to skip an image. The painter performs no I/O and no decoding.
- The painter fails closed (throws before painting anything) on:
  inset box shadows, `groove`/`ridge`/`inset`/`outset` borders,
  background tile grids above 4096 tiles, and non-`platformStringRuns`
  text profiles. Catch at the widget layer if the corpus may contain
  these.

## Fonts

- Fonts are prepared by `RitoArtifactFontCache.shared` by default:
  read through the artifact's native ownership, length-checked,
  registered with `FontLoader`, deduplicated process-wide by family +
  shape fingerprint. Failed loads are evicted for retry.
- **Font envelopes** (`RitoFontEnvelopeStore.shared`) are filled
  automatically from the same bytes. The pen anchors ruby, text-shadow,
  and inline background/border envelopes with OS/2 typo/win metrics —
  the same tables Chromium's canvas uses — so pages match the browser
  pen to the pixel. Nothing to do in the default path.
- WOFF/WOFF2 faces fail closed: Flutter's `FontLoader` accepts only
  OTF/TTF. Hosts may inject a transcoding `RitoFontRegistrar` into
  `RitoArtifactFontCache`; such a registrar should also call
  `RitoFontEnvelopeStore.shared.register(family, sfntBytes)` with the
  transcoded bytes, since the cache only sees the original payload
  (non-sfnt bytes are safely ignored). Without an envelope a family
  falls back to SkParagraph metrics and 'top'-anchored features may
  drift 1–3px.

## Request models

- `RitoLayoutRequest`: viewport, margins, `spreadMode`
  (`single`/`double`), `firstPageAlone`, `spreadGap`, `rootFontSize`,
  optional `lineHeightOverride` / `fontFamilyOverride`. Any change
  requires a new `requestArtifact` (reflow).
- `RitoLocator`: where to open — a required spine `href` plus an
  optional `anchorId`, `sourcePoint`, `sourceRange`, or `progression`.
  The artifact reports which match kind was honored
  (`RitoLocatorMatch`).
- `RitoWorkBudget`: cooperative scheduling knobs
  (`maxTopLevelNodesPerQuantum`, `maxForegroundQuanta`,
  `localPageCap`). Larger budgets lower latency per call but block the
  worker isolate longer per quantum.
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

The Flutter pen replays the same display list the calibrated browser
pen consumes, and is held to it by a pixel-diff instrument
(`tools/paint-parity/run.mjs` at the repo root). Every geometric rule —
baseline snapping, letter-spacing distribution, border snapping and
1px dotted grids, radius and §5.5 corner scaling, shadow sigma,
background tiling, sourceRect sampling, sRGB color clipping — is
ported and verified pixel-exact; the remaining divergence is
rasterizer-level anti-aliasing/interpolation rounding, itemized in
`tools/paint-parity/EXEMPTIONS.md`. When touching
`lib/src/render/**`, re-run the instrument; a fixture climbing the
report is a regression.

Known open semantics (fail-closed or documented, never approximated):

- `RITODL1` V1 carries no bidi direction or positioned glyph runs;
  text replay is LTR string runs.
- Inset box shadows and `groove`/`ridge`/`inset`/`outset` borders
  throw `UnsupportedError` before any partial paint.
- WOFF faces throw unless a transcoding registrar is provided.
