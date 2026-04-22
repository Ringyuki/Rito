import { existsSync, readdirSync } from 'node:fs';
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
import { getAllPixelGoldenCases } from '../golden-pixel/helpers/pixel-cases';
import { pixelGoldenFilePath, PIXEL_GOLDEN_ROOT } from '../golden-pixel/helpers/pixel-golden-file';

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

  it('has exactly one pixel golden per pixel case', () => {
    const cases = getAllPixelGoldenCases();
    const renderBookIds = new Set(enabledTierBooks(books, 'render').map((book) => book.id));
    const expected = cases.map((testCase) => relativePixelGoldenFile(testCase)).sort();

    expect(uniqueValues(cases.map((testCase) => testCase.id))).toHaveLength(cases.length);
    expect(cases.every((testCase) => renderBookIds.has(testCase.bookId))).toBe(true);
    expect(relativeFiles(PIXEL_GOLDEN_ROOT)).toEqual(expected);
  });
});

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

function relativeFiles(root: string): readonly string[] {
  return collectFiles(root)
    .map((file) => relativeFile(root, file))
    .sort();
}

function relativePixelGoldenFile(testCase: ReturnType<typeof getAllPixelGoldenCases>[number]) {
  return relativeFile(PIXEL_GOLDEN_ROOT, pixelGoldenFilePath(testCase));
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
