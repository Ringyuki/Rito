import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BookFixture } from '../../golden-books/helpers/book-manifest';
import { stableStringify, type JsonValue } from '../../golden-books/helpers/canonicalize';
import type { GoldenBookConfig } from '../../golden-books/helpers/golden-configs';

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
export const RENDER_GOLDEN_ROOT = resolve(HELPER_DIR, '../../golden/render-commands');

export const SHOULD_RUN_RENDER_GOLDEN = process.env['RITO_RENDER_GOLDEN'] === '1';
export const SHOULD_UPDATE_RENDER_GOLDEN = process.env['RITO_UPDATE_GOLDEN'] === '1';

export function renderGoldenFilePath(book: BookFixture, config: GoldenBookConfig): string {
  return resolve(RENDER_GOLDEN_ROOT, book.id, `${config.id}.json`);
}

export function stringifyRenderGolden(value: JsonValue): string {
  return stableStringify(value);
}

export async function readRenderGoldenFile(
  book: BookFixture,
  config: GoldenBookConfig,
): Promise<string | undefined> {
  try {
    return await readFile(renderGoldenFilePath(book, config), 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeRenderGoldenFile(
  book: BookFixture,
  config: GoldenBookConfig,
  content: string,
): Promise<void> {
  const path = renderGoldenFilePath(book, config);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
