import { paginateWithMeta } from '../../../src/runtime/paginate';
import type { PaginationResult } from '../../../src/runtime/types';
import { createLogger } from '../../../src/utils/logger';
import { createMockTextMeasurer } from '../../helpers/mock-text-measurer';
import type { LoadedBookFixture } from './book-loader';
import type { GoldenBookConfig } from './golden-configs';

const SILENT_LOGGER = createLogger('silent');

export function paginateLoadedBook(
  loaded: LoadedBookFixture,
  config: GoldenBookConfig,
): PaginationResult {
  return paginateWithMeta(
    loaded.document,
    config.layout,
    createMockTextMeasurer(),
    undefined,
    config.lineBreaking,
    SILENT_LOGGER,
  );
}
