import type { CoreFrameCommand } from './core-contracts';
import type { BrowserReaderArtifactV1, BrowserReaderV1Session } from './reader-v1';
import { BrowserReaderCanvasUnsupportedErrorV1 } from './reader-v1-canvas-error';
import {
  assertDecodedImageV1,
  assertImageArtifactOwnerV1,
  assertImageResourceV1,
  assertStableImageSourceV1,
  imageCacheKeyV1,
  imageDeclarationsV1,
  imageSourceKeyV1,
  type BrowserReaderCanvasDecodedImageV1,
  type BrowserReaderCanvasImageEntryV1,
  closeDecodedImageV1,
} from './reader-v1-canvas-image-cache-support';
import {
  BROWSER_READER_CANVAS_IMAGE_LIMITS_V1,
  BrowserReaderCanvasImageLeaseBudgetV1,
  type BrowserReaderCanvasImageLimitsV1,
} from './reader-v1-canvas-image-limits';
import {
  inspectBrowserReaderCanvasImageV1,
  type BrowserReaderCanvasImageSourceV1,
} from './reader-v1-canvas-image-metadata';
import { BrowserReaderCanvasImageTargetPlanV1 } from './reader-v1-canvas-image-plan';
import type { BrowserReaderCanvasResourceLimiterV1 } from './reader-v1-canvas-resource-limiter';
import { settleCanvasResourcesWithLimiterV1 } from './reader-v1-canvas-resource-limiter';

export interface BrowserReaderCanvasImageLeaseV1 {
  has(href: string): boolean;
  resolve(href: string): ImageBitmap | undefined;
  release(): void;
}

export class BrowserReaderCanvasImageCacheV1 {
  private readonly entries = new Map<string, BrowserReaderCanvasImageEntryV1>();
  private readonly loads = new Map<string, Promise<BrowserReaderCanvasImageEntryV1>>();
  private disposed = false;

  constructor(
    private readonly session: BrowserReaderV1Session,
    private readonly limiter: BrowserReaderCanvasResourceLimiterV1,
    private readonly limits: BrowserReaderCanvasImageLimitsV1 = BROWSER_READER_CANVAS_IMAGE_LIMITS_V1,
  ) {}

  async prepare(
    artifact: BrowserReaderArtifactV1,
    commands: readonly CoreFrameCommand[],
    pixelRatio: number,
  ): Promise<BrowserReaderCanvasImageLeaseV1> {
    this.assertOpen();
    assertImageArtifactOwnerV1(this.session, artifact);
    const plan = BrowserReaderCanvasImageTargetPlanV1.collect(commands, pixelRatio);
    const declarations = imageDeclarationsV1(artifact);
    for (const href of plan.hrefs) {
      if (!declarations.has(href)) {
        throw new Error(`Reader v1 artifact omitted required image resource ${href}.`);
      }
    }
    const budget = new BrowserReaderCanvasImageLeaseBudgetV1(this.limits);
    const acquired = new Map<string, string>();
    try {
      const settled = await settleCanvasResourcesWithLimiterV1(
        plan.hrefs,
        this.limiter,
        async (href) => {
          const key = await this.acquire(artifact, href, plan, budget);
          acquired.set(href, key);
        },
      );
      const failure = settled.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      this.assertOpen();
      return imageLease(this, acquired);
    } catch (error: unknown) {
      releaseKeys(this, acquired.values(), error);
      throw error;
    }
  }

