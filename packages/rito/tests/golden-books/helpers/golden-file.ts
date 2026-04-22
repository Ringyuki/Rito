import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { BookFixture } from './book-manifest';
import { LAYOUT_GOLDEN_ROOT } from './book-manifest';
import { stableStringify, type JsonValue } from './canonicalize';
import type { GoldenBookConfig } from './golden-configs';

export const SHOULD_RUN_BOOK_TESTS = process.env['RITO_BOOK_TESTS'] === '1';
export const SHOULD_UPDATE_GOLDEN = process.env['RITO_UPDATE_GOLDEN'] === '1';

export function goldenFilePath(book: BookFixture, config: GoldenBookConfig): string {
  return resolve(LAYOUT_GOLDEN_ROOT, book.id, `${config.id}.json`);
}

export function stringifyGolden(value: JsonValue): string {
  return stableStringify(value);
}

export async function readGoldenFile(
  book: BookFixture,
  config: GoldenBookConfig,
): Promise<string | undefined> {
  try {
    return await readFile(goldenFilePath(book, config), 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeGoldenFile(
  book: BookFixture,
  config: GoldenBookConfig,
  content: string,
): Promise<void> {
  const path = goldenFilePath(book, config);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
