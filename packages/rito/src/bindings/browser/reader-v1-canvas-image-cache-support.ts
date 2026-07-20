import type { BrowserReaderArtifactV1, BrowserReaderV1Session } from './reader-v1';
import type { BrowserReaderCanvasImageSourceV1 } from './reader-v1-canvas-image-metadata';

export interface BrowserReaderCanvasImageEntryV1 {
  readonly key: string;
  readonly href: string;
  readonly bitmap: ImageBitmap;
  readonly source: BrowserReaderCanvasImageSourceV1;
  references: number;
}

export function assertDecodedImageV1(
  bitmap: ImageBitmap,
  source: BrowserReaderCanvasImageSourceV1,
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
    throw new Error(`Decoded Reader v1 image ${href} violated its bounded target.`);
  }
}

export function assertStableImageSourceV1(
  expected: BrowserReaderCanvasImageEntryV1 | undefined,
  source: BrowserReaderCanvasImageSourceV1,
  href: string,
): void {
  if (
    expected &&
    (expected.source.width !== source.width || expected.source.height !== source.height)
  ) {
    throw new Error(`Reader v1 image dimensions changed within the session for ${href}.`);
  }
}

export function imageDeclarationsV1(artifact: BrowserReaderArtifactV1): ReadonlySet<string> {
  const hrefs = new Set<string>();
  for (const resource of artifact.resources) {
    if (resource.kind !== 'image') continue;
    if (!resource.href || hrefs.has(resource.href)) {
      throw new Error('Reader v1 artifact has an invalid or duplicate image declaration.');
    }
    hrefs.add(resource.href);
  }
  return hrefs;
}

export function assertImageArtifactOwnerV1(
  session: BrowserReaderV1Session,
  artifact: BrowserReaderArtifactV1,
): void {
  if (artifact.sessionId !== session.sessionId) {
    throw new Error('Reader v1 artifact belongs to another session.');
  }
}

export function assertImageResourceV1(
  resource: Awaited<ReturnType<BrowserReaderV1Session['readResource']>>,
  artifact: BrowserReaderArtifactV1,
  href: string,
): void {
  if (
    resource.artifactId !== artifact.artifactId ||
    resource.kind !== 'image' ||
    resource.href !== href
  ) {
    throw new Error(`Reader v1 returned a mismatched image resource for ${href}.`);
  }
}

export function imageSourceKeyV1(sessionId: bigint, href: string): string {
  return `${String(sessionId)}\u0000${href}`;
}

export function imageCacheKeyV1(sourceKey: string, width: number, height: number): string {
  return `${sourceKey}\u0000${String(width)}x${String(height)}`;
}
