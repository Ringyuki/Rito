import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEpub } from '../../../src/runtime/load-epub';
import type { EpubDocument } from '../../../src/runtime/types';
import { createLogger } from '../../../src/utils/logger';
import type { BookFixture } from './book-manifest';
import { BOOK_FIXTURE_ROOT } from './book-manifest';

export interface LoadedBookFixture {
  readonly byteLength: number;
  readonly document: EpubDocument;
}

export async function loadBookFixture(
  book: BookFixture,
  maxChapters?: number,
): Promise<LoadedBookFixture> {
  const bytes = await readFile(resolve(BOOK_FIXTURE_ROOT, book.path));
  return {
    byteLength: bytes.byteLength,
    document: loadEpub(toArrayBuffer(bytes), {
      logger: createLogger('silent'),
      ...(maxChapters !== undefined ? { maxChapters } : {}),
    }),
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
