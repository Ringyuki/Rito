// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}

import { describe, expect, it } from 'vitest';
import { readBookManifest } from '../golden-books/helpers/book-manifest';
import { loadBookFixture } from '../golden-books/helpers/book-loader';
import { paginateLoadedBook } from '../golden-books/helpers/book-pagination';
import { getGoldenBookConfigById } from '../golden-books/helpers/golden-configs';

const KP_PAGINATION_BUDGET_MS = 20_000;

describe('KP real EPUB performance', () => {
  it(
    'paginates a real long-form EPUB in optimal mode within budget',
    async () => {
      const book = readBookManifest().find((fixture) => fixture.id === 'book-04');
      const config = getGoldenBookConfigById('default.optimal');
      if (!book) throw new Error('book-04 fixture is required for KP performance coverage');
      if (!config)
        throw new Error('default.optimal config is required for KP performance coverage');

      const loaded = await loadBookFixture(book);
      try {
        const startedAt = performance.now();
        const result = paginateLoadedBook(loaded, config);
        const elapsedMs = performance.now() - startedAt;

        expect(result.pages.length).toBeGreaterThan(100);
        expect(elapsedMs).toBeLessThan(KP_PAGINATION_BUDGET_MS);
      } finally {
        loaded.document.close();
      }
    },
    KP_PAGINATION_BUDGET_MS + 10_000,
  );
});
