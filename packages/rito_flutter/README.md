# rito_flutter

Flutter adapter for Rito's platform-independent native reader protocol. It
strictly decodes owned `RITOART1` artifacts and the typed little-endian
`RITODL1` display contract, paints them with `CustomPainter`, and accesses
`rito-ffi` through owned byte buffers. Geometry, transforms, paint, CSS Color 4
components, and discriminants remain typed through the renderer; production
code contains no generic wire-value tree or CSS color-string parser.

The adapter is not a WebView and performs no network or filesystem I/O. EPUB
parsing, CSS, layout, seek, turn, and reflow run through `RitoIsolateGateway`;
the UI isolate registers owned artifact fonts and replays an already-published
artifact. Images are decoded by the application and injected with
`RitoImageResolver`.

Flutter's Native Assets build hook compiles the workspace `rito-ffi` crate and
bundles the correct dynamic library for the selected Android, iOS, or host
target on Flutter 3.41.7 or newer. Application code does not construct or guess
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
final gateway = RitoIsolateGateway();
final session = await RitoReaderSession.open(
  gateway: gateway,
  publicationBytes: epubBytes,
  request: request,
);

RitoPageSurface(
  artifact: session.firstArtifact,
  resolveImage: imagesByHref.call,
);

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
final image = await session.readResource(next, next.resources.first);

// Keep both prepared artifacts alive through the page-turn animation.
await session.releaseArtifact(session.firstArtifact);
await session.dispose();
await gateway.close();
```

`open`, `turn`, and `requestArtifact` return only `RitoPreparedArtifact`
instances. Every font declared by the artifact is read through that artifact's
native ownership, length-checked, and registered before the future completes;
`RitoPageSurface` cannot accept a raw decoded artifact. Immutable font faces
are deduplicated process-wide by family plus shape fingerprint. Failed loads
are evicted for retry, and completed cache entries do not retain font bytes.
Hosts that must decode images or prepare other resources before visibility can
pass `resourcePreparer` to `RitoReaderSession.open`; its ownership-checked
reader runs after font preparation and before foreground/background adoption.
No non-font image decoding is implied when that hook is absent.

Native foreground results are candidates, not visible frames. The session
prepares each candidate and then commits it with a visible-artifact CAS. A
replaced artifact stays live for page-turn animation until the host releases
it; releasing the currently visible artifact is rejected. `readPublication`,
`advanceBackground`, and `adoptBackground` expose the typed publication and
host-scheduled background path without implicitly adopting raw candidates.

An exact open or seek is never replaced with a page-one artifact. If Core
reports `RITO_STATUS_EXACT_SEEK_PENDING_V1`, the persistent worker advances one
bounded quantum per asynchronous host turn until the exact artifact is ready,
the target becomes terminal, or the operation is superseded/disposed. These
continuations consume request IDs, so subsequent navigation should use
`session.nextRequestId` rather than assuming that one public operation consumed
only one native ID.

An unpublished adjacent turn follows the same cooperative rule. Only
`RITO_STATUS_ADJACENT_PENDING_V1` resumes the retained
source/direction/local-page-cap intent, with one native quantum per host turn
and a 4096-continuation hard cap; plain `TARGET_NOT_PUBLISHED` is terminal.
Foreground replacement or disposal cancels the old owner, background work
yields while it is retained, and the source artifact remains live after the
final candidate is prepared and adopted so page-turn animation can finish.

`turn` always emits the fixed 60-byte `RITONAV1` request and calls
`rito_request_adjacent_v1` on the persistent worker isolate. It does not call
`requestArtifact` or repeat locator seek/layout. `requestArtifact` remains an
explicit API for seek or reflow requests. Image hrefs are passed to
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
copies every native output before calling `rito_buffer_free_v1`; applications
should normally use the isolate gateway. Tests and embedder diagnostics may opt
out of Native Assets with `RitoIsolateGateway(diagnosticLibrary: ...)` or
`RitoNativeBindings.fromDynamicLibrary(...)`.

A full integration reference lives in `doc/INTEGRATION.md`.

## Paint parity

The Canvas pen replays the same display list as the pixel-court
calibrated browser pen and is held to it by the diff instrument at
`tools/paint-parity/run.mjs` (repo root): shared fixture corpus →
both pens → per-pixel report. All geometric rules — two-stage baseline
snapping, letter-spacing distribution, border grid snapping and 1px
dotted binary dots, per-corner radii with CSS §5.5 overlap scaling,
box-shadow sigma and interior exclusion, background sizing/tiling,
image sourceRect sampling, typed-color sRGB clipping — are ported and
verified pixel-exact. Remaining divergence is rasterizer-level AA and
interpolation rounding, itemized with evidence in
`tools/paint-parity/EXEMPTIONS.md`. Font-dependent anchors (ruby,
text-shadow, inline envelopes) use OS/2 metrics via
`RitoFontEnvelopeStore`, filled automatically during font preparation.

## Known renderer semantics still to close

- `RITODL1` V1 does not carry bidi direction or visual glyph runs, so Flutter
  text replay is currently LTR and cannot guarantee browser-identical complex
  script shaping or glyph positioning.
- Flutter 3.41's `FontLoader` documents OTF/TTF support only. EPUB WOFF/WOFF2
  faces therefore fail closed before page paint unless an injected
  `RitoFontRegistrar` transcodes them or the native adapter supplies SFNT font
  bytes. A transcoding registrar should also register the transcoded bytes
  with `RitoFontEnvelopeStore.shared` so 'top'-anchored features keep their
  Chromium-sourced metrics.
- Inset box shadows are decoded but not painted; they and `groove`/`ridge`/
  `inset`/`outset` borders fail closed with `UnsupportedError` before any
  partial paint.
