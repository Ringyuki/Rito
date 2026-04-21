// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}

import { describe, expect, it } from 'vitest';
import { getBookFixtures } from './helpers/book-manifest';
import { loadBookFixture } from './helpers/book-loader';
import { paginateLoadedBook } from './helpers/book-pagination';
import { summarizeGoldenBook } from './helpers/book-summary';
import { getGoldenBookConfigs } from './helpers/golden-configs';
import {
  readGoldenFile,
  SHOULD_RUN_BOOK_TESTS,
  SHOULD_UPDATE_GOLDEN,
  stringifyGolden,
  writeGoldenFile,
} from './helpers/golden-file';

const BOOK_TEST_TIMEOUT_MS = 180_000;
const describeBooks = SHOULD_RUN_BOOK_TESTS ? describe : describe.skip;

describeBooks('golden book layout snapshots', () => {
  const books = getBookFixtures('golden');
  const configs = getGoldenBookConfigs();

  it('has enabled book fixtures and configs', () => {
    expect(books.length).toBeGreaterThan(0);
    expect(configs.length).toBeGreaterThan(0);
  });

  for (const book of books) {
    for (const config of configs) {
      it(
        `${book.id} ${config.id}`,
        async () => {
          const loaded = await loadBookFixture(book, book.goldenMaxChapters);
          try {
            const result = paginateLoadedBook(loaded, config);
            const summary = summarizeGoldenBook(
              book,
              loaded.byteLength,
              loaded.document,
              result,
              config,
            );
            const actual = stringifyGolden(summary);

            if (SHOULD_UPDATE_GOLDEN) {
              await writeGoldenFile(book, config, actual);
              return;
            }

            const expected = await readGoldenFile(book, config);
            expect(expected, 'Run pnpm test:golden:books:update to create/update this golden').toBe(
              actual,
            );
          } finally {
            loaded.document.close();
          }
        },
        BOOK_TEST_TIMEOUT_MS,
      );
    }
  }
});
