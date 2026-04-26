import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, type TestInfo } from '@playwright/test';
import {
  createPixelGoldenSummary,
  createPixelSpreadCase,
  type PixelGoldenRun,
  type PixelGoldenSpreadCase,
  type PixelGoldenSummary,
} from './pixel-cases';
import {
  clearPixelGoldenPrimaryFiles,
  readPixelGoldenSpread,
  readPixelGoldenSpreadAlternatives,
  readPixelGoldenSummary,
  SHOULD_WRITE_PIXEL_DIAGNOSTICS,
  type PixelGoldenSpreadAlternative,
  writePixelGoldenSpread,
  writePixelGoldenSummary,
} from './pixel-golden-file';
import {
  pixelReviewCasePaths,
  writePixelReviewCase,
  type PixelReviewRecord,
  type PixelReviewReferenceInput,
} from './pixel-review';
import { pixelSpreadIndexesForSelection } from './pixel-spread-selection';
import { comparePng, type PixelDiffResult } from './png-diff';

export interface PixelRunRenderResult {
  readonly totalSpreads: number;
  readonly spreads: readonly PixelRenderedSpread[];
  readonly diagnostics?: PixelRunDiagnostics;
}

export interface PixelRenderedSpread {
  readonly spreadIndex: number;
  readonly png: Buffer;
  readonly reference?: PixelReferenceHint;
}

export interface PixelReferenceHint {
  readonly pageIndex?: number;
  readonly chapterHref?: string;
  readonly textPreview?: string;
}

export type PixelReviewReferenceProvider = (
  spread: PixelRenderedSpread,
  testCase: PixelGoldenSpreadCase,
) => Promise<PixelReviewReferenceInput | undefined>;

export interface PixelRunDiagnostics {
  readonly userAgent: string;
  readonly platform: string;
  readonly language: string;
  readonly devicePixelRatio: number;
  readonly fontStatus: string;
  readonly fonts: readonly PixelFontDiagnostic[];
  readonly textMetrics: readonly PixelTextMetricDiagnostic[];
}

export interface PixelFontDiagnostic {
  readonly family: string;
  readonly status: string;
  readonly weight: string;
  readonly style: string;
}

export interface PixelTextMetricDiagnostic {
  readonly font: string;
  readonly sample: string;
  readonly width: number;
  readonly actualBoundingBoxAscent?: number;
  readonly actualBoundingBoxDescent?: number;
  readonly fontBoundingBoxAscent?: number;
  readonly fontBoundingBoxDescent?: number;
}

export async function updatePixelRunGoldens(
  run: PixelGoldenRun,
  result: PixelRunRenderResult,
): Promise<void> {
  if (run.spreadSelection.mode !== 'explicit') {
    await clearPixelGoldenPrimaryFiles(run);
  }
  await writePixelGoldenSummary(run, createPixelGoldenSummary(run, result.totalSpreads));
  for (const spread of result.spreads) {
    await writePixelGoldenSpread(run, spread.spreadIndex, spread.png);
  }
}

export async function reviewPixelRun(
  run: PixelGoldenRun,
  result: PixelRunRenderResult,
  referenceProvider?: PixelReviewReferenceProvider,
): Promise<readonly PixelReviewRecord[]> {
  const records: PixelReviewRecord[] = [];
  for (const spread of result.spreads) {
    const testCase = createPixelSpreadCase(run, spread.spreadIndex, result.totalSpreads);
    const expected = await readPixelGoldenSpread(run, spread.spreadIndex);
    records.push(await reviewPixelSpreadCase(testCase, expected, spread, referenceProvider));
  }
  return records;
}

export async function comparePixelRun(
  run: PixelGoldenRun,
  result: PixelRunRenderResult,
  testInfo: TestInfo,
): Promise<void> {
  const failures = await collectPixelRunFailures(run, result, testInfo);
  expect(failures).toEqual([]);
}

