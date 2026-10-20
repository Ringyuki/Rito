# rito_flutter

Flutter adapter for Rito's platform-independent native reader protocol. It
strictly decodes owned `RITOART1` artifacts and the typed little-endian
`RITODL1` display contract, paints them with `CustomPainter`, and accesses
`rito-ffi` through owned byte buffers. Geometry, transforms, paint, CSS Color 4
components, and discriminants remain typed through the renderer; production
code contains no generic wire-value tree or CSS color-string parser.

The adapter is not a WebView and performs no network or filesystem I/O. EPUB
parsing, CSS, layout, seek, turn, and reflow run through `RitoNativeGateway`
on the calling isolate, so the frame that asks for a layout can draw it; the
UI isolate registers owned artifact fonts and replays an already-published
artifact. The whole book behind the page shown is laid out a few pages at a
time between frames. Images are decoded by the package when the session is opened with a
`RitoArtifactImageCache`, each landing after its page is shown; without one the
application decodes them and supplies them through `RitoImageResolver`.

Flutter's Native Assets build hook compiles the workspace `rito-ffi` crate and
bundles the correct dynamic library for the selected Android, iOS, or host
target on Flutter 3.47 or newer. Application code does not construct or guess
a library path.

## Installation

```console
flutter pub add rito_flutter
```

The build machine must provide Rust 1.95 and the Rust target selected by
Flutter. Android builds additionally require NDK 28.2; iOS builds require
Xcode. The package includes the locked Rust source closure used by its Native
Assets hook, so consuming applications do not need a Rito repository checkout.

## Basic usage

```dart
final gateway = RitoNativeGateway();
final session = await RitoReaderSession.open(
  gateway: gateway,
  publicationBytes: epubBytes,
  request: request,
  pinnedFontPolicy: RitoPinnedFontPolicy(faces: [
    RitoPinnedFontFace(
      bytes: serifBytes, // TTF/OTF
      genericRole: RitoPinnedFontGenericRole.serif,
    ),
  ]),
);

RitoPageSurface(
  artifact: session.firstArtifact,
  resolveImage: imagesByHref.call,
);

final next = await session.turn(
  from: session.firstArtifact,
  requestId: session.nextRequestId,
  direction: RitoAdjacentDirection.next,
);
final resource = await session.readResource(next, next.resources.first);

// Keep both prepared artifacts alive through the page-turn animation.
await session.releaseArtifact(session.firstArtifact);
await session.dispose();
await gateway.close();
```

`pinnedFontPolicy` is required: the engine lays text out with the host's faces
and the publication's own, and an open without host faces fails.

`session.firstArtifact` and the results of `turn`, `peek` and `requestArtifact`
are only ever `RitoPreparedArtifact` instances. Every font declared by the
artifact is read through that artifact's native ownership, length-checked, and
registered before the future completes; `RitoPageSurface` cannot accept a raw
decoded artifact. Immutable font faces are deduplicated process-wide by family
plus shape fingerprint. Failed loads are evicted for retry, and completed cache
entries do not retain font bytes. With an image cache the session also starts
reading and decoding the artifact's images, without waiting for them: a page is
returned before its images land and repaints as each does. Hosts that must
prepare other resources before a page is shown can pass `resourcePreparer` to
`RitoReaderSession.open`; its ownership-checked reader runs after font
preparation and before foreground/background adoption. Without an image cache
or that hook, nothing but fonts is prepared.

Native foreground results are candidates, not visible frames. The session
prepares each candidate and then commits it with a visible-artifact CAS. A
replaced artifact stays live for page-turn animation until the host releases
it; releasing the currently visible artifact is rejected. `readPublication`,
`advanceBackground`, and `adoptBackground` expose the typed publication and
host-scheduled background path without implicitly adopting raw candidates.

An exact open or seek is never replaced with a page-one artifact: the target
chapter is paginated whole in one native call, so the result is either the
exact artifact or a terminal error.

An unpublished adjacent turn is cooperative. Only
`RITO_STATUS_ADJACENT_PENDING` resumes the retained source/direction
intent, with one native call per asynchronous host turn and a
4096-continuation hard cap; plain `TARGET_NOT_PUBLISHED` is terminal. These
continuations consume request IDs, so subsequent navigation should use
`session.nextRequestId` rather than assuming that one public operation consumed
only one native ID. Foreground replacement or disposal cancels the old owner,
background work yields while it is retained, and the source artifact remains
live after the final candidate is prepared and adopted so page-turn animation
can finish.

`turn` lands on the neighbour with a pure visible-artifact swap when `peek`
already published it from the page being turned from. Otherwise it emits the
fixed 48-byte `RITONAV1` request and calls `rito_request_adjacent`. Either way it does not call `requestArtifact` or
repeat locator seek/layout. `requestArtifact` remains an explicit API for seek
or reflow requests. Image hrefs are passed to
`RitoImageResolver` exactly as declared by the artifact, including relative
paths and original case.

