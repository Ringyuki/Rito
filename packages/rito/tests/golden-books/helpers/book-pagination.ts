import { paginateWithMeta } from '../../../src/reference/ts-core/runtime/paginate';
import type { PaginationResult } from '../../../src/reference/ts-core/runtime/types';
import { createLogger } from '../../../src/reference/ts-core/utils/logger';
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
    loaded.imageDimensions,
    config.lineBreaking,
    SILENT_LOGGER,
  );
}
