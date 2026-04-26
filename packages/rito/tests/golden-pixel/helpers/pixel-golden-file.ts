import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PixelGoldenRun, PixelGoldenSummary } from './pixel-cases';

export interface PixelGoldenSpreadAlternative {
  readonly label: string;
  readonly png: Buffer;
}

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
export const COMMITTED_PIXEL_GOLDEN_ROOT = resolve(HELPER_DIR, '../../golden/pixels');
const FULL_PIXEL_GOLDEN_ROOT = resolve(HELPER_DIR, '../../../test-results/pixel-full-baselines');
export const PIXEL_GOLDEN_ROOT = pixelGoldenRoot();
const PRIMARY_SPREAD_GOLDEN_RE = /^spread-\d{4}\.png$/u;

export const SHOULD_RUN_PIXEL_GOLDEN = process.env['RITO_PIXEL_GOLDEN'] === '1';
export const SHOULD_UPDATE_PIXEL_GOLDEN = process.env['RITO_UPDATE_GOLDEN'] === '1';
export const SHOULD_REVIEW_PIXEL_GOLDEN = process.env['RITO_PIXEL_REVIEW'] === '1';
export const SHOULD_WRITE_PIXEL_DIAGNOSTICS = process.env['RITO_PIXEL_DIAGNOSTICS'] === '1';

export function pixelGoldenRunDir(run: PixelGoldenRun): string {
  return resolve(PIXEL_GOLDEN_ROOT, run.bookId, run.profile.id, run.lineBreaking);
}

export function pixelGoldenSummaryFilePath(run: PixelGoldenRun): string {
  return resolve(pixelGoldenRunDir(run), 'summary.json');
}

export function pixelGoldenSpreadFilePath(run: PixelGoldenRun, spreadIndex: number): string {
  return resolve(pixelGoldenRunDir(run), `${spreadFileName(spreadIndex)}.png`);
}

export function pixelGoldenSpreadAlternativeFilePath(
  run: PixelGoldenRun,
  spreadIndex: number,
  label: string,
): string {
  return resolve(pixelGoldenRunDir(run), `${spreadFileName(spreadIndex)}.alt-${label}.png`);
}

export async function readPixelGoldenSummary(
  run: PixelGoldenRun,
): Promise<PixelGoldenSummary | undefined> {
  const content = await readOptionalFile(pixelGoldenSummaryFilePath(run));
  if (!content) return undefined;
  return JSON.parse(content.toString('utf8')) as PixelGoldenSummary;
}

export async function writePixelGoldenSummary(
  run: PixelGoldenRun,
  summary: PixelGoldenSummary,
): Promise<void> {
  const path = pixelGoldenSummaryFilePath(run);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`);
}

export async function clearPixelGoldenPrimaryFiles(run: PixelGoldenRun): Promise<void> {
  await clearPixelGoldenPrimaryFilesInDir(pixelGoldenRunDir(run));
}

export async function clearPixelGoldenPrimaryFilesInDir(dir: string): Promise<void> {
  const entries = await readOptionalDirEntries(dir);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isPrimaryPixelGoldenFile(entry.name))
      .map((entry) => rm(resolve(dir, entry.name), { force: true })),
  );
}

export async function readPixelGoldenSpread(
  run: PixelGoldenRun,
  spreadIndex: number,
): Promise<Buffer | undefined> {
  return readOptionalFile(pixelGoldenSpreadFilePath(run, spreadIndex));
}

export async function readPixelGoldenSpreadAlternatives(
  run: PixelGoldenRun,
  spreadIndex: number,
): Promise<readonly PixelGoldenSpreadAlternative[]> {
  const dir = pixelGoldenRunDir(run);
  const prefix = `${spreadFileName(spreadIndex)}.alt-`;
  const suffix = '.png';
  const files = await readOptionalDir(dir);
  return Promise.all(
    files
      .filter((file) => file.startsWith(prefix) && file.endsWith(suffix))
      .sort()
      .map(async (file) => ({
        label: file.slice(prefix.length, -suffix.length),
        png: await readFile(resolve(dir, file)),
      })),
  );
}

export async function writePixelGoldenSpread(
  run: PixelGoldenRun,
  spreadIndex: number,
  content: Buffer,
): Promise<void> {
  const path = pixelGoldenSpreadFilePath(run, spreadIndex);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export function spreadFileName(spreadIndex: number): string {
  return `spread-${String(spreadIndex).padStart(4, '0')}`;
}

function pixelGoldenRoot(): string {
  const configured = process.env['RITO_PIXEL_BASELINE_ROOT'];
  if (configured && configured.length > 0) return resolve(configured);
  if (process.env['RITO_PIXEL_SCOPE'] === 'full') return FULL_PIXEL_GOLDEN_ROOT;
  return COMMITTED_PIXEL_GOLDEN_ROOT;
}

async function readOptionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readOptionalDir(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readOptionalDirEntries(path: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}

function isPrimaryPixelGoldenFile(file: string): boolean {
  return file === 'summary.json' || PRIMARY_SPREAD_GOLDEN_RE.test(file);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