The build machine needs the repository's pinned Rust 1.95 toolchain and the
Rust target requested by Flutter. Android builds use NDK 28.2 and its
API-specific Clang linker. iOS builds support arm64 devices plus arm64/x64
simulators; Flutter combines per-architecture dylibs when producing a universal
bundle. Every hook invocation runs exactly one locked release Cargo build with
one job and an isolated target directory. Cargo is resolved from `CARGO`, then
`PATH`, then the standard `~/.cargo/bin/cargo` location; the hook never installs
or downloads a toolchain itself.

`RitoNativeBindings` is the blocking low-level ABI projection and is exposed
from `package:rito_flutter/rito_flutter_native.dart` for custom embedders. It
copies every native output before calling `rito_buffer_free`; applications
should normally use `RitoNativeGateway`. Tests and embedder diagnostics may opt
out of Native Assets with `RitoNativeGateway(diagnosticLibrary: ...)` or
`RitoNativeBindings.fromDynamicLibrary(...)`.

For an app, `RitoReaderController` owns the visible page (turns, jumps,
relayouts, neighbour peeks, background pagination and every release), and
`RitoPageTurnController` with `RitoPageTurnView` turns pages with the same
physics and effects as the web reader, or with an effect you paint and
physics you write:

```dart
final reader = RitoReaderController(session, layout: layout);
final turns = RitoPageTurnController(reader: reader, vsync: this);

ListenableBuilder(
  listenable: reader,
  builder: (context, _) => RitoPageTurnView(
    controller: turns,
    child: RitoPageSurface(artifact: reader.page),
  ),
);
```

`RitoPaperTurnEffect` turns a page as the web reader's paper turn does:
curled over on itself under the finger, its back showing its print
through, its shadow on the page beneath; how the paper moves and where it
is are the engine's, the same as on the web. It draws with Flutter GPU,
which needs Impeller and which the app enables (Android: the
`io.flutter.embedding.android.EnableFlutterGPU` meta-data set to `true` in
the manifest; iOS: `FLTEnableFlutterGPU` set to `true` in Info.plist);
without it turns are drawn as `cover`. Make one per controller and dispose
of it with the controller:

```dart
final paper = RitoPaperTurnEffect();
final turns = RitoPageTurnController(reader: reader, vsync: this, effect: paper);
// ...
turns.dispose();
paper.dispose();
```

A full integration reference lives in `doc/INTEGRATION.md`.

## Fonts

Layout shapes with the pinned faces the session opens with plus the
publication's own `@font-face` fonts, and paint draws every run with the exact
face that shaped it (registered under its `familyAlias`). A `font-family`
list resolves the way CSS resolves it against installed fonts: a named family
is the book's `@font-face` family of that name, else the host face of that
name; `serif` / `sans-serif` / `monospace` resolve to the host faces of that
role, language-neutral first, then by the content's `lang`.

```dart
final catalog = await session.fontCatalog(); // build a font picker from it
await session.addFontFaces([
  RitoPinnedFontFace(bytes: imported, genericRole: RitoPinnedFontGenericRole.serif),
]);
final skipped = await session.unresolvedFontFamilies('"LXGW WenKai", serif');
// The next request lays out with the face, e.g. a layout whose
// fontFamilyOverride names it.
```

`removeFontFaces([sha256])` takes a face back out; at least one must remain.

## Paint parity

The engine resolves every page into device-pixel primitives — fills,
strokes, clips, shadows, image draws, and text runs with their cluster
origins — and the Canvas pen only blits them: border bands and
dash cadences, radii, box shadows, background sizing and tiling, inline
boxes and decoration lines are all decided in the engine, not here. The
browser pen blits the same bytes, and the two are held together by the
diff instrument at `tools/paint-parity/run.mjs` (repo root): shared
fixtures lowered by the engine → both pens → per-pixel report against a
budget per fixture. What the pens still decide is confined to text
rasterization, shadow blur, typed-colour conversion to sRGB and the
theme override. Remaining divergence is rasterizer-level (glyph and edge
anti-aliasing, blur kernels, image interpolation rounding), itemized
with evidence in `tools/paint-parity/EXEMPTIONS.md`.
`RitoFontEnvelopeStore`, filled automatically during font preparation,
records the weight each face was declared with, so the pen does not
embolden a face the book already ships as its bold.

## Known renderer semantics still to close

- A text run carries its string and its cluster origins, not glyph ids
  or a bidi direction. The pen draws the text from each origin up to the
  next as a left-to-right string through Flutter's own shaper, so
  right-to-left and complex-script text is not guaranteed to match the
  browser.
- The engine shapes with TTF/OTF bytes and does not decode WOFF or
  WOFF2: text set in such a publication face is laid out and painted with
  the next face its family list resolves to. Flutter's `FontLoader`
  documents OTF/TTF only as well, and the default `RitoFontRegistrar`
  rejects WOFF bytes.
- Inset box shadows are not painted: the engine does not lower them.
- An artifact whose text profile is not `platformStringRuns` throws
  `UnsupportedError` before anything is painted.
