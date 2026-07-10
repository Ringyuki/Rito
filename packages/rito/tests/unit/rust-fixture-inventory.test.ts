import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

interface RustFixtureManifest {
  readonly schemaVersion: number;
  readonly kind: string;
  readonly entries: readonly RustFixtureManifestEntry[];
}

interface RustFixtureManifestEntry {
  readonly bookId: string;
  readonly configId: string;
  readonly path: string;
}

const FIXTURE_ROOT = resolve(import.meta.dirname, '../rust-fixtures');
const EXPECTED_BOOK_IDS = [
  'book-01',
  'book-02',
  'book-03',
  'book-04',
  'book-05',
  'book-06',
  'book-07',
  'book-08',
  'book-09',
  'book-10',
];
const EXPECTED_CONFIG_IDS = ['smoke.greedy', 'default.greedy', 'narrow.greedy', 'default.optimal'];

describe('Rust parity fixture inventory', () => {
  it('has a manifest whose entries point to stable fixture summaries', () => {
    const manifest = readFixtureManifest();

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.kind).toBe('rito-rust-parity-fixture-manifest');
    expect(manifest.entries).toHaveLength(EXPECTED_BOOK_IDS.length * EXPECTED_CONFIG_IDS.length);
    expect(manifest.entries.map((entry) => `${entry.bookId}/${entry.configId}`)).toEqual(
      EXPECTED_BOOK_IDS.flatMap((bookId) =>
        EXPECTED_CONFIG_IDS.map((configId) => `${bookId}/${configId}`),
      ),
    );

    for (const entry of manifest.entries) {
      const fixturePath = resolve(FIXTURE_ROOT, entry.path);
      expect(fixturePath.startsWith(FIXTURE_ROOT)).toBe(true);
      expect(existsSync(fixturePath), `${entry.path} exists`).toBe(true);

      const fixture = JSON.parse(gunzipSync(readFileSync(fixturePath)).toString('utf8')) as Record<
        string,
        unknown
      >;
      expect(fixture['schemaVersion']).toBe(1);
      expect(fixture['kind']).toBe('rito-rust-parity-fixture');
      expect(fixture['generatedAt']).toBeUndefined();
      expect(fixture['book']).toMatchObject({ id: entry.bookId });
      expect(fixture['config']).toMatchObject({ id: entry.configId });
      expect(fixture['package']).toBeDefined();
      expect(fixture['resources']).toBeDefined();
      expect(fixture['chapters']).toBeDefined();
      expect(isRustFixtureXhtmlSummary(fixture['xhtml'])).toBe(true);
      expect(hasStableStylesheetMetadata(fixture['xhtml'])).toBe(true);
      expect(isRustFixtureCssSummary(fixture['css'])).toBe(true);
      expect(isRustFixtureStyleSummary(fixture['style'])).toBe(true);
    }
  }, 15000);

  it('covers embedded stylesheets and absent external stylesheet metadata', () => {
    const embedded = readFixture('book-06/default.greedy.json.gz');
    const missingExternal = readFixture('book-10/default.greedy.json.gz');

    expect(chapterRecords(embedded['xhtml']).filter(hasEmbeddedStylesheets)).toHaveLength(2);
    expect(chapterRecords(missingExternal['xhtml']).some(hasMissingStylesheetHrefs)).toBe(true);
  });
});

function readFixtureManifest(): RustFixtureManifest {
  const parsed = JSON.parse(
    readFileSync(resolve(FIXTURE_ROOT, 'manifest.json'), 'utf8'),
  ) as unknown;
  if (!isRustFixtureManifest(parsed)) throw new Error('Invalid Rust fixture manifest');
  return parsed;
}

function readFixture(path: string): Record<string, unknown> {
  return JSON.parse(
    gunzipSync(readFileSync(resolve(FIXTURE_ROOT, path))).toString('utf8'),
  ) as Record<string, unknown>;
}

function isRustFixtureManifest(value: unknown): value is RustFixtureManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record['schemaVersion'] === 1 &&
    record['kind'] === 'rito-rust-parity-fixture-manifest' &&
    Array.isArray(record['entries'])
  );
}

function isRustFixtureXhtmlSummary(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['chapterCount'] === 'number' &&
    Array.isArray(record['chapters']) &&
    typeof record['fullDetailHash'] === 'string'
  );
}

function hasStableStylesheetMetadata(value: unknown): boolean {
  return chapterRecords(value).every((chapter) => {
    return (
      Object.hasOwn(chapter, 'embeddedStylesheets') &&
      isOptionalStringList(chapter['embeddedStylesheets']) &&
      Object.hasOwn(chapter, 'stylesheetHrefs') &&
      isOptionalStringList(chapter['stylesheetHrefs'])
    );
  });
}

function chapterRecords(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const chapters = (value as Record<string, unknown>)['chapters'];
  if (!Array.isArray(chapters)) return [];
  return chapters.filter(isRecord);
}

function isOptionalStringList(value: unknown): boolean {
  return (
    value === null || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function hasEmbeddedStylesheets(chapter: Record<string, unknown>): boolean {
  const stylesheets = chapter['embeddedStylesheets'];
  return Array.isArray(stylesheets) && stylesheets.length > 0;
}

function hasMissingStylesheetHrefs(chapter: Record<string, unknown>): boolean {
  return chapter['stylesheetHrefs'] === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRustFixtureCssSummary(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['stylesheetCount'] === 'number' &&
    Array.isArray(record['stylesheets']) &&
    typeof record['fullDetailHash'] === 'string'
  );
}

function isRustFixtureStyleSummary(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const selectorMatches = record['selectorMatches'];
  if (
    typeof selectorMatches !== 'object' ||
    selectorMatches === null ||
    Array.isArray(selectorMatches)
  ) {
    return false;
  }
  const selectorRecord = selectorMatches as Record<string, unknown>;
  return (
    typeof selectorRecord['chapterCount'] === 'number' &&
    Array.isArray(selectorRecord['chapters']) &&
    typeof selectorRecord['fullDetailHash'] === 'string'
  );
}
