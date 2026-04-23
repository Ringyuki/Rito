# Golden Pixel Fixtures

This directory contains the Playwright-based pixel regression tests. The suite
renders curated real-book spreads through the public `createReader` API and
compares the final Canvas PNG output with checked-in image goldens. A full-book
matrix is still available as an opt-in external-baseline mode.

## Fixture Layout

- Pixel profiles live in `tests/golden-pixel/helpers/pixel-profile-config.ts`;
  run selection lives in `pixel-cases.ts` and `pixel-spread-selection.ts`.
- Books used by pixel cases must include the `render` tier in
  `tests/fixtures/books/manifest.json`.
- Generated PNG goldens live under
  `tests/golden/pixels/{book}/{profile}/{lineBreaking}/`.
- Each run directory contains `summary.json` plus selected `spread-0000.png`
  files. The summary still records the full spread count so pagination changes
  remain visible.
- Rare platform-specific fallback glyph differences can be represented by
  `spread-0000.alt-{label}.png`; compare mode accepts the primary spread or any
  alternate image within the same threshold.

## Commands

- `pnpm test:golden:pixel`: compare pixel goldens.
- `pnpm test:golden:pixel:review`: render a human-reviewable comparison report without updating goldens.
- `pnpm test:golden:pixel:update`: regenerate pixel goldens.

Useful filters:

- `RITO_PIXEL_BOOKS=book-03 pnpm test:golden:pixel`
- `RITO_PIXEL_PROFILES=single-narrow pnpm test:golden:pixel:review`
- `RITO_PIXEL_LINE_BREAKING=optimal pnpm test:golden:pixel`
- `RITO_PIXEL_SPREADS=0,1 pnpm test:golden:pixel:review`
- `RITO_PIXEL_WORKERS=4 pnpm test:golden:pixel`
- `RITO_PIXEL_DIAGNOSTICS=1 pnpm test:golden:pixel`
- `RITO_PIXEL_SCOPE=full pnpm test:golden:pixel:update`
- `RITO_PIXEL_BASELINE_ROOT=/path/to/baselines RITO_PIXEL_SCOPE=full pnpm test:golden:pixel`

Compare and update mode use 2 workers by default. Increase
`RITO_PIXEL_WORKERS` only when the machine has enough CPU, memory, and disk I/O
for parallel full-book PNG rendering. Review mode is forced to 1 worker because
it writes one combined HTML report.

Default scope is `curated`: every render-tier book, both line breakers on the
text-primary profiles, and focused supplemental profile coverage:

- `single-default`: `greedy`, `optimal`.
- `single-narrow`: `greedy`, `optimal`.
- `single-wide`: `greedy`.
- `single-default-dpr2`: `greedy`.
- `double-default`: `greedy`.

Every committed run includes all manifest-declared frontmatter spreads for its
book, plus body/tail anchor spreads. The pre-body pages are intentionally not
sampled down because they are the representative real-world cases for covers,
production notes, introductions, color pages, and tables of contents.

`RITO_PIXEL_SCOPE=full` switches to every profile and every spread. Its default
baseline root is `packages/rito/test-results/pixel-full-baselines`, not the
committed `tests/golden/pixels` tree, so full baselines do not inflate the git
repository. Use `RITO_PIXEL_BASELINE_ROOT` to compare against a restored
external baseline.

The review command writes a static report to:

```text
packages/rito/test-results/pixel-review/index.html
```

Each spread directory contains `expected.png`, `actual.png`, `diff.png`, and
`metadata.json`. The report can switch by book, profile, line-breaking mode,
and spread. The command uses the checked-in baselines only as inputs; it does
not update or overwrite them.

`RITO_PIXEL_DIAGNOSTICS=1` makes compare mode write `expected.png`,
`actual.png`, `diff.png`, and `metadata.json` for every spread with non-zero
diff pixels. CI enables this flag for the dedicated pixel job and uploads
`packages/rito/test-results/` when the job fails.

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
