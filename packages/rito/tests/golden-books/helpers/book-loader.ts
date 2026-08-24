import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ImageDimensions } from '../../../src/reference/ts-core/layout/core/types';
import { loadEpub } from '../../../src/reference/ts-core/runtime/load-epub';
import type { EpubDocument } from '../../../src/reference/ts-core/runtime/types';
import { createLogger } from '../../../src/reference/ts-core/utils/logger';
import type { BookFixture } from './book-manifest';
import { BOOK_FIXTURE_ROOT } from './book-manifest';
import { extractImageDimensions } from './image-dimensions';

export interface LoadedBookFixture {
  readonly byteLength: number;
  readonly document: EpubDocument;
  readonly imageDimensions: ReadonlyMap<string, ImageDimensions>;
}

export async function loadBookFixture(
  book: BookFixture,
  maxChapters?: number,
): Promise<LoadedBookFixture> {
  const bytes = await readFile(resolve(BOOK_FIXTURE_ROOT, book.path));
  const document = loadEpub(toArrayBuffer(bytes), {
    logger: createLogger('silent'),
    ...(maxChapters !== undefined ? { maxChapters } : {}),
  });
  return {
    byteLength: bytes.byteLength,
    document,
    imageDimensions: extractImageDimensions(document.images),
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
