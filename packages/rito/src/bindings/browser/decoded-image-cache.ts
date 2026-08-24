/** Explicit byte budget for decoded page bitmaps retained by one session. */
const DECODED_IMAGE_BYTE_BUDGET = 96 * 1024 * 1024;

/**
 * A decoded page image. Element-sourced decodes are preferred where a DOM
 * exists: Chrome scales an HTMLImageElement through the same decode cache
 * DOM <img> painting uses, the only drawImage source that reproduces the
 * browser raster bit for bit (probed; ImageBitmap diverges on some images
 * at every smoothing quality). DOM-less hosts keep ImageBitmap.
 */
export type BrowserReaderDecodedImage = ImageBitmap | HTMLImageElement;

const elementObjectUrls = new WeakMap<HTMLImageElement, string>();

export function registerDecodedImageObjectUrl(element: HTMLImageElement, url: string): void {
  elementObjectUrls.set(element, url);
}

/** Releases a decoded image: closes a bitmap, revokes an element's URL. */
export function closeBrowserReaderDecodedImage(image: BrowserReaderDecodedImage): void {
  if ('close' in image) {
    image.close();
    return;
  }
  const url = elementObjectUrls.get(image);
  if (url !== undefined) {
    elementObjectUrls.delete(image);
    URL.revokeObjectURL(url);
  }
}

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
  images: Map<string, BrowserReaderDecodedImage>,
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
  images: Map<string, BrowserReaderDecodedImage>,
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
      closeBrowserReaderDecodedImage(image);
    } catch {
      // Eviction is best effort; the entry is already unreachable.
    }
  }
}

function decodedBitmapBytes(image: BrowserReaderDecodedImage): number {
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  const bytes = width * height * 4;
  return Number.isFinite(bytes) ? bytes : 0;
}
