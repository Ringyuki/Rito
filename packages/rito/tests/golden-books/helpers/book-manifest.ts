import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BookTier = 'smoke' | 'golden' | 'quarantine' | 'render';
export type ExpectedFailureStage = 'load' | 'paginate';

export interface BookExpectedFailure {
  readonly stage: ExpectedFailureStage;
  readonly messageIncludes: string;
}

export interface BookFixture {
  readonly id: string;
  readonly path: string;
  readonly enabled: boolean;
  readonly tiers: readonly BookTier[];
  readonly smokeMaxChapters?: number;
  readonly goldenMaxChapters?: number;
  readonly pixelFrontmatterSpreadCount?: number;
  readonly expectedFailure?: BookExpectedFailure;
}

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
export const BOOK_FIXTURE_ROOT = resolve(HELPER_DIR, '../../fixtures/books');
export const LAYOUT_GOLDEN_ROOT = resolve(HELPER_DIR, '../../golden/layout');
const MANIFEST_PATH = resolve(BOOK_FIXTURE_ROOT, 'manifest.json');

export function readBookManifest(): readonly BookFixture[] {
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Book fixture manifest must be an array');
  return parsed.map(parseBookFixture);
}

export function getBookFixtures(tier: BookTier): readonly BookFixture[] {
  const limit = parseLimit(process.env['RITO_BOOK_LIMIT']);
  const fixtures = readBookManifest()
    .filter((book) => book.enabled && book.tiers.includes(tier))
    .filter((book) => existsSync(resolve(BOOK_FIXTURE_ROOT, book.path)));
  return limit === undefined ? fixtures : fixtures.slice(0, limit);
}

function parseBookFixture(value: unknown, index: number): BookFixture {
  if (!isRecord(value)) throw new Error(`Book fixture at index ${String(index)} must be an object`);
  const id = readString(value, 'id', index);
  const path = readString(value, 'path', index);
  const enabled = readBoolean(value, 'enabled', index);
  const tiers = readTiers(value, index);
  const smokeMaxChapters = readOptionalPositiveInteger(value, 'smokeMaxChapters', index);
  const goldenMaxChapters = readOptionalPositiveInteger(value, 'goldenMaxChapters', index);
  const pixelFrontmatterSpreadCount = readOptionalPositiveInteger(
    value,
    'pixelFrontmatterSpreadCount',
    index,
  );
  const expectedFailure = readOptionalExpectedFailure(value, index);
  return {
    id,
    path,
    enabled,
    tiers,
    ...(smokeMaxChapters !== undefined ? { smokeMaxChapters } : {}),
    ...(goldenMaxChapters !== undefined ? { goldenMaxChapters } : {}),
    ...(pixelFrontmatterSpreadCount !== undefined ? { pixelFrontmatterSpreadCount } : {}),
    ...(expectedFailure !== undefined ? { expectedFailure } : {}),
  };
}

function readString(record: Readonly<Record<string, unknown>>, key: string, index: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Book fixture ${String(index)} has invalid ${key}`);
  }
  return value;
}

function readBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
  index: number,
): boolean {
  const value = record[key];
  if (typeof value !== 'boolean')
    throw new Error(`Book fixture ${String(index)} has invalid ${key}`);
  return value;
}

function readTiers(record: Readonly<Record<string, unknown>>, index: number): readonly BookTier[] {
  const value = record['tiers'];
  if (!Array.isArray(value)) throw new Error(`Book fixture ${String(index)} has invalid tiers`);
  const tiers: readonly unknown[] = value;
  return tiers.map((tier) => {
    if (tier === 'smoke' || tier === 'golden' || tier === 'quarantine' || tier === 'render')
      return tier;
    throw new Error(`Book fixture ${String(index)} has unknown tier ${String(tier)}`);
  });
}

function readOptionalExpectedFailure(
  record: Readonly<Record<string, unknown>>,
  index: number,
): BookExpectedFailure | undefined {
  const value = record['expectedFailure'];
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw new Error(`Book fixture ${String(index)} has invalid expectedFailure`);
  const stage = readExpectedFailureStage(value, index);
  const messageIncludes = readString(value, 'messageIncludes', index);
  return { stage, messageIncludes };
}

function readExpectedFailureStage(
  record: Readonly<Record<string, unknown>>,
  index: number,
): ExpectedFailureStage {
  const value = record['stage'];
  if (value === 'load' || value === 'paginate') return value;
  throw new Error(`Book fixture ${String(index)} has invalid expectedFailure.stage`);
}

function readOptionalPositiveInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
  index: number,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  throw new Error(`Book fixture ${String(index)} has invalid ${key}`);
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
