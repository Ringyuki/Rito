# Golden Pixel Fixtures

This directory contains the Playwright-based pixel regression tests. The suite
renders selected real EPUB spreads through the public `createReader` API and
compares the final Canvas PNG output with checked-in image goldens.

## Fixture Layout

- Pixel cases live in `tests/golden-pixel/helpers/pixel-cases.ts`.
- Books used by pixel cases must include the `render` tier in
  `tests/fixtures/books/manifest.json`.
- Every render-tier book must declare `pixelFrontmatterSpreadCount` in
  `tests/fixtures/books/manifest.json`. Those frontmatter spreads cover
  representative covers, production notes, introductions, color pages, and
  tables of contents before the first body spread.
- Generated PNG goldens live under `tests/golden/pixels/`.

## Commands

- `pnpm test:golden:pixel`: compare pixel goldens.
- `pnpm test:golden:pixel:review`: render a human-reviewable comparison report without updating goldens.
- `pnpm test:golden:pixel:update`: regenerate pixel goldens.

Useful filters:

- `RITO_PIXEL_CASES=book-03-body-ruby pnpm test:golden:pixel`
- `RITO_PIXEL_CASES=book-03-body-ruby pnpm test:golden:pixel:review`
- `RITO_PIXEL_CASES=book-03-body-ruby pnpm test:golden:pixel:update`

The review command writes a static report to:

```text
packages/rito/test-results/pixel-review/index.html
```

Each case directory contains `expected.png`, `actual.png`, `diff.png`, and
`metadata.json`. The command uses the checked-in baselines only as inputs; it
does not update or overwrite them.

## Browser Setup

Install Playwright's Chromium before running the suite locally:

```bash
pnpm exec playwright install chromium
```

Pixel baselines are committed for Playwright's bundled Chromium on macOS, which
matches the dedicated CI pixel job. If the bundled browser is unavailable but a
compatible local browser is installed, pass a channel for local diagnosis only:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=msedge pnpm test:golden:pixel
```

The CI workflow runs this suite in a separate macOS job after installing
Chromium.
