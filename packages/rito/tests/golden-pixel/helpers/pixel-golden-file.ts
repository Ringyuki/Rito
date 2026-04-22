import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PixelGoldenCase } from './pixel-cases';

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
export const PIXEL_GOLDEN_ROOT = resolve(HELPER_DIR, '../../golden/pixels');

export const SHOULD_RUN_PIXEL_GOLDEN = process.env['RITO_PIXEL_GOLDEN'] === '1';
export const SHOULD_UPDATE_PIXEL_GOLDEN = process.env['RITO_UPDATE_GOLDEN'] === '1';

export function pixelGoldenFilePath(testCase: PixelGoldenCase): string {
  return resolve(PIXEL_GOLDEN_ROOT, `${testCase.id}.png`);
}

export async function readPixelGoldenFile(testCase: PixelGoldenCase): Promise<Buffer | undefined> {
  try {
    return await readFile(pixelGoldenFilePath(testCase));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writePixelGoldenFile(
  testCase: PixelGoldenCase,
  content: Buffer,
): Promise<void> {
  const path = pixelGoldenFilePath(testCase);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