async function collectPixelRunFailures(
  run: PixelGoldenRun,
  result: PixelRunRenderResult,
  testInfo: TestInfo,
): Promise<readonly string[]> {
  const failures = await comparePixelSummary(run, result.totalSpreads);
  const spreadsByIndex = new Map(result.spreads.map((spread) => [spread.spreadIndex, spread]));

  for (const spreadIndex of pixelSpreadIndexesForSelection(
    run.spreadSelection,
    result.totalSpreads,
  )) {
    const spread = spreadsByIndex.get(spreadIndex);
    if (!spread) {
      failures.push(`${run.id} did not render spread ${String(spreadIndex)}`);
      continue;
    }
    const testCase = createPixelSpreadCase(run, spreadIndex, result.totalSpreads);
    const expected = await readPixelGoldenSpread(run, spreadIndex);
    const alternatives = await readPixelGoldenSpreadAlternatives(run, spreadIndex);
    failures.push(
      ...(await comparePixelSpreadCase(
        testCase,
        expected,
        alternatives,
        spread.png,
        testInfo,
        result.diagnostics,
      )),
    );
  }

  return failures;
}

async function comparePixelSummary(run: PixelGoldenRun, totalSpreads: number): Promise<string[]> {
  const expectedSummary = await readPixelGoldenSummary(run);
  const actualSummary = createPixelGoldenSummary(run, totalSpreads);
  if (!expectedSummary) {
    return [`Missing pixel summary for ${run.id}. Run pnpm test:golden:pixel:update`];
  }
  return [...compareSummaries(run.id, expectedSummary, actualSummary)];
}

async function comparePixelSpreadCase(
  testCase: PixelGoldenSpreadCase,
  expected: Buffer | undefined,
  alternatives: readonly PixelGoldenSpreadAlternative[],
  actual: Buffer,
  testInfo: TestInfo,
  diagnostics: PixelRunDiagnostics | undefined,
): Promise<readonly string[]> {
  if (!expected) {
    const message = `Missing pixel golden for ${testCase.id}. Run pnpm test:golden:pixel:update`;
    await writeComparisonArtifacts(testInfo, testCase, expected, actual, diagnostics, {
      error: message,
    });
    return [message];
  }

  const diffPath = testInfo.outputPath(`${testCase.id}-diff.png`);
  try {
    const result = await comparePng(expected, actual, testCase, diffPath);
    if (result.diffRatio <= testCase.maxDiffPixelRatio) {
      if (shouldWriteComparisonArtifacts(testCase, result)) {
        await writeComparisonArtifacts(testInfo, testCase, expected, actual, diagnostics, {
          result,
        });
      }
      return [];
    }

    const matchedAlternative = await findMatchingAlternative(
      testInfo,
      testCase,
      alternatives,
      actual,
    );
    if (matchedAlternative) return [];

    if (shouldWriteComparisonArtifacts(testCase, result)) {
      await writeComparisonArtifacts(testInfo, testCase, expected, actual, diagnostics, {
        result,
        alternatives,
      });
      return [formatDiffMessage(testCase, result.diffPixels, result.diffRatio)];
    }
    return [formatDiffMessage(testCase, result.diffPixels, result.diffRatio)];
  } catch (error) {
    const message = `${testCase.id}: ${error instanceof Error ? error.message : String(error)}`;
    await writeComparisonArtifacts(testInfo, testCase, expected, actual, diagnostics, {
      error: message,
    });
    return [message];
  }
}

async function findMatchingAlternative(
  testInfo: TestInfo,
  testCase: PixelGoldenSpreadCase,
  alternatives: readonly PixelGoldenSpreadAlternative[],
  actual: Buffer,
): Promise<PixelGoldenSpreadAlternative | undefined> {
  for (const alternative of alternatives) {
    const diffPath = testInfo.outputPath(
      `${testCase.id}-alt-${safeArtifactLabel(alternative.label)}-diff.png`,
    );
    const result = await comparePng(alternative.png, actual, testCase, diffPath);
    if (result.diffRatio <= testCase.maxDiffPixelRatio) return alternative;
  }
  return undefined;
}

