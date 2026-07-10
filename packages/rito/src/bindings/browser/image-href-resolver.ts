interface ImageHrefIndex {
  readonly byHref: ReadonlyMap<string, ImageBitmap>;
  readonly bySuffix: ReadonlyMap<string, ImageBitmap | null>;
  readonly byBasename: ReadonlyMap<string, ImageBitmap | null>;
}

/** Resolve frame image hrefs against the manifest-keyed browser bitmap cache. */
export function createCanvasImageResolver(
  images: ReadonlyMap<string, ImageBitmap>,
): (src: string) => ImageBitmap | undefined {
  const index = buildImageHrefIndex(images);
  return (src) => {
    const direct = resolveAgainstIndex(index, src);
    if (direct !== undefined) return direct;
    const decoded = percentDecode(src);
    return decoded === src ? undefined : resolveAgainstIndex(index, decoded);
  };
}

function buildImageHrefIndex(images: ReadonlyMap<string, ImageBitmap>): ImageHrefIndex {
  const byHref = new Map<string, ImageBitmap>();
  const bySuffix = new Map<string, ImageBitmap | null>();
  const byBasename = new Map<string, ImageBitmap | null>();

  for (const [href, image] of images) {
    byHref.set(href, image);
    const parts = href.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const suffix = parts.slice(index).join('/');
      bySuffix.set(suffix, bySuffix.has(suffix) ? null : image);
    }
    const basename = parts.at(-1) ?? href;
    byBasename.set(basename, byBasename.has(basename) ? null : image);
  }

  return { byHref, bySuffix, byBasename };
}

function resolveAgainstIndex(hrefIndex: ImageHrefIndex, src: string): ImageBitmap | undefined {
  const exact = hrefIndex.byHref.get(src);
  if (exact !== undefined) return exact;

  const normalized = stripRelativePrefix(src);
  const suffix = hrefIndex.bySuffix.get(normalized);
  if (suffix !== undefined && suffix !== null) return suffix;

  if (normalized !== src) {
    const stripped = hrefIndex.byHref.get(normalized);
    if (stripped !== undefined) return stripped;
  }

  const parts = normalized.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const href = hrefIndex.byHref.get(parts.slice(index).join('/'));
    if (href !== undefined) return href;
  }

  const basename = parts.at(-1);
  if (basename) {
    const match = hrefIndex.byBasename.get(basename);
    if (match !== undefined && match !== null) return match;
  }
  return undefined;
}

function stripRelativePrefix(src: string): string {
  let normalized = src;
  while (normalized.startsWith('../')) normalized = normalized.slice(3);
  return normalized;
}

function percentDecode(src: string): string {
  if (!src.includes('%')) return src;
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}
