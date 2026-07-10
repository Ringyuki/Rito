import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOOK_FIXTURE_ROOT,
  LAYOUT_GOLDEN_ROOT,
  readBookManifest,
  type BookFixture,
} from '../golden-books/helpers/book-manifest';
import { goldenFilePath } from '../golden-books/helpers/golden-file';
import { getAllGoldenBookConfigs } from '../golden-books/helpers/golden-configs';
import {
  renderGoldenFilePath,
  RENDER_GOLDEN_ROOT,
} from '../golden-render/helpers/render-golden-file';
import {
  getCommittedPixelRunCountPerBook,
  getAllPixelGoldenProfiles,
  getAllFullPixelGoldenRuns,
  getAllPixelGoldenRuns,
  getAllPixelLineBreaking,
  type PixelGoldenRun,
} from '../golden-pixel/helpers/pixel-cases';
import { COMMITTED_PIXEL_GOLDEN_ROOT } from '../golden-pixel/helpers/pixel-golden-file';
import { pixelSpreadIndexesForSelection } from '../golden-pixel/helpers/pixel-spread-selection';

const GOLDEN_CONFIGS = getAllGoldenBookConfigs();
const GOLDEN_ROOT = resolve(LAYOUT_GOLDEN_ROOT, '..');

describe('golden inventory', () => {
  const books = readBookManifest();

  it('keeps book fixtures flat and registered in the manifest', () => {
    const expected = new Set(['manifest.json', ...books.map((book) => book.path)]);
    const entries = readdirSync(BOOK_FIXTURE_ROOT, { withFileTypes: true }).filter(
      (entry) => !entry.name.startsWith('.'),
    );

    expect(uniqueValues(books.map((book) => book.id))).toHaveLength(books.length);
    expect(uniqueValues(books.map((book) => book.path))).toHaveLength(books.length);
    expect(entries.every((entry) => entry.isFile())).toBe(true);
    expect(entries.map((entry) => entry.name).sort()).toEqual([...expected].sort());

    for (const book of books) {
      expect(book.path).toMatch(/\.epub$/u);
      expect(book.path).not.toContain('/');
      expect(existsSync(resolve(BOOK_FIXTURE_ROOT, book.path))).toBe(true);
    }
  });

  it('keeps the golden root organized by output layer', () => {
    const entries = readdirSync(GOLDEN_ROOT, { withFileTypes: true }).filter(
      (entry) => !entry.name.startsWith('.'),
    );
    expect(entries.every((entry) => entry.isDirectory())).toBe(true);
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'layout',
      'pixels',
      'render-commands',
    ]);
  });

  it('has exactly one layout golden per golden fixture and config', () => {
    const goldenBooks = enabledTierBooks(books, 'golden');
    const expected = expectedLayoutGoldenFiles(goldenBooks);
    expect(relativeFiles(LAYOUT_GOLDEN_ROOT)).toEqual(expected);
  });

  it('has exactly one render command golden per render fixture and config', () => {
    const renderBooks = enabledTierBooks(books, 'render');
    const expected = expectedRenderGoldenFiles(renderBooks);
    expect(relativeFiles(RENDER_GOLDEN_ROOT)).toEqual(expected);
  });

  it('defines committed pixel runs for every render fixture, profile, and line breaker', () => {
    const runs = getAllPixelGoldenRuns();
    const renderBookIds = new Set(enabledTierBooks(books, 'render').map((book) => book.id));
    const expectedRunCount = renderBookIds.size * getCommittedPixelRunCountPerBook();

    expect(uniqueValues(runs.map((run) => run.id))).toHaveLength(runs.length);
    expect(runs).toHaveLength(expectedRunCount);
    expect(runs.every((run) => renderBookIds.has(run.bookId))).toBe(true);
  });

  it('keeps representative frontmatter and body coverage in every committed pixel run', () => {
    const frontmatterCounts = new Map(
      enabledTierBooks(books, 'render').map((book) => [book.id, book.pixelFrontmatterSpreadCount]),
    );

    for (const run of getAllPixelGoldenRuns()) {
      expect(run.spreadSelection.mode, run.id).toBe('key');
      expect(run.spreadSelection.frontmatterSpreadCount, run.id).toBe(
        frontmatterCounts.get(run.bookId),
      );
    }
  });

  it('defines optional full pixel runs for every render fixture, profile, and line breaker', () => {
    const runs = getAllFullPixelGoldenRuns();
    const renderBookIds = new Set(enabledTierBooks(books, 'render').map((book) => book.id));
    const expectedRunCount =
      renderBookIds.size * getAllPixelGoldenProfiles().length * getAllPixelLineBreaking().length;

    expect(uniqueValues(runs.map((run) => run.id))).toHaveLength(runs.length);
    expect(runs).toHaveLength(expectedRunCount);
    expect(runs.every((run) => renderBookIds.has(run.bookId))).toBe(true);
  });

  it('keeps pixel goldens grouped by book directories', () => {
    const entries = readdirSync(COMMITTED_PIXEL_GOLDEN_ROOT, { withFileTypes: true }).filter(
      (entry) => !entry.name.startsWith('.'),
    );
    const renderBookIds = enabledTierBooks(books, 'render')
      .map((book) => book.id)
      .sort();

    expect(entries.every((entry) => entry.isDirectory())).toBe(true);
    expect(entries.map((entry) => entry.name).sort()).toEqual(renderBookIds);
  });

  it('has exactly one committed pixel summary per committed run', () => {
    const runs = getAllPixelGoldenRuns();
    const expected = runs.map(expectedPixelSummaryFile).sort();
    const actual = relativeFiles(COMMITTED_PIXEL_GOLDEN_ROOT)
      .filter((file) => file.endsWith('/summary.json'))
      .sort();

    expect(actual).toEqual(expected);
  });

  it('stores exactly the selected primary pixel baselines for each run', () => {
    for (const run of getAllPixelGoldenRuns()) {
      const runDir = resolve(
        COMMITTED_PIXEL_GOLDEN_ROOT,
        run.bookId,
        run.profile.id,
        run.lineBreaking,
      );
      const summary = JSON.parse(readFile(resolve(runDir, 'summary.json'))) as {
        readonly totalSpreads: number;
      };
      const expected = pixelSpreadIndexesForSelection(run.spreadSelection, summary.totalSpreads);
      const actual = readdirSync(runDir)
        .map(primaryPixelSpreadIndex)
        .filter((index): index is number => index !== undefined)
        .sort((a, b) => a - b);

      expect(actual, run.id).toEqual(expected);
    }
  });
});

