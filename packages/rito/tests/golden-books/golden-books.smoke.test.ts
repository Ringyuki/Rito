// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}

import { describe, expect, it } from 'vitest';
import { getBookFixtures } from './helpers/book-manifest';
import { loadBookFixture } from './helpers/book-loader';
import { paginateLoadedBook } from './helpers/book-pagination';
import { SHOULD_RUN_BOOK_TESTS } from './helpers/golden-file';
import { SMOKE_CONFIG } from './helpers/golden-configs';

const BOOK_TEST_TIMEOUT_MS = 120_000;
const describeBooks = SHOULD_RUN_BOOK_TESTS ? describe : describe.skip;

describeBooks('golden book fixtures smoke', () => {
  const books = getBookFixtures('smoke');

  it('has enabled book fixtures', () => {
    expect(books.length).toBeGreaterThan(0);
  });

  for (const book of books) {
    it(
      `${book.id} loads and paginates first chapters`,
      async () => {
        const loaded = await loadBookFixture(book, book.smokeMaxChapters ?? 3);
        try {
          expect(loaded.byteLength).toBeGreaterThan(0);
          expect(loaded.document.packageDocument.spine.length).toBeGreaterThan(0);
          expect(loaded.document.packageDocument.manifest.length).toBeGreaterThan(0);

          const result = paginateLoadedBook(loaded, SMOKE_CONFIG);

          expect(result.pages.length).toBeGreaterThan(0);
          expect(result.chapterMap.size).toBeGreaterThan(0);
        } finally {
          loaded.document.close();
        }
      },
      BOOK_TEST_TIMEOUT_MS,
    );
  }
});
