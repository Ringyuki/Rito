import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  createPixelSpreadCase,
  type PixelGoldenRun,
  type PixelGoldenSpreadCase,
} from './pixel-cases';
import {
  createPixelReviewReport,
  type PixelReviewRecord,
  type PixelReviewReport,
} from './pixel-review';
import type { PixelRunRenderResult } from './pixel-run-assertions';
import { comparePng } from './png-diff';
import type { ReaderParityRenderResult } from './reader-parity-render';

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
export const READER_PARITY_REVIEW_ROOT = resolve(
  HELPER_DIR,
  '../../../test-results/reader-parity-review',
);

export const READER_PARITY_REVIEW_REPORT = createPixelReviewReport({
  root: READER_PARITY_REVIEW_ROOT,
  heading: 'Rito Reader Parity Review',
  expectedLabel: 'TypeScript reference',
  actualLabel: 'Rust production',
});

const STRICT_PIXEL_THRESHOLD = 0;
const STRICT_MAX_DIFF_PIXEL_RATIO = 0;
const RUN_ERROR_SPREAD_INDEX = -1;

export async function reviewReaderParityRun(
  report: PixelReviewReport,
  run: PixelGoldenRun,
  result: ReaderParityRenderResult,
): Promise<readonly PixelReviewRecord[]> {
  const actualByIndex = spreadMap(result.actual);
  const runError = parityRunError(result);
  const records: PixelReviewRecord[] = [];

  for (const expected of result.expected.spreads) {
    const actual = actualByIndex.get(expected.spreadIndex);
    const testCase = createStrictSpreadCase(
      run,
      expected.spreadIndex,
      result.expected.totalSpreads,
    );
    if (!actual) {
      records.push(
        await report.writeCase({
          testCase,
          expected: expected.png,
          actual: blankPngLike(expected.png),
          error: appendRunError(
            `Rust production did not return spread ${String(expected.spreadIndex)}`,
            runError,
          ),
        }),
      );
      continue;
    }
    const paths = report.casePaths(testCase);
    try {
      const diff = await comparePng(expected.png, actual.png, testCase, paths.diffPath, {
        writeDiffWhenEqual: true,
        includeAntiAliasedPixels: true,
      });
      records.push(
        await report.writeCase({
          testCase,
          expected: expected.png,
          actual: actual.png,
          diff,
          ...(runError ? { error: runError } : {}),
        }),
      );
    } catch (error) {
      records.push(
        await report.writeCase({
          testCase,
          expected: expected.png,
          actual: actual.png,
          error: appendRunError(errorMessage(error), runError),
        }),
      );
    }
  }
  return records;
}

export async function reviewReaderParityRunError(
  report: PixelReviewReport,
  run: PixelGoldenRun,
  error: unknown,
): Promise<PixelReviewRecord> {
  const baseCase = createStrictSpreadCase(run, RUN_ERROR_SPREAD_INDEX, 0);
  const testCase = { ...baseCase, id: `${run.id}-run-error` };
  return await report.writeCase({
    testCase,
    actual: blankPng(1, 1),
    error: errorMessage(error),
  });
}

function spreadMap(
  result: PixelRunRenderResult,
): ReadonlyMap<number, PixelRunRenderResult['spreads'][number]> {
  return new Map(result.spreads.map((spread) => [spread.spreadIndex, spread]));
}

function parityRunError(result: ReaderParityRenderResult): string | undefined {
  const errors: string[] = [];
  if (result.expected.totalSpreads !== result.actual.totalSpreads) {
    errors.push(
      `totalSpreads changed: TS=${String(result.expected.totalSpreads)}, Rust=${String(
        result.actual.totalSpreads,
      )}`,
    );
  }
  if (result.missingActualSpreadIndexes.length > 0) {
    errors.push(`Rust is missing spreads: ${result.missingActualSpreadIndexes.join(', ')}`);
  }
  return errors.length > 0 ? errors.join('; ') : undefined;
}

function createStrictSpreadCase(
  run: PixelGoldenRun,
  spreadIndex: number,
  totalSpreads: number,
): PixelGoldenSpreadCase {
  return {
    ...createPixelSpreadCase(run, spreadIndex, totalSpreads),
    threshold: STRICT_PIXEL_THRESHOLD,
    maxDiffPixelRatio: STRICT_MAX_DIFF_PIXEL_RATIO,
  };
}

function blankPngLike(source: Buffer): Buffer {
  const image = PNG.sync.read(source);
  return blankPng(image.width, image.height);
}

function blankPng(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(255);
  return PNG.sync.write(image);
}

function appendRunError(error: string, runError: string | undefined): string {
  return runError ? `${error}; ${runError}` : error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