  resolve(key: string): BrowserReaderCanvasDecodedImageV1 | undefined {
    this.assertOpen();
    const entry = this.entries.get(key);
    if (!entry || entry.references <= 0) return undefined;
    return entry.bitmap;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.references <= 0) return;
    entry.references -= 1;
    if (entry.references !== 0 || this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    closeDecodedImageV1(entry);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    for (const entry of this.entries.values()) {
      try {
        closeDecodedImageV1(entry);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    this.entries.clear();
    if (failures.length) throw new AggregateError(failures, 'Reader v1 image disposal failed.');
  }

  private async acquire(
    artifact: BrowserReaderArtifactV1,
    href: string,
    plan: BrowserReaderCanvasImageTargetPlanV1,
    budget: BrowserReaderCanvasImageLeaseBudgetV1,
  ): Promise<string> {
    const sourceKey = imageSourceKeyV1(artifact.sessionId, href);
    for (;;) {
      this.assertOpen();
      const known = this.knownEntry(sourceKey);
      if (known) {
        const target = this.decodeTargetFor(plan, href, known.source.width, known.source.height);
        const key = imageCacheKeyV1(sourceKey, target.width, target.height);
        const existing = this.entries.get(key);
        if (existing) {
          budget.reserveTarget(target.width * target.height, href);
          existing.references += 1;
          return key;
        }
      }
      const pending = this.loads.get(sourceKey);
      if (pending) {
        await pending;
        continue;
      }
      const operation = this.load(artifact, href, sourceKey, plan, budget, known);
      this.loads.set(sourceKey, operation);
      try {
        const entry = await operation;
        this.assertOpen();
        entry.references += 1;
        return entry.key;
      } finally {
        if (this.loads.get(sourceKey) === operation) this.loads.delete(sourceKey);
      }
    }
  }

  private async load(
    artifact: BrowserReaderArtifactV1,
    href: string,
    sourceKey: string,
    plan: BrowserReaderCanvasImageTargetPlanV1,
    budget: BrowserReaderCanvasImageLeaseBudgetV1,
    expected: BrowserReaderCanvasImageEntryV1 | undefined,
  ): Promise<BrowserReaderCanvasImageEntryV1> {
    const resource = await this.session.readResource(artifact.artifactId, 'image', href);
    this.assertOpen();
    assertImageResourceV1(resource, artifact, href);
    budget.reserveEncoded(resource.bytes.byteLength, href);
    const source = inspectBrowserReaderCanvasImageV1(resource, this.limits);
    assertStableImageSourceV1(expected, source, href);
    const target = this.decodeTargetFor(plan, href, source.width, source.height);
    budget.reserveTarget(target.width * target.height, href);
    const decoded = target.natural
      ? await decodeNaturalImage(resource.bytes, source)
      : { image: await decodeImage(resource.bytes, source, target.width, target.height) };
    const bitmap = decoded.image;
    try {
      this.assertOpen();
      assertDecodedImageV1(bitmap, source, target.width, target.height, href);
      const key = imageCacheKeyV1(sourceKey, target.width, target.height);
      const entry: BrowserReaderCanvasImageEntryV1 = {
        key,
        href,
        bitmap,
        ...(decoded.objectUrl !== undefined ? { objectUrl: decoded.objectUrl } : {}),
        source,
        references: 0,
      };
      this.entries.set(key, entry);
      return entry;
    } catch (error: unknown) {
      try {
        closeDecodedImageV1({
          bitmap,
          ...(decoded.objectUrl !== undefined ? { objectUrl: decoded.objectUrl } : {}),
        });
      } catch (cleanupError: unknown) {
        throw new AggregateError([error, cleanupError], 'Reader v1 image rollback failed.', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }

  private knownEntry(sourceKey: string): BrowserReaderCanvasImageEntryV1 | undefined {
    for (const entry of this.entries.values()) {
      if (imageSourceKeyV1(this.session.sessionId, entry.href) === sourceKey) return entry;
    }
    return undefined;
  }

  /**
   * Natural-size decode is the default: a one-step drawImage scale from
   * the natural raster is bit-identical to Blink's own <img> painting
   * (probed), while any pre-resized bitmap never matches. Sources past
   * `maxNaturalDecodePixels` keep the bucketed decode as a memory safety
   * valve — a recorded exemption from the pixel-parity standard, not a
   * silent one.
   */
  private decodeTargetFor(
    plan: BrowserReaderCanvasImageTargetPlanV1,
    href: string,
    sourceWidth: number,
    sourceHeight: number,
  ): { readonly width: number; readonly height: number; readonly natural: boolean } {
    if (sourceWidth * sourceHeight <= this.limits.maxNaturalDecodePixels) {
      return { width: sourceWidth, height: sourceHeight, natural: true };
    }
    const bucketed = plan.targetFor(href, sourceWidth, sourceHeight, this.limits.targetBucketSize);
    const scope = globalThis as { __ritoImageDecodeExemptions?: unknown[] };
    scope.__ritoImageDecodeExemptions = [
      ...(scope.__ritoImageDecodeExemptions ?? []).slice(-15),
      { href, sourceWidth, sourceHeight, target: bucketed },
    ];
    return { ...bucketed, natural: false };
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error('Browser Reader v1 Canvas presenter was disposed during preparation.');
    }
  }
}

async function decodeImage(
  bytes: Uint8Array,
  source: BrowserReaderCanvasImageSourceV1,
  targetWidth: number,
  targetHeight: number,
): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new BrowserReaderCanvasUnsupportedErrorV1('createImageBitmap');
  }
  if (typeof Blob !== 'function') throw new BrowserReaderCanvasUnsupportedErrorV1('Blob');
  const blob = new Blob([ownedArrayBuffer(bytes)], { type: source.mediaType });
  return createImageBitmap(blob, {
    resizeWidth: targetWidth,
    resizeHeight: targetHeight,
    resizeQuality: 'high',
  });
}

/**
 * Natural-size decode. An HTMLImageElement source scales through the same
 * decode cache DOM <img> painting uses — the only drawImage source that
 * reproduces the browser raster bit for bit. DOM-less hosts (workers,
 * node tests) fall back to a natural-size ImageBitmap.
 */
async function decodeNaturalImage(
  bytes: Uint8Array,
  source: BrowserReaderCanvasImageSourceV1,
): Promise<{ image: BrowserReaderCanvasDecodedImageV1; objectUrl?: string }> {
  if (typeof Blob !== 'function') throw new BrowserReaderCanvasUnsupportedErrorV1('Blob');
  const blob = new Blob([ownedArrayBuffer(bytes)], { type: source.mediaType });
  if (
    typeof Image === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const element = new Image();
      element.src = objectUrl;
      await element.decode();
      return { image: element, objectUrl };
    } catch (error: unknown) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }
  if (typeof createImageBitmap !== 'function') {
    throw new BrowserReaderCanvasUnsupportedErrorV1('createImageBitmap');
  }
  return { image: await createImageBitmap(blob) };
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function imageLease(
  owner: BrowserReaderCanvasImageCacheV1,
  images: ReadonlyMap<string, string>,
): BrowserReaderCanvasImageLeaseV1 {
  let released = false;
  return {
    has: (href) => !released && images.has(href),
    resolve: (href) => (released ? undefined : owner.resolve(images.get(href) ?? '')),
    release() {
      if (released) return;
      released = true;
      releaseKeys(owner, images.values());
    },
  };
}

function releaseKeys(
  owner: BrowserReaderCanvasImageCacheV1,
  keys: Iterable<string>,
  primaryError?: unknown,
): void {
  const failures: unknown[] = [];
  for (const key of keys) {
    try {
      owner.release(key);
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(
      primaryError === undefined ? failures : [primaryError, ...failures],
      'Reader v1 image lease release failed.',
    );
  }
}
