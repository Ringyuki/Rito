# Golden Book Fixtures

This directory contains the opt-in full-book regression tests. Normal
`pnpm test` skips these tests unless `RITO_BOOK_TESTS=1` is set.

## Fixture Layout

- Put EPUB files in `packages/rito/tests/fixtures/books/epubs/`.
- Register every book in `packages/rito/tests/fixtures/books/manifest.json`.
- Generated golden files live under
  `packages/rito/tests/golden/books/<book-id>/<config-id>.json`.

## Manifest Tiers

- `smoke`: loads the book and paginates the first few chapters with one compact
  config. Use this for broad fixture coverage.
- `golden`: paginates the complete book and compares structured layout
  summaries across all golden configs.
- `quarantine`: keeps known unsupported books in the suite with an expected
  failure stage and message. Move a book out of quarantine when the parser or
  layout layer supports it.

## Commands

- `pnpm test:golden:books:smoke`: quick fixture health check.
- `pnpm test:golden:books:update`: regenerate layout golden files.
- `pnpm test:golden:books`: compare smoke, golden, and quarantine tests.

Useful filters:

- `RITO_BOOK_LIMIT=1 pnpm test:golden:books`
- `RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:books:update`
