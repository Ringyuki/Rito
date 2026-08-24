# Rendering Diagnostics

Use this process when a real EPUB renders differently in Rito than it does in a
browser-rendered XHTML reference, or when a screenshot points to a specific
visual mismatch that needs root-cause analysis.

The goal is to identify the first layer that diverges, then turn the finding
into the narrowest useful regression test. Do not update golden outputs until
the changed behavior has been classified.

## Case Input

Ad hoc diagnostic books live under the ignored test-results tree:

```text
packages/rito/test-results/render-diagnostics/cases/<case-id>/
  book.epub
  case.json
```

Use this directory for user-provided EPUBs, local reproductions, and temporary
debugging. It is intentionally outside `tests/fixtures/books/` so real books are
not accidentally committed while the issue is still being diagnosed.

`case.json` is a lightweight note file for humans and future scripts:

```json
{
  "description": "Message page horizontal rule wraps in Rito but not in Chromium XHTML",
  "profile": "single-narrow",
  "lineBreaking": "greedy",
  "location": {
    "spreadIndex": 2,
    "userPage": "reported as page 3 in the reader UI",
    "chapterHref": "OEBPS/Text/message.xhtml",
    "selector": "p.message",
    "text": "────────────────────────"
  },
  "notes": "Spread indexes are zero-based."
}
```

Only `book.epub` is required for manual diagnosis. `case.json` should be added
when the report includes page numbers, screenshots, selectors, text snippets, or
any other location hint. Use zero-based `spreadIndex` for Rito commands; keep
the original user-facing page number in `userPage` when it differs.

Run the standard case capture with:

```bash
RITO_DIAG_CASE=<case-id> pnpm diagnose:render
```

The command renders the requested Rito spread through the same browser-side
source reference reader path used by pixel goldens. If `case.json` contains
`location.chapterHref`, it also extracts the EPUB, opens that XHTML chapter in
Chromium, and captures browser reference facts.

Use a single-page profile for Rito-vs-browser XHTML comparisons. The diagnostic
script rejects browser XHTML reference capture for `double-default` cases.
Double-page mode should be reserved for spread composition questions such as
left/right page parity, blank-page insertion, and cover/frontmatter pairing.
This keeps page numbers and reference viewport width unambiguous.

If the book should become a long-term regression fixture after the diagnosis,
copy it to:

```text
packages/rito/tests/fixtures/books/
```

Then register it in `packages/rito/tests/fixtures/books/manifest.json` and add
the required structured, render-command, and pixel golden baselines.

## Artifact Layout

Diagnostic output should stay in the same case directory:

```text
packages/rito/test-results/render-diagnostics/cases/<case-id>/artifacts/
  report.json
  rito/
    actual.png
    diagnostics.json
    page-detail.json
    summary.json
  browser/
    extracted/
    reference.png
    computed-style.json
    dom-rects.json
  text-metrics.json
  production/
    actual.png
    diagnostics.json
    frame-summary.json
    page-detail.json
    summary.json
  reference/
    actual.png
    diagnostics.json
    frame-summary.json
    page-detail.json
    summary.json
  comparison/
    diff.png
    report.md
  parity/
    diff.png
    frame-summary.json
    report.md
```

`report.json` is the top-level index written by `pnpm diagnose:render`. It
links the engine screenshots and JSON facts, plus the browser reference facts
when `case.json` provides `location.chapterHref`, and the comparison artifacts.

`production/` contains the output from the root `@ritojs/core` reader path.
`reference/` contains the output from the TypeScript reference reader path. Each
engine directory contains:

- `actual.png`: captured spread image
- `diagnostics.json`: browser console and page errors observed during capture
- `page-detail.json`: page-level detail returned by the render harness
- `summary.json`: case, profile, spread, chapter map, manifest map, and spread summary
- `frame-summary.json`: compact parity facts including canvas size, spread/page
  summary, metadata hashes, and PNG hash

`browser/` contains the extracted EPUB package and, when a chapter reference is
available, Chromium XHTML reference facts:

- `extracted/`: temporary extracted EPUB package served by the diagnostic HTTP server
- `reference.png`: screenshot of the browser-rendered XHTML reference
- `computed-style.json`: target and ancestor computed styles
- `dom-rects.json`: target and ancestor DOM geometry
- `text-metrics.json`: browser font status and canvas text metrics samples

