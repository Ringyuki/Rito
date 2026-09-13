import type { CoreReaderPrimitiveList } from './core-contracts';
import type { BrowserReaderArtifact, BrowserReaderSession } from './reader-session';
import { BrowserReaderCanvasUnsupportedError } from './reader-session-canvas-error';
import {
  assertDecodedImage,
  assertImageArtifactOwner,
  assertImageResource,
  assertStableImageSource,
  imageCacheKey,
  imageDeclarations,
  imageSourceKey,
  type BrowserReaderCanvasDecodedImage,
  type BrowserReaderCanvasImageEntry,
  closeDecodedImage,
} from './reader-session-canvas-image-cache-support';
import {
  BROWSER_READER_CANVAS_IMAGE_LIMITS,
  BrowserReaderCanvasImageLeaseBudget,
  type BrowserReaderCanvasImageLimits,
} from './reader-session-canvas-image-limits';
import {
  inspectBrowserReaderCanvasImage,
  type BrowserReaderCanvasImageSource,
} from './reader-session-canvas-image-metadata';
import { BrowserReaderCanvasImageTargetPlan } from './reader-session-canvas-image-plan';
import type { BrowserReaderCanvasResourceLimiter } from './reader-session-canvas-resource-limiter';
import { settleCanvasResourcesWithLimiter } from './reader-session-canvas-resource-limiter';

export interface BrowserReaderCanvasImageLease {
  has(href: string): boolean;
  resolve(href: string): BrowserReaderCanvasDecodedImage | undefined;
  release(): void;
}

export class BrowserReaderCanvasImageCache {
  private readonly entries = new Map<string, BrowserReaderCanvasImageEntry>();
  private readonly loads = new Map<string, Promise<BrowserReaderCanvasImageEntry>>();
  private disposed = false;

  constructor(
    private readonly session: BrowserReaderSession,
    private readonly limiter: BrowserReaderCanvasResourceLimiter,
    private readonly limits: BrowserReaderCanvasImageLimits = BROWSER_READER_CANVAS_IMAGE_LIMITS,
  ) {}

  async prepare(
    artifact: BrowserReaderArtifact,
    list: CoreReaderPrimitiveList,
  ): Promise<BrowserReaderCanvasImageLease> {
    this.assertOpen();
    assertImageArtifactOwner(this.session, artifact);
    const plan = BrowserReaderCanvasImageTargetPlan.collect(list);
    const declarations = imageDeclarations(artifact);
    for (const href of plan.hrefs) {
      if (!declarations.has(href)) {
        throw new Error(`reader session artifact omitted required image resource ${href}.`);
      }
    }
    const budget = new BrowserReaderCanvasImageLeaseBudget(this.limits);
    const acquired = new Map<string, string>();
    try {
      const settled = await settleCanvasResourcesWithLimiter(
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

  resolve(key: string): BrowserReaderCanvasDecodedImage | undefined {
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
    closeDecodedImage(entry);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    for (const entry of this.entries.values()) {
      try {
        closeDecodedImage(entry);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    this.entries.clear();
    if (failures.length)
      throw new AggregateError(failures, 'reader session image disposal failed.');
  }

  private async acquire(
    artifact: BrowserReaderArtifact,
    href: string,
    plan: BrowserReaderCanvasImageTargetPlan,
    budget: BrowserReaderCanvasImageLeaseBudget,
  ): Promise<string> {
    const sourceKey = imageSourceKey(artifact.sessionId, href);
    for (;;) {
      this.assertOpen();
      const known = this.knownEntry(sourceKey);
      if (known) {
        const target = this.decodeTargetFor(plan, href, known.source.width, known.source.height);
        const key = imageCacheKey(sourceKey, target.width, target.height);
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
    artifact: BrowserReaderArtifact,
    href: string,
    sourceKey: string,
    plan: BrowserReaderCanvasImageTargetPlan,
    budget: BrowserReaderCanvasImageLeaseBudget,
    expected: BrowserReaderCanvasImageEntry | undefined,
  ): Promise<BrowserReaderCanvasImageEntry> {
    const resource = await this.session.readResource(artifact.artifactId, 'image', href);
    this.assertOpen();
    assertImageResource(resource, artifact, href);
    budget.reserveEncoded(resource.bytes.byteLength, href);
    const source = inspectBrowserReaderCanvasImage(resource, this.limits);
    assertStableImageSource(expected, source, href);
    const target = this.decodeTargetFor(plan, href, source.width, source.height);
    budget.reserveTarget(target.width * target.height, href);
    const decoded = target.natural
      ? await decodeNaturalImage(resource.bytes, source)
      : { image: await decodeImage(resource.bytes, source, target.width, target.height) };
    const bitmap = decoded.image;
    try {
      this.assertOpen();
      assertDecodedImage(bitmap, source, target.width, target.height, href);
      const key = imageCacheKey(sourceKey, target.width, target.height);
      const entry: BrowserReaderCanvasImageEntry = {
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
        closeDecodedImage({
          bitmap,
          ...(decoded.objectUrl !== undefined ? { objectUrl: decoded.objectUrl } : {}),
        });
      } catch (cleanupError: unknown) {
        throw new AggregateError([error, cleanupError], 'reader session image rollback failed.', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }

  private knownEntry(sourceKey: string): BrowserReaderCanvasImageEntry | undefined {
    for (const entry of this.entries.values()) {
      if (imageSourceKey(this.session.sessionId, entry.href) === sourceKey) return entry;
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
    plan: BrowserReaderCanvasImageTargetPlan,
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
      throw new Error('Browser reader session Canvas presenter was disposed during preparation.');
    }
  }
}

async function decodeImage(
  bytes: Uint8Array,
  source: BrowserReaderCanvasImageSource,
  targetWidth: number,
  targetHeight: number,
): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new BrowserReaderCanvasUnsupportedError('createImageBitmap');
  }
  if (typeof Blob !== 'function') throw new BrowserReaderCanvasUnsupportedError('Blob');
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
  source: BrowserReaderCanvasImageSource,
): Promise<{ image: BrowserReaderCanvasDecodedImage; objectUrl?: string }> {
  if (typeof Blob !== 'function') throw new BrowserReaderCanvasUnsupportedError('Blob');
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
    throw new BrowserReaderCanvasUnsupportedError('createImageBitmap');
  }
  return { image: await createImageBitmap(blob) };
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function imageLease(
  owner: BrowserReaderCanvasImageCache,
  images: ReadonlyMap<string, string>,
): BrowserReaderCanvasImageLease {
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
  owner: BrowserReaderCanvasImageCache,
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
      'reader session image lease release failed.',
    );
  }
}