function readFile(path: string): string {
  return readFileSync(path, 'utf8');
}

function primaryPixelSpreadIndex(file: string): number | undefined {
  const match = /^spread-(\d{4})\.png$/u.exec(file);
  return match ? Number(match[1]) : undefined;
}

function enabledTierBooks(
  books: readonly BookFixture[],
  tier: BookFixture['tiers'][number],
): readonly BookFixture[] {
  return books.filter((book) => book.enabled && book.tiers.includes(tier));
}

function expectedLayoutGoldenFiles(books: readonly BookFixture[]): readonly string[] {
  return books
    .flatMap((book) => GOLDEN_CONFIGS.map((config) => goldenFilePath(book, config)))
    .map((file) => relativeFile(LAYOUT_GOLDEN_ROOT, file))
    .sort();
}

function expectedRenderGoldenFiles(books: readonly BookFixture[]): readonly string[] {
  return books
    .flatMap((book) => GOLDEN_CONFIGS.map((config) => renderGoldenFilePath(book, config)))
    .map((file) => relativeFile(RENDER_GOLDEN_ROOT, file))
    .sort();
}

function expectedPixelSummaryFile(run: PixelGoldenRun): string {
  return `${run.bookId}/${run.profile.id}/${run.lineBreaking}/summary.json`;
}

function relativeFiles(root: string): readonly string[] {
  return collectFiles(root)
    .map((file) => relativeFile(root, file))
    .sort();
}

function collectFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

function relativeFile(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function uniqueValues(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