`comparison/` contains the derived diagnostic comparison:

- `report.md`: human-readable case summary and comparison outcome
- `diff.png`: pixel diff between `browser/reference.png` and the primary engine output

`parity/` is produced by `RITO_DIAG_ENGINE=both` or `pnpm diagnose:reader-parity`.
It compares `reference/actual.png` against `production/actual.png`, and writes a
machine-readable `frame-summary.json` so layout/resource drift can be inspected
without relying only on pixels.

`report.md` files are always produced. `diff.png` is produced when both images
exist and have the same pixel dimensions. If the case has no
`location.chapterHref`, or if screenshots have different dimensions, the report
explains why no browser diff image was written.

## Standard Workflow

### 1. Capture The Failing View

Record the book, single-page profile, line-breaking mode, viewport, DPR,
spread/page, and the visible symptom. If the book is already registered in
`tests/fixtures/books/manifest.json`, start with the existing review tool:

```bash
RITO_PIXEL_BOOKS=book-04 \
RITO_PIXEL_PROFILES=single-narrow \
RITO_PIXEL_LINE_BREAKING=greedy \
RITO_PIXEL_SPREADS=2 \
pnpm test:golden:pixel:review
```

The report is written to:

```text
packages/rito/test-results/pixel-review/index.html
```

For CI-only failures, rerun compare mode with diagnostics enabled:

```bash
RITO_PIXEL_DIAGNOSTICS=1 pnpm test:golden:pixel
```

CI already uploads `packages/rito/test-results/` when the dedicated pixel job
fails.

### 2. Build A Browser XHTML Reference

Use Playwright/Chromium as the browser reference. Extract the EPUB into the case
directory, serve the package root over HTTP, open the relevant XHTML chapter,
and capture:

- screenshot of the reference view
- `getComputedStyle()` for the target node and nearby ancestors
- `getBoundingClientRect()` for the target node and nearby blocks/runs
- `document.fonts` status and canvas `measureText()` samples for suspicious text

The browser reference is a diagnostic baseline, not an automatic source of
truth. Rito intentionally implements an EPUB-focused subset rather than a full
browser layout engine, so any difference still needs classification.

For content/layout comparisons, match the browser reference viewport to the
single-page Rito viewport. Do not compare a standalone XHTML page against a
double-page spread canvas. If the reported issue only appears in double-page
mode, first identify the underlying page/chapter in double mode, then rerun the
content comparison in single-page mode.

### 3. Map The Symptom To Source

Use the EPUB package, spine, and chapter hrefs to map the visible region back to
source content:

- package manifest item and spine idref
- chapter XHTML href
- selector, class, id, or text snippet
- linked stylesheets for that chapter
- font-face declarations and referenced font files

For registered books, structured golden summaries already record chapter ranges
and pagination data. Use them before writing one-off probes.

### 4. Bisect The Rito Pipeline

Find the first Rito layer that differs from the browser reference or from the
expected EPUB behavior:

| Layer          | What To Compare                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| EPUB load      | package document, manifest hrefs, spine order, resource paths                 |
| XHTML parse    | node tree, attributes, text normalization, links to stylesheets               |
| CSS parse      | parsed declarations, unsupported declarations, unit conversion                |
| Cascade        | matching selectors, specificity, inheritance, inline style precedence         |
| Computed style | font size, line height, margins, text indent, writing mode, color, transforms |
| Inline shaping | flattened inline segments, ruby, inline atom boxes, borders, backgrounds      |
| Text measure   | font loading, fallback fonts, glyph widths, DPR-sensitive metrics             |
| Line breaking  | greedy vs optimal breakpoints, available width, inline border/padding width   |
| Block layout   | block bounds, margin collapse policy, floats, tables, positioned elements     |
| Pagination     | page/spread count, chapter ranges, widows/orphans, page breaks                |
| Paint model    | `RunPaint`, `BlockPaint`, `PagePaint`, draw order, clipping, opacity          |
| Display list   | draw command kinds, image references, text paint commands, transforms         |
| Canvas backend | normalized Canvas records, image drawing, text drawing, transforms, scaling   |
| Final pixels   | PNG diff, antialiasing, platform fallback glyphs, image decode differences    |

