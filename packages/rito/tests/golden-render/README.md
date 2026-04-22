# Golden Render Command Fixtures

This directory contains the opt-in render-layer golden tests. For every render
fixture and golden layout config, the suite paginates the real book, selects
feature-rich pages, renders them into a recording Canvas 2D context, and
compares the normalized drawing command stream against JSON goldens.

It is not a pixel test. It is the deterministic render-layer gate that can run
inside Vitest without a browser. The Playwright pixel golden suite covers the
browser-rendered Canvas output on top of this layer.

## Fixture Layout

- Page selection lives in `tests/golden-render/helpers/render-page-selection.ts`.
- Books used by render cases must include the `render` tier in
  `tests/fixtures/books/manifest.json`.
- Generated command goldens live under `tests/golden/render-commands/`.

## Commands

- `pnpm test:golden:render`: compare render command goldens.
- `pnpm test:golden:render:update`: regenerate render command goldens.

Useful filters:

- `RITO_BOOK_LIMIT=1 pnpm test:golden:render`
- `RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:render`
- `RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:render:update`

## Selection Policy

Each book/config suite always includes the first and last pages. It also selects
the strongest page for each render feature found in that paginated result:

- text
- image and inline image atom
- ruby annotation
- horizontal rule
- inline background, border, shadow, and decoration
- block background, border, transform, opacity, and clipping

Each selected page is rendered at DPR 1 and DPR 2.
