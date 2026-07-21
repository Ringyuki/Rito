/** Explicit byte budget for decoded page bitmaps retained by one session. */
const DECODED_IMAGE_BYTE_BUDGET = 96 * 1024 * 1024;

/**
 * Byte-bounded residency for the session's decoded page bitmaps.
 *
 * The plain image map's insertion order doubles as the recency order:
 * painting touches a frame's hrefs to the tail, so eviction closes the
 * least-recently painted bitmaps first. An evicted image is not an error —
 * the frame cache observes the miss and re-warms it on demand when its spread
 * becomes active again, so callers protect the active spread's own hrefs to
 * keep the visible canvas stable.
 */
export function touchBrowserReaderDecodedImages(
  images: Map<string, ImageBitmap>,
  hrefs: readonly string[],
): void {
  for (const href of hrefs) {
    const image = images.get(href);
    if (image === undefined) continue;
    images.delete(href);
    images.set(href, image);
  }
}

/** Closes least-recently painted, unprotected bitmaps until under budget. */
export function evictColdBrowserReaderDecodedImages(
  images: Map<string, ImageBitmap>,
  protectedHrefs: ReadonlySet<string>,
): void {
  let decodedBytes = 0;
  for (const image of images.values()) decodedBytes += decodedBitmapBytes(image);
  if (decodedBytes <= DECODED_IMAGE_BYTE_BUDGET) return;
  for (const [href, image] of [...images.entries()]) {
    if (decodedBytes <= DECODED_IMAGE_BYTE_BUDGET) break;
    if (protectedHrefs.has(href)) continue;
    images.delete(href);
    decodedBytes -= decodedBitmapBytes(image);
    try {
      image.close();
    } catch {
      // Eviction is best effort; the entry is already unreachable.
    }
  }
}

function decodedBitmapBytes(image: ImageBitmap): number {
  const bytes = image.width * image.height * 4;
  return Number.isFinite(bytes) ? bytes : 0;
}