Start at the highest layer that can explain the symptom. For example, a wrong
font size should start at cascade/computed style; a wrong final color with
correct style and layout should start at paint/render; a wrap difference should
inspect text measurement and line breaking before Canvas pixels.

### 5. Use Temporary Probes

For internal Rito inspection, write a temporary Vitest probe only when existing
golden artifacts are not enough:

```text
packages/rito/tests/integration/epub-diag.test.ts
```

The probe should load
`packages/rito/test-results/render-diagnostics/cases/<case-id>/book.epub`, write
diagnostic output into the case `artifacts/` directory, and be deleted after the
root cause is found.

Useful probes include:

- dump linked stylesheets for the target chapter
- list CSS rules that match the target node
- print computed styles for the target subtree
- print line boxes and text-run bounds on the affected page
- capture display-list commands and Canvas backend records for the affected page
- compare `measureText()` for suspicious text and font families

### 6. Classify The Difference

Every diagnosis should end in one of these categories:

- **Rito bug**: browser/reference behavior is within Rito's supported EPUB
  subset and Rito diverges.
- **Unsupported feature**: the EPUB depends on CSS or layout behavior outside
  the current scope. Document it or add a targeted issue.
- **Intentional Rito behavior**: Rito differs from browser layout by design for
  pagination, reader constraints, or EPUB-focused policy.
- **Platform/browser variance**: the difference is caused by stable
  environment variance such as fallback glyph metrics. Use an explicit alternate
  baseline only after confirming the underlying render intent is unchanged.
- **Expected behavior change**: source changes intentionally affect output; the
  relevant goldens can be updated after review.

### 7. Promote To Regression Coverage

Choose the narrowest coverage that would have caught the issue:

- parser/CSS/style bug: unit test with focused XHTML/CSS
- layout or pagination bug: integration test plus structured golden update
- paint model or backend bug: render-command golden update
- final browser output bug: pixel golden case or alternate baseline
- real-book-only interaction: keep the book in `tests/fixtures/books/` and add
  the needed tiers in the manifest

For pixel changes, prefer `pnpm test:golden:pixel:review` before update. For
alternate baselines, keep the primary baseline unchanged and add
`spread-0000.alt-{label}.png` with a documented reason.

## Diagnostic Command

Current command:

```bash
RITO_DIAG_CASE=<case-id> pnpm diagnose:render
```

Reader parity command:

```bash
RITO_DIAG_CASE=<case-id> pnpm diagnose:reader-parity
```

Optional overrides:

```bash
RITO_DIAG_EPUB=/absolute/path/book.epub
RITO_DIAG_PROFILE=single-default|single-narrow|single-wide|double-default
RITO_DIAG_LINE_BREAKING=greedy|optimal
RITO_DIAG_SPREAD=0
RITO_DIAG_DPR=1
RITO_DIAG_ENGINE=production|reference|both
PLAYWRIGHT_BROWSER_CHANNEL=msedge
```

The command uses this stable case contract:

- default case root:
  `packages/rito/test-results/render-diagnostics/cases/`
- case selector: `RITO_DIAG_CASE=<case-id>`
- EPUB path:
  `packages/rito/test-results/render-diagnostics/cases/<case-id>/book.epub`
- optional metadata:
  `packages/rito/test-results/render-diagnostics/cases/<case-id>/case.json`
- artifacts:
  `packages/rito/test-results/render-diagnostics/cases/<case-id>/artifacts/`

Scripts may also accept `RITO_DIAG_EPUB=/absolute/path/book.epub` for one-off
local input, but they should copy or reference that book from a case directory
before writing artifacts.

## Relationship To Existing Tests

This workflow does not replace the regression pipeline:

- use `pnpm test:golden:books` for parser -> style -> layout -> pagination
  snapshots
- use `pnpm test:golden:render` for display-list and Canvas backend record regressions
- use `pnpm test:golden:pixel` for final browser-rendered Canvas pixels
- use `pnpm test:golden:pixel:review` for human visual review
- use `pnpm test:e2e` for reader app behavior

Diagnostics explain why a difference exists. The golden suites keep it from
coming back.
