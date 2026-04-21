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

describeBooks('golden book fixture quarantine', () => {
  const books = getBookFixtures('quarantine');

  it('has valid metadata for quarantined fixtures', () => {
    for (const book of books) {
      expect(book.expectedFailure).toBeDefined();
    }
  });

  for (const book of books) {
    it(
      `${book.id} fails for its documented reason`,
      async () => {
        const expectedFailure = book.expectedFailure;
        if (expectedFailure === undefined) {
          throw new Error(`${book.id} is quarantined without expectedFailure metadata`);
        }

        if (expectedFailure.stage === 'load') {
          await expect(loadBookFixture(book, book.goldenMaxChapters)).rejects.toThrow(
            expectedFailure.messageIncludes,
          );
          return;
        }

        const loaded = await loadBookFixture(book, book.goldenMaxChapters);
        try {
          expect(() => paginateLoadedBook(loaded, SMOKE_CONFIG)).toThrow(
            expectedFailure.messageIncludes,
          );
        } finally {
          loaded.document.close();
        }
      },
      BOOK_TEST_TIMEOUT_MS,
    );
  }
});
