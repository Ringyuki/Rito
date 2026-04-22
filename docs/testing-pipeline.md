# Testing Pipeline

Rito is an EPUB rendering library, so regressions must be caught at the
earliest useful layer and again at the final rendered output. The test pipeline
is split by speed and risk: fast module tests run by default, structured golden
tests protect the full layout chain, render command goldens protect the Canvas
draw stream, and pixel goldens protect browser-rendered output.

## Layers

| Layer             | Command                   | Purpose                                                                                |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| Unit              | `pnpm test:unit`          | Module-level parser, style, layout, render helper, kit, and React tests.               |
| Integration       | `pnpm test:integration`   | Small end-to-end core flows and focused rare-feature render chains.                    |
| Structured golden | `pnpm test:golden:books`  | Full-book parser -> style -> layout -> pagination snapshots for real EPUB fixtures.    |
| Render golden     | `pnpm test:golden:render` | Auto-selected real-book feature pages rendered into normalized Canvas command goldens. |
| Pixel golden      | `pnpm test:golden:pixel`  | Browser Canvas PNG output compared against checked-in image goldens.                   |
| Reader e2e        | `pnpm test:e2e`           | Demo reader behavior: load, navigation, TOC, search, settings, and reflow.             |

## Current Gates

### Local Development

Use the default test command while iterating:

```bash
pnpm test
```

This runs regular Vitest suites and skips opt-in full-book and render golden
tests.

### Pull Requests

The CI workflow uses:

```bash
pnpm run test:ci
```

This includes:

- typecheck
- lint
- format check
- unit tests
- integration tests
- structured full-book golden tests
- render command golden tests
- build

The GitHub CI workflow also installs Chromium and runs:

```bash
pnpm test:golden:pixel
pnpm test:e2e
```

The structured golden step is intentionally part of the PR gate. It covers
real EPUBs across multiple layout configs and catches regressions in page
counts, chapter ranges, line boxes, text runs, paint data, and sampled page
details.

The unit gate also includes golden inventory and coverage invariants. Inventory
validates that book fixtures are flat and registered in the manifest, and that
layout, render-command, and pixel goldens exactly match their configured
fixture/case sets. Coverage validates that render-command goldens still cover
the required selected page features and Canvas command families, and that pixel
goldens still cover the required final-output feature tags. This prevents stale
or missing golden files from silently weakening the slower regression gates.

The integration gate includes focused EPUB fixtures for rare but high-risk
features that may not appear in the current real-book corpus. For example,
block opacity is checked through EPUB loading, CSS resolution, layout paint, and
Canvas `globalAlpha` rendering even when no checked-in full book happens to use
that style.

### Release Checks

Release workflows should run the PR gate plus packaging checks:

```bash
pnpm run test:ci
pnpm test:golden:pixel
pnpm test:e2e
pnpm release:pack-check
```

## Structured Golden Books

Fixtures live in:

```text
packages/rito/tests/fixtures/books/
```

Golden outputs live in:

```text
packages/rito/tests/golden/layout/
```

Commands:

```bash
pnpm test:golden:books:smoke
pnpm test:golden:books
pnpm test:golden:books:update
```

Useful filters:

```bash
RITO_BOOK_LIMIT=1 pnpm test:golden:books
RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:books
RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:books:update
```

Use structured golden tests for layout-chain regressions. Mutation checks have
already shown they catch changes in text measurement and inline border
start/end handling.

## Render Command Golden

Render command goldens live in:

```text
packages/rito/tests/golden/render-commands/
```

Commands:

```bash
pnpm test:golden:render
pnpm test:golden:render:update
```

Useful filters:

```bash
RITO_BOOK_LIMIT=1 pnpm test:golden:render
RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:render
RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:render:update
```

For every render-tier book and golden layout config, the suite paginates the
real EPUB, selects the first and last pages, then selects the strongest page for
each render feature found in that result: text, image, inline atom, ruby,
horizontal rule, inline background, inline border, text shadow, decoration,
block background, block border, transform, opacity, and clipping. Each selected
page is rendered at DPR 1 and DPR 2.

Text arguments are hashed, image arguments are normalized to fixture hrefs, and
numeric coordinates are rounded. This catches render-layer regressions in draw
order, fill/stroke setup, inline borders, ruby placement, horizontal rules,
images, high-DPI scaling, and clipping without depending on browser pixels.

Use this layer when changing `render/**`, paint-ready layout types, or page
composition rules.

## Pixel Golden

Pixel goldens live in:

```text
packages/rito/tests/golden/pixels/
```

Commands:

```bash
pnpm test:golden:pixel
pnpm test:golden:pixel:update
```

Useful filters:

```bash
RITO_PIXEL_CASES=book-03-ruby pnpm test:golden:pixel
RITO_PIXEL_CASES=book-03-ruby pnpm test:golden:pixel:update
```

The suite renders selected real-book spreads in Chromium through the public
`createReader` API, reads the final canvas as PNG, and compares it with
`pixelmatch`. The baseline set starts with each render-tier book's manifest
declared frontmatter spread range because those pages were chosen as
representative real-world samples: covers, production notes, introductions,
color pages, and tables of contents before the first body spread. Additional
targeted cases cover text shadow, inline background, inline border, ruby,
horizontal rules, block transform, clipping, narrow layout, and DPR 2 output.

Pixel golden baselines are committed for Playwright's bundled Chromium, which
is also what CI installs. Use the default browser when updating PNG baselines:

```bash
pnpm exec playwright install chromium
pnpm test:golden:pixel:update
```

If the bundled browser is unavailable but a compatible local browser is
installed, pass a Playwright channel for local diagnosis only. Do not commit
PNG updates generated through a different channel:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=msedge pnpm test:golden:pixel
```

The case shape:

```json
{
  "id": "book-10-inline-border-narrow",
  "bookId": "book-10",
  "spreadIndex": 5,
  "width": 360,
  "height": 640,
  "margin": 28,
  "lineBreaking": "greedy",
  "devicePixelRatio": 1,
  "threshold": 0.08,
  "maxDiffPixelRatio": 0.015,
  "tags": ["inline-border", "narrow-layout"]
}
```

Pixel failures write Playwright test artifacts:

- `actual.png`
- `diff.png`

## Reader E2E

Reader e2e lives in:

```text
apps/reader/tests/e2e/
```

Command:

```bash
pnpm test:e2e
```

The suite builds the demo reader app with Vite, starts `vite preview`, and runs
Playwright against the production bundle. It focuses on user-visible behavior
rather than exhaustive pixel diffs:

- load the demo EPUB and verify a nonblank Canvas render
- keyboard page navigation
- table-of-contents navigation
- search and jump to a result
- settings changes that trigger reflow and theme updates

Reader e2e can use a smaller fixture set than render golden because its job is
runtime behavior, not visual coverage.

It uses the same local browser setup as pixel golden. If Playwright's bundled
Chromium is unavailable locally, pass a browser channel:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=msedge pnpm test:e2e
```

## Failure Policy

Golden diffs should not be accepted by blindly running update commands. Before
updating goldens, identify which layer changed:

- parser or EPUB compatibility
- CSS cascade or computed style
- layout geometry
- line breaking
- pagination policy
- render paint behavior

Only update goldens after confirming the new output is intentional.
