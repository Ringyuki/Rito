import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PixelGoldenSpreadCase } from './pixel-cases';
import { renderPixelReviewHtml } from './pixel-review-html';
import type { PixelDiffResult } from './png-diff';

export type PixelReviewStatus = 'pass' | 'warn' | 'fail' | 'missing' | 'error';

export interface PixelReviewCaseInput {
  readonly testCase: PixelGoldenSpreadCase;
  readonly actual: Buffer;
  readonly expected?: Buffer;
  readonly diff?: PixelDiffResult;
  readonly reference?: PixelReviewReferenceInput;
  readonly error?: string;
}

export interface PixelReviewReferenceInput {
  readonly png?: Buffer;
  readonly width?: number;
  readonly height?: number;
  readonly label?: string;
  readonly sourceHref?: string;
  readonly targetFound?: boolean;
  readonly skipped?: string;
  readonly error?: string;
}

export interface PixelReviewCasePaths {
  readonly caseDir: string;
  readonly expectedPath: string;
  readonly actualPath: string;
  readonly diffPath: string;
  readonly referencePath: string;
  readonly metadataPath: string;
}

export interface PixelReviewRecord {
  readonly id: string;
  readonly runId: string;
  readonly bookId: string;
  readonly profileId: string;
  readonly spreadIndex: number;
  readonly totalSpreads: number;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly spread: PixelGoldenSpreadCase['spread'];
  readonly spreadGap: number;
  readonly lineBreaking: PixelGoldenSpreadCase['lineBreaking'];
  readonly devicePixelRatio: number;
  readonly threshold: number;
  readonly maxDiffPixelRatio: number;
  readonly tags: readonly string[];
  readonly status: PixelReviewStatus;
  readonly generatedAt: string;
  readonly actualPath: string;
  readonly expectedPath?: string;
  readonly diffPath?: string;
  readonly diffPixels?: number;
  readonly diffRatio?: number;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
  readonly referencePath?: string;
  readonly referenceImageWidth?: number;
  readonly referenceImageHeight?: number;
  readonly referenceLabel?: string;
  readonly referenceSourceHref?: string;
  readonly referenceTargetFound?: boolean;
  readonly referenceSkipped?: string;
  readonly referenceError?: string;
  readonly error?: string;
}

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
export const PIXEL_REVIEW_ROOT = resolve(HELPER_DIR, '../../../test-results/pixel-review');

export async function resetPixelReviewReport(): Promise<void> {
  await rm(PIXEL_REVIEW_ROOT, { recursive: true, force: true });
  await mkdir(resolve(PIXEL_REVIEW_ROOT, 'cases'), { recursive: true });
}

export function pixelReviewCasePaths(testCase: PixelGoldenSpreadCase): PixelReviewCasePaths {
  const caseDir = resolve(
    PIXEL_REVIEW_ROOT,
    'cases',
    testCase.bookId,
    testCase.profileId,
    testCase.lineBreaking,
    `spread-${String(testCase.spreadIndex).padStart(4, '0')}`,
  );
  return {
    caseDir,
    expectedPath: resolve(caseDir, 'expected.png'),
    actualPath: resolve(caseDir, 'actual.png'),
    diffPath: resolve(caseDir, 'diff.png'),
    referencePath: resolve(caseDir, 'reference.png'),
    metadataPath: resolve(caseDir, 'metadata.json'),
  };
}

export async function writePixelReviewCase(
  input: PixelReviewCaseInput,
): Promise<PixelReviewRecord> {
  const paths = pixelReviewCasePaths(input.testCase);
  const record = createReviewRecord(input, paths);
  await mkdir(paths.caseDir, { recursive: true });
  await writeFile(paths.actualPath, input.actual);
  if (input.expected) await writeFile(paths.expectedPath, input.expected);
  if (input.reference?.png) await writeFile(paths.referencePath, input.reference.png);
  await writeFile(paths.metadataPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function writePixelReviewIndex(
  records: readonly PixelReviewRecord[],
): Promise<string> {
  const indexPath = resolve(PIXEL_REVIEW_ROOT, 'index.html');
  await mkdir(PIXEL_REVIEW_ROOT, { recursive: true });
  await writeFile(indexPath, renderPixelReviewHtml(records));
  return indexPath;
}

function createReviewRecord(
  input: PixelReviewCaseInput,
  paths: PixelReviewCasePaths,
): PixelReviewRecord {
  const status = reviewStatus(input);
  return {
    id: input.testCase.id,
    runId: input.testCase.runId,
    bookId: input.testCase.bookId,
    profileId: input.testCase.profileId,
    spreadIndex: input.testCase.spreadIndex,
    totalSpreads: input.testCase.totalSpreads,
    width: input.testCase.width,
    height: input.testCase.height,
    margin: input.testCase.margin,
    spread: input.testCase.spread,
    spreadGap: input.testCase.spreadGap,
    lineBreaking: input.testCase.lineBreaking,
    devicePixelRatio: input.testCase.devicePixelRatio,
    threshold: input.testCase.threshold,
    maxDiffPixelRatio: input.testCase.maxDiffPixelRatio,
    tags: input.testCase.tags,
    status,
    generatedAt: new Date().toISOString(),
    actualPath: relativePath(paths.actualPath),
    ...(input.expected ? { expectedPath: relativePath(paths.expectedPath) } : {}),
    ...(input.diff ? { diffPath: relativePath(paths.diffPath) } : {}),
    ...(input.diff
      ? {
          diffPixels: input.diff.diffPixels,
          diffRatio: input.diff.diffRatio,
          imageWidth: input.diff.width,
          imageHeight: input.diff.height,
        }
      : {}),
    ...referenceRecord(input.reference, paths),
    ...(input.error ? { error: input.error } : {}),
  };
}

function referenceRecord(
  reference: PixelReviewReferenceInput | undefined,
  paths: PixelReviewCasePaths,
): Partial<PixelReviewRecord> {
  if (!reference) return {};
  return {
    ...(reference.png ? { referencePath: relativePath(paths.referencePath) } : {}),
    ...(reference.width ? { referenceImageWidth: reference.width } : {}),
    ...(reference.height ? { referenceImageHeight: reference.height } : {}),
    ...(reference.label ? { referenceLabel: reference.label } : {}),
    ...(reference.sourceHref ? { referenceSourceHref: reference.sourceHref } : {}),
    ...(reference.targetFound !== undefined ? { referenceTargetFound: reference.targetFound } : {}),
    ...(reference.skipped ? { referenceSkipped: reference.skipped } : {}),
    ...(reference.error ? { referenceError: reference.error } : {}),
  };
}

function reviewStatus(input: PixelReviewCaseInput): PixelReviewStatus {
  if (input.error) return 'error';
  if (!input.expected) return 'missing';
  if (!input.diff) return 'error';
  if (input.diff.diffPixels === 0) return 'pass';
  if (input.diff.diffRatio <= input.testCase.maxDiffPixelRatio) return 'warn';
  return 'fail';
}

function relativePath(path: string): string {
  return relative(PIXEL_REVIEW_ROOT, path).replaceAll('\\', '/');
}
