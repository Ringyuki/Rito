import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const FONTS_DIR = resolve(WORKSPACE_ROOT, 'apps/reader/src/assets/fonts');

export const PINNED_FACES = [
  {
    fileName: 'Tinos-Regular.ttf',
    mediaType: 'font/ttf',
    expectedSha256: '60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61',
    genericRole: 'serif',
    language: 'und',
  },
  {
    fileName: 'SourceHanSerifCN-Regular.otf',
    mediaType: 'font/otf',
    expectedSha256: '3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d',
    genericRole: 'serif',
    language: 'zh-Hans',
  },
] as const;

/** Mirrors the demo's production layout for the pinned 420x640 fixture run. */
export const BASELINE_LAYOUT = {
  firstPageAlone: true,
  marginBottom: 24,
  marginLeft: 24,
  marginRight: 24,
  marginTop: 24,
  pageHeight: 640,
  pageWidth: 420,
  rootFontSize: 16,
  spreadGap: 0,
  spreadMode: 'single',
  viewportHeight: 640,
  viewportWidth: 420,
  textMeasurement: 'fontAware',
} as const;

export async function pinnedFontBytes(): Promise<Map<string, Buffer>> {
  const entries = await Promise.all(
    PINNED_FACES.map(
      async (face) =>
        [face.expectedSha256, await readFile(resolve(FONTS_DIR, face.fileName))] as const,
    ),
  );
  return new Map(entries);
}

export async function readEpubEntryBytes(epubPath: string, entrySuffix: string): Promise<Buffer> {
  const listing = await execFileAsync('unzip', ['-Z1', epubPath]).catch((error: unknown) => ({
    stdout: (error as Error & { stdout?: string }).stdout ?? '',
  }));
  const entry = listing.stdout
    .split('\n')
    .map((name) => name.trim())
    .find((name) => name.endsWith(entrySuffix));
  if (!entry) throw new Error(`EPUB entry ${entrySuffix} not found in ${epubPath}`);
  const extracted = await execFileAsync('unzip', ['-p', epubPath, entry], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'buffer',
  }).catch((error: unknown) => {
    const stdout = (error as Error & { stdout?: Buffer }).stdout;
    if (!stdout || stdout.length === 0) throw error;
    return { stdout };
  });
  return extracted.stdout;
}

export async function readEpubEntry(epubPath: string, entrySuffix: string): Promise<string> {
  const listing = await execFileAsync('unzip', ['-Z1', epubPath]).catch((error: unknown) => ({
    stdout: (error as Error & { stdout?: string }).stdout ?? '',
  }));
  const entry = listing.stdout
    .split('\n')
    .map((name) => name.trim())
    .find((name) => name.endsWith(entrySuffix));
  if (!entry) throw new Error(`EPUB entry ${entrySuffix} not found in ${epubPath}`);
  const extracted = await execFileAsync('unzip', ['-p', epubPath, entry], {
    maxBuffer: 64 * 1024 * 1024,
  }).catch((error: unknown) => {
    const stdout = (error as Error & { stdout?: string }).stdout;
    if (!stdout) throw error;
    return { stdout };
  });
  return extracted.stdout;
}
