// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}

import { describe, expect, it } from 'vitest';
import { getBookFixtures } from '../golden-books/helpers/book-manifest';
import { loadBookFixture } from '../golden-books/helpers/book-loader';
import { paginateLoadedBook } from '../golden-books/helpers/book-pagination';
import { getGoldenBookConfigs } from '../golden-books/helpers/golden-configs';
import { summarizeRenderCommandSuite } from './helpers/render-command-summary';
import {
  readRenderGoldenFile,
  SHOULD_RUN_RENDER_GOLDEN,
  SHOULD_UPDATE_RENDER_GOLDEN,
  stringifyRenderGolden,
  writeRenderGoldenFile,
} from './helpers/render-golden-file';
import { selectRenderPageCases } from './helpers/render-page-selection';

const RENDER_TEST_TIMEOUT_MS = 180_000;
const describeRender = SHOULD_RUN_RENDER_GOLDEN ? describe : describe.skip;

describeRender('golden render command snapshots', () => {
  const books = getBookFixtures('render');
  const configs = getGoldenBookConfigs();

  it('has enabled render fixtures and configs', () => {
    expect(books.length).toBeGreaterThan(0);
    expect(configs.length).toBeGreaterThan(0);
  });

  for (const book of books) {
    for (const config of configs) {
      it(
        `${book.id} ${config.id}`,
        async () => {
          const loaded = await loadBookFixture(book);
          try {
            const result = paginateLoadedBook(loaded, config);
            const cases = selectRenderPageCases(result.pages, book.id, config.id);
            expect(cases.length).toBeGreaterThan(0);
            const summary = summarizeRenderCommandSuite(
              book,
              loaded.document,
              result,
              config,
              cases,
            );
            const actual = stringifyRenderGolden(summary);

            if (SHOULD_UPDATE_RENDER_GOLDEN) {
              await writeRenderGoldenFile(book, config, actual);
              return;
            }

            const expected = await readRenderGoldenFile(book, config);
            expect(
              expected,
              'Run pnpm test:golden:render:update to create/update this golden',
            ).toBe(actual);
          } finally {
            loaded.document.close();
          }
        },
        RENDER_TEST_TIMEOUT_MS,
      );
    }
  }
});
