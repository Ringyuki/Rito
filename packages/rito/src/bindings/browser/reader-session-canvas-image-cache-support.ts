import type { BrowserReaderArtifact, BrowserReaderSession } from './reader-session';
import type { BrowserReaderCanvasImageSource } from './reader-session-canvas-image-metadata';

/**
 * A decoded image ready for drawImage. Natural-size decodes prefer an
 * HTMLImageElement source: Chrome scales it through the same decode
 * cache DOM <img> painting uses, which is the only drawImage source that
 * reproduces the browser's raster bit for bit (probed — an ImageBitmap
 * source diverges on some images at every smoothing quality). Bucketed
 * decodes and DOM-less hosts keep ImageBitmap.
 */
export type BrowserReaderCanvasDecodedImage = ImageBitmap | HTMLImageElement;

export interface BrowserReaderCanvasImageEntry {
  readonly key: string;
  readonly href: string;
  readonly bitmap: BrowserReaderCanvasDecodedImage;
  /** Blob URL backing an element-sourced decode; revoked on release. */
  readonly objectUrl?: string;
  readonly source: BrowserReaderCanvasImageSource;
  references: number;
}

export function closeDecodedImage(entry: {
  readonly bitmap: BrowserReaderCanvasDecodedImage;
  readonly objectUrl?: string;
}): void {
  if ('close' in entry.bitmap) entry.bitmap.close();
  if (entry.objectUrl !== undefined) URL.revokeObjectURL(entry.objectUrl);
}

export function assertDecodedImage(
  bitmap: BrowserReaderCanvasDecodedImage,
  source: BrowserReaderCanvasImageSource,
  targetWidth: number,
  targetHeight: number,
  href: string,
): void {
  const aspectError = Math.abs(bitmap.width * source.height - bitmap.height * source.width);
  if (
    !Number.isSafeInteger(bitmap.width) ||
    !Number.isSafeInteger(bitmap.height) ||
    bitmap.width <= 0 ||
    bitmap.height <= 0 ||
    bitmap.width > targetWidth ||
    bitmap.height > targetHeight ||
    bitmap.width > source.width ||
    bitmap.height > source.height ||
    aspectError > Math.max(source.width, source.height)
  ) {
    throw new Error(`Decoded reader session image ${href} violated its bounded target.`);
  }
}

export function assertStableImageSource(
  expected: BrowserReaderCanvasImageEntry | undefined,
  source: BrowserReaderCanvasImageSource,
  href: string,
): void {
  if (
    expected &&
    (expected.source.width !== source.width || expected.source.height !== source.height)
  ) {
    throw new Error(`reader session image dimensions changed within the session for ${href}.`);
  }
}

export function imageDeclarations(artifact: BrowserReaderArtifact): ReadonlySet<string> {
  const hrefs = new Set<string>();
  for (const resource of artifact.resources) {
    if (resource.kind !== 'image') continue;
    if (!resource.href || hrefs.has(resource.href)) {
      throw new Error('reader session artifact has an invalid or duplicate image declaration.');
    }
    hrefs.add(resource.href);
  }
  return hrefs;
}

export function assertImageArtifactOwner(
  session: BrowserReaderSession,
  artifact: BrowserReaderArtifact,
): void {
  if (artifact.sessionId !== session.sessionId) {
    throw new Error('reader session artifact belongs to another session.');
  }
}

export function assertImageResource(
  resource: Awaited<ReturnType<BrowserReaderSession['readResource']>>,
  artifact: BrowserReaderArtifact,
  href: string,
): void {
  if (
    resource.artifactId !== artifact.artifactId ||
    resource.kind !== 'image' ||
    resource.href !== href
  ) {
    throw new Error(`reader session returned a mismatched image resource for ${href}.`);
  }
}

export function imageSourceKey(sessionId: bigint, href: string): string {
  return `${String(sessionId)}\u0000${href}`;
}

export function imageCacheKey(sourceKey: string, width: number, height: number): string {
  return `${sourceKey}\u0000${String(width)}x${String(height)}`;
}