async function reviewPixelSpreadCase(
  testCase: PixelGoldenSpreadCase,
  expected: Buffer | undefined,
  spread: PixelRenderedSpread,
  referenceProvider: PixelReviewReferenceProvider | undefined,
): Promise<PixelReviewRecord> {
  const actual = spread.png;
  if (!expected) {
    const referenceInput = await referenceInputForSpread(spread, testCase, referenceProvider);
    return await writePixelReviewCase({ testCase, actual, ...referenceInput });
  }

  const paths = pixelReviewCasePaths(testCase);
  try {
    const diff = await comparePng(expected, actual, testCase, paths.diffPath, {
      writeDiffWhenEqual: true,
    });
    const referenceInput =
      diff.diffPixels > 0 ? await referenceInputForSpread(spread, testCase, referenceProvider) : {};
    return await writePixelReviewCase({ testCase, actual, expected, diff, ...referenceInput });
  } catch (error) {
    const referenceInput = await referenceInputForSpread(spread, testCase, referenceProvider);
    return await writePixelReviewCase({
      testCase,
      actual,
      expected,
      ...referenceInput,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function referenceInputForSpread(
  spread: PixelRenderedSpread,
  testCase: PixelGoldenSpreadCase,
  referenceProvider: PixelReviewReferenceProvider | undefined,
): Promise<{ readonly reference?: PixelReviewReferenceInput }> {
  const reference = await referenceProvider?.(spread, testCase);
  return reference ? { reference } : {};
}

async function writeOutput(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function compareSummaries(
  runId: string,
  expected: PixelGoldenSummary,
  actual: PixelGoldenSummary,
): readonly string[] {
  const failures: string[] = [];
  for (const key of Object.keys(actual) as (keyof PixelGoldenSummary)[]) {
    const actualValue = actual[key];
    if (expected[key] !== actualValue) {
      failures.push(
        `${runId} summary ${key} changed: expected ${String(expected[key])}, actual ${String(
          actualValue,
        )}`,
      );
    }
  }
  return failures;
}

function formatDiffMessage(
  testCase: PixelGoldenSpreadCase,
  diffPixels: number,
  diffRatio: number,
): string {
  return `${testCase.id} pixel diff ${String(diffPixels)} (${diffRatio.toFixed(6)}) exceeds ${String(
    testCase.maxDiffPixelRatio,
  )}`;
}

function shouldWriteComparisonArtifacts(
  testCase: PixelGoldenSpreadCase,
  result: PixelDiffResult,
): boolean {
  return (
    result.diffRatio > testCase.maxDiffPixelRatio ||
    (SHOULD_WRITE_PIXEL_DIAGNOSTICS && result.diffPixels > 0)
  );
}

async function writeComparisonArtifacts(
  testInfo: TestInfo,
  testCase: PixelGoldenSpreadCase,
  expected: Buffer | undefined,
  actual: Buffer,
  diagnostics: PixelRunDiagnostics | undefined,
  detail: {
    readonly result?: PixelDiffResult;
    readonly alternatives?: readonly PixelGoldenSpreadAlternative[];
    readonly error?: string;
  },
): Promise<void> {
  if (expected) {
    await writeOutput(testInfo.outputPath(`${testCase.id}-expected.png`), expected);
  }
  await writeOutput(testInfo.outputPath(`${testCase.id}-actual.png`), actual);
  await writeOutput(
    testInfo.outputPath(`${testCase.id}-metadata.json`),
    Buffer.from(`${JSON.stringify(comparisonMetadata(testCase, diagnostics, detail), null, 2)}\n`),
  );
}

function comparisonMetadata(
  testCase: PixelGoldenSpreadCase,
  diagnostics: PixelRunDiagnostics | undefined,
  detail: {
    readonly result?: PixelDiffResult;
    readonly alternatives?: readonly PixelGoldenSpreadAlternative[];
    readonly error?: string;
  },
): object {
  return {
    id: testCase.id,
    runId: testCase.runId,
    bookId: testCase.bookId,
    profileId: testCase.profileId,
    lineBreaking: testCase.lineBreaking,
    spreadIndex: testCase.spreadIndex,
    totalSpreads: testCase.totalSpreads,
    viewport: {
      width: testCase.width,
      height: testCase.height,
      margin: testCase.margin,
      spread: testCase.spread,
      spreadGap: testCase.spreadGap,
      devicePixelRatio: testCase.devicePixelRatio,
    },
    thresholds: {
      pixelmatch: testCase.threshold,
      maxDiffPixelRatio: testCase.maxDiffPixelRatio,
    },
    ...(detail.result
      ? {
          diff: {
            width: detail.result.width,
            height: detail.result.height,
            pixels: detail.result.diffPixels,
            ratio: detail.result.diffRatio,
          },
        }
      : {}),
    ...(detail.error ? { error: detail.error } : {}),
    ...(detail.alternatives && detail.alternatives.length > 0
      ? { alternatives: detail.alternatives.map((alternative) => alternative.label) }
      : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function safeArtifactLabel(label: string): string {
  return label.replaceAll(/[^a-zA-Z0-9_-]+/g, '-');
}
