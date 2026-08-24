export interface BrowserReaderCanvasImageLimitsV1 {
  readonly maxEncodedBytesPerImage: number;
  readonly maxEncodedBytesPerLease: number;
  readonly maxSourceDimension: number;
  readonly maxSourcePixels: number;
  /**
   * Sources at or under this pixel count decode at their NATURAL size and
   * scale in one step at draw time — the only path whose raster is
   * bit-identical to Blink's own <img> painting (probed). Larger sources
   * fall back to the bucketed decode, recorded as an exemption. Corpus
   * ground truth (2313 images, 123 books): P99 is 5.67 MP; only 7 images
   * exceed 8 MiP, the largest 26.2 MP (105 MB RGBA).
   */
  readonly maxNaturalDecodePixels: number;
  readonly maxTargetPixelsPerLease: number;
  readonly targetBucketSize: number;
}

/**
 * Fixed production defaults: 16 MiB/image, 64 MiB/lease encoded, 16K/64 MP
 * source geometry, and 16 MP decoded targets per current/incoming artifact.
 * Keeping them internal avoids a policy-heavy public API.
 */
export const BROWSER_READER_CANVAS_IMAGE_LIMITS_V1: BrowserReaderCanvasImageLimitsV1 =
  Object.freeze({
    maxEncodedBytesPerImage: 16 * 1024 * 1024,
    maxEncodedBytesPerLease: 64 * 1024 * 1024,
    maxSourceDimension: 16_384,
    maxSourcePixels: 64 * 1024 * 1024,
    maxNaturalDecodePixels: 8 * 1024 * 1024,
    // Natural rasters are larger than bucketed ones; a spread holding two
    // cap-sized naturals plus companions must fit one lease.
    maxTargetPixelsPerLease: 32 * 1024 * 1024,
    targetBucketSize: 64,
  });

export class BrowserReaderCanvasImageBudgetExceededErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserReaderCanvasImageBudgetExceededErrorV1';
  }
}

export class BrowserReaderCanvasImageLeaseBudgetV1 {
  private encodedBytes = 0;
  private targetPixels = 0;

  constructor(private readonly limits: BrowserReaderCanvasImageLimitsV1) {
    validateBrowserReaderCanvasImageLimitsV1(limits);
  }

  reserveEncoded(bytes: number, href: string): void {
    requireSafePositive(bytes, 'encoded image byte length');
    if (bytes > this.limits.maxEncodedBytesPerImage) {
      throw budgetError(`Encoded image ${href} exceeds the per-image byte budget.`);
    }
    this.encodedBytes = checkedSum(this.encodedBytes, bytes, 'encoded image lease bytes');
    if (this.encodedBytes > this.limits.maxEncodedBytesPerLease) {
      throw budgetError(`Encoded images exceed the per-lease byte budget at ${href}.`);
    }
  }

  reserveTarget(pixels: number, href: string): void {
    requireSafePositive(pixels, 'decoded image pixel count');
    this.targetPixels = checkedSum(this.targetPixels, pixels, 'decoded image lease pixels');
    if (this.targetPixels > this.limits.maxTargetPixelsPerLease) {
      throw budgetError(`Decoded images exceed the per-lease pixel budget at ${href}.`);
    }
  }
}

function validateBrowserReaderCanvasImageLimitsV1(limits: BrowserReaderCanvasImageLimitsV1): void {
  const values: readonly (readonly [string, number])[] = [
    ['maxEncodedBytesPerImage', limits.maxEncodedBytesPerImage],
    ['maxEncodedBytesPerLease', limits.maxEncodedBytesPerLease],
    ['maxSourceDimension', limits.maxSourceDimension],
    ['maxSourcePixels', limits.maxSourcePixels],
    ['maxNaturalDecodePixels', limits.maxNaturalDecodePixels],
    ['maxTargetPixelsPerLease', limits.maxTargetPixelsPerLease],
    ['targetBucketSize', limits.targetBucketSize],
  ];
  for (const [name, value] of values) requireSafePositive(value, name);
  if (limits.maxEncodedBytesPerLease < limits.maxEncodedBytesPerImage) {
    throw new RangeError('Per-lease encoded image budget cannot be smaller than one image.');
  }
}

function checkedSum(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} overflowed.`);
  return result;
}

function requireSafePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function budgetError(message: string): BrowserReaderCanvasImageBudgetExceededErrorV1 {
  return new BrowserReaderCanvasImageBudgetExceededErrorV1(message);
}
