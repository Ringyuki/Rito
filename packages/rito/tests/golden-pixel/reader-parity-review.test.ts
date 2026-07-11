import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { PixelGoldenProfile } from './helpers/pixel-cases';
import { PIXEL_PROFILES } from './helpers/pixel-profile-config';
import {
  READER_PARITY_REVIEW_REPORT,
  reviewReaderParityRun,
  reviewReaderParityRunError,
} from './helpers/reader-parity-review';
import { renderReaderParityRun } from './helpers/reader-parity-render';
import type { ReaderParityRun } from './helpers/reader-parity-render';
import { startPixelRenderServer, type PixelRenderServer } from './helpers/render-server';
import type { PixelReviewRecord } from './helpers/pixel-review';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DEMO_EPUB_PATH = resolve(TEST_DIR, '../../../../apps/reader/src/assets/demo.epub');
const DEMO_FRONTMATTER_SPREAD_COUNT = 8;
const SHOULD_RUN_READER_PARITY_REVIEW = process.env['RITO_READER_PARITY_REVIEW'] === '1';
const DEMO_PROFILE_IDS = [
  'single-default',
  'single-narrow',
  'single-wide',
  'single-default-dpr2',
  'double-default',
] as const;
const DEMO_BODY_REGRESSION_QUERIES = [
  '有天使（毒舌系）在病床边照料自己',
  '不看猫眼也知道是谁拜访',
] as const;
const SELECTED_PROFILE_IDS = selectedProfileIds();
const SELECTED_SPREAD_INDEXES = selectedSpreadIndexes();
const QUERY_ONLY = process.env['RITO_READER_PARITY_QUERY_ONLY'] === '1';
const CAPTURE_TEXT_DRAWS = process.env['RITO_READER_PARITY_CAPTURE_TEXT_DRAWS'] === '1';
const DEMO_RUNS = SELECTED_PROFILE_IDS.map(createDemoRun);
const READER_PARITY_REVIEW_TIMEOUT_MS = 30 * 60_000;

if (DEMO_RUNS.length === 0) {
  throw new Error(
    `RITO_READER_PARITY_PROFILES did not select a supported profile: ${DEMO_PROFILE_IDS.join(', ')}`,
  );
}

test.describe('real-book reader pixel parity review', () => {
  const reviewRecords: PixelReviewRecord[] = [];
  let server: PixelRenderServer | undefined;

  test.skip(
    !SHOULD_RUN_READER_PARITY_REVIEW,
    'Set RITO_READER_PARITY_REVIEW=1 to run the real-book parity review',
  );

  test.beforeAll(async () => {
    await READER_PARITY_REVIEW_REPORT.reset();
    server = await startPixelRenderServer();
  });

  test.afterAll(async () => {
    try {
      const indexPath = await READER_PARITY_REVIEW_REPORT.writeIndex(reviewRecords);
      console.log(`Reader parity review report: ${indexPath}`);
    } finally {
      await server?.close();
    }
  });

  test('renders every demo profile through TS reference and Rust production', async ({ page }) => {
    test.setTimeout(READER_PARITY_REVIEW_TIMEOUT_MS);
    if (!server) throw new Error('Pixel render server did not start');
    const bookBytes = await readFile(DEMO_EPUB_PATH);

    for (const run of DEMO_RUNS) {
      try {
        const result = await renderReaderParityRun(page, server.origin, run, bookBytes);
        if (result.textDraws)
          console.log(`Reader parity text draws: ${JSON.stringify(result.textDraws)}`);
        const records = await reviewReaderParityRun(READER_PARITY_REVIEW_REPORT, run, result);
        reviewRecords.push(...records);
      } catch (error) {
        reviewRecords.push(
          await reviewReaderParityRunError(READER_PARITY_REVIEW_REPORT, run, error),
        );
      }
    }

    expect(reviewRecords.length).toBeGreaterThanOrEqual(DEMO_RUNS.length);
    expect([...new Set(reviewRecords.map((record) => record.runId))].sort()).toEqual(
      DEMO_RUNS.map((run) => run.id).sort(),
    );
    expect(
      reviewRecords
        .filter((record) => record.status !== 'pass')
        .map((record) => ({
          profileId: record.profileId,
          spreadIndex: record.spreadIndex,
          status: record.status,
          diffPixels: record.diffPixels,
          diffRatio: record.diffRatio,
          error: record.error,
        })),
    ).toEqual([]);
  });
});

function createDemoRun(profileId: (typeof DEMO_PROFILE_IDS)[number]): ReaderParityRun {
  return {
    id: `reader-demo-${profileId}-greedy`,
    bookId: 'reader-demo',
    profile: requirePixelProfile(profileId),
    lineBreaking: 'greedy',
    tags: ['reader-parity', 'demo-book', 'ts-reference-expected', 'rust-production-actual'],
    spreadQueries: SELECTED_SPREAD_INDEXES.length > 0 ? [] : DEMO_BODY_REGRESSION_QUERIES,
    captureTextDraws: CAPTURE_TEXT_DRAWS,
    spreadSelection: {
      mode:
        SELECTED_SPREAD_INDEXES.length > 0 || QUERY_ONLY
          ? 'explicit'
          : profileId === 'single-default'
            ? 'all'
            : 'key',
      indexes: SELECTED_SPREAD_INDEXES,
      frontmatterSpreadCount: DEMO_FRONTMATTER_SPREAD_COUNT,
    },
  };
}

function selectedProfileIds(): readonly (typeof DEMO_PROFILE_IDS)[number][] {
  const selected = new Set(
    (process.env['RITO_READER_PARITY_PROFILES'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return selected.size === 0
    ? DEMO_PROFILE_IDS
    : DEMO_PROFILE_IDS.filter((profileId) => selected.has(profileId));
}

function selectedSpreadIndexes(): readonly number[] {
  return (process.env['RITO_READER_PARITY_SPREADS'] ?? '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0);
}

function requirePixelProfile(id: string): PixelGoldenProfile {
  const profile = PIXEL_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Missing pixel profile: ${id}`);
  return profile;
}
