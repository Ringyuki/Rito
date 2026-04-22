import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { PixelGoldenCase } from './pixel-cases';

export interface PixelDiffResult {
  readonly width: number;
  readonly height: number;
  readonly diffPixels: number;
  readonly diffRatio: number;
}

export async function comparePng(
  expected: Buffer,
  actual: Buffer,
  testCase: PixelGoldenCase,
  diffPath: string,
): Promise<PixelDiffResult> {
  const expectedPng = PNG.sync.read(expected);
  const actualPng = PNG.sync.read(actual);
  assertSameDimensions(expectedPng, actualPng, testCase.id);

  const diff = new PNG({ width: expectedPng.width, height: expectedPng.height });
  const diffPixels = pixelmatch(
    expectedPng.data,
    actualPng.data,
    diff.data,
    expectedPng.width,
    expectedPng.height,
    { threshold: testCase.threshold },
  );

  if (diffPixels > 0) {
    await mkdir(dirname(diffPath), { recursive: true });
    await writeFile(diffPath, PNG.sync.write(diff));
  }

  const totalPixels = expectedPng.width * expectedPng.height;
  return {
    width: expectedPng.width,
    height: expectedPng.height,
    diffPixels,
    diffRatio: diffPixels / totalPixels,
  };
}

function assertSameDimensions(expected: PNG, actual: PNG, caseId: string): void {
  if (expected.width === actual.width && expected.height === actual.height) return;
  throw new Error(
    `${caseId} dimension mismatch: expected ${String(expected.width)}x${String(
      expected.height,
    )}, actual ${String(actual.width)}x${String(actual.height)}`,
  );
}
