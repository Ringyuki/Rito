## Unreleased

- EXIF quarter-turned JPEGs validate against the engine's presented dimensions
  (a rotated plate no longer fails artifact preparation).
- A failing image degrades to a recorded absence instead of blocking the page
  turn: `resolveImage` now returns null for it (breaking), the fault is
  reported through `FlutterError`, and the lease lists it in `failedImages`.

## 0.1.0 - 2026-07-31

- Introduce the Flutter adapter for Rito's native EPUB reader protocol, with
  typed artifact/display-list decoding and `CustomPainter` replay.
- Add isolate-backed reader sessions for open, seek, reflow, adjacent turns,
  background pagination, resource reads, search, and text-range geometry.
- Add explicit artifact ownership, latest-wins cancellation, prepared font and
  image resources, bounded caches, and page-turn-safe lifecycle handling.
- Add Native Assets builds for Android, iOS, macOS, Linux, and Windows from the
  pinned `rito-ffi` Rust source included in the published package.
- Add Canvas paint parity for typed colors, borders, radii, shadows,
  backgrounds, images, inline decoration, ruby, and font envelopes.
