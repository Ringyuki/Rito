# Pixel Suite

This directory holds the Playwright pixel suite of `@ritojs/core`. It runs
the production browser reader — the built `dist/` bundle, the WASM engine
in its Worker and the Canvas pen — in Chromium and checks what reaches the
canvas against what the engine reports.

The suite has one spec today:

- `production-exact-fallback-selection.test.ts` builds a minimal EPUB whose
  text needs both the author's embedded face and a pinned fallback face
  (the glyphs are chosen so each face is the only one that has them),
  renders it, and asserts that the exact text ranges the Rust engine
  resolves land on the glyphs the Canvas painted, within a width drift of
  0.05 px, across author and pinned faces, wrapped lines and variable
  Latin; it also checks that fragment search resolves durable source
  ranges for those samples.

`helpers/render-server.ts` serves the built package to the page;
`helpers/sfnt-cmap.ts` reads a font's character map so a fixture can prove
which face covers which code point instead of assuming it.

## Commands

```bash
pnpm test:golden:pixel
RITO_PIXEL_WORKERS=4 pnpm test:golden:pixel
```

The command builds `@ritojs/core` first. There are no checked-in PNG
baselines: the spec compares the live render against the engine's own
geometry, so it never needs updating when the browser is upgraded.

## Browser Setup

Install Playwright's Chromium before running the suite locally:

```bash
pnpm exec playwright install chromium
```

The CI workflow runs this suite in a separate macOS job after installing
Chromium. If the bundled browser is unavailable but a compatible local
browser is installed, pass a channel for local diagnosis only:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=msedge pnpm test:golden:pixel
```

Whole-book pixel verification against pinned Chromium is the pixel walk in
`tools/corpus-oracle`; see `docs/development/verification-instruments.md`.
