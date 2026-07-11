interface ImageHrefIndex {
  readonly raw: ImageHrefLookupIndex;
  readonly aliases: ImageHrefLookupIndex;
}

interface ImageHrefLookupIndex {
  readonly byHref: ReadonlyMap<string, ImageBitmap | null>;
  readonly bySuffix: ReadonlyMap<string, ImageBitmap | null>;
  readonly byBasename: ReadonlyMap<string, ImageBitmap | null>;
}

interface MutableImageHrefLookupIndex {
  readonly byHref: Map<string, ImageBitmap | null>;
  readonly bySuffix: Map<string, ImageBitmap | null>;
  readonly byBasename: Map<string, ImageBitmap | null>;
}

const AMBIGUOUS_HREF = Symbol('ambiguous image href');

/** Resolve frame image hrefs against the manifest-keyed browser bitmap cache. */
export function createCanvasImageResolver(
  images: ReadonlyMap<string, ImageBitmap>,
): (src: string) => ImageBitmap | undefined {
  const index = buildImageHrefIndex(images);
  return (src) => {
    const direct = resolveAgainstIndex(index.raw, src, false);
    if (direct !== undefined && direct !== AMBIGUOUS_HREF) return direct;
    const alias = percentDecode(src);
    if (alias === undefined) return undefined;
    const resolved = resolveAgainstIndex(index.aliases, alias, true);
    return resolved === AMBIGUOUS_HREF ? undefined : resolved;
  };
}

function buildImageHrefIndex(images: ReadonlyMap<string, ImageBitmap>): ImageHrefIndex {
  const raw = emptyLookupIndex();
  const aliases = emptyLookupIndex();

  for (const [href, image] of images) {
    insertHref(raw, href, image, false);
    insertHref(aliases, percentDecode(href) ?? href, image, true);
  }

  return { raw, aliases };
}

function emptyLookupIndex(): MutableImageHrefLookupIndex {
  return {
    byHref: new Map(),
    bySuffix: new Map(),
    byBasename: new Map(),
  };
}

function insertHref(
  index: MutableImageHrefLookupIndex,
  href: string,
  image: ImageBitmap,
  exactCanConflict: boolean,
): void {
  if (exactCanConflict) insertUnique(index.byHref, href, image);
  else index.byHref.set(href, image);
  const parts = href.split('/');
  for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
    insertUnique(index.bySuffix, parts.slice(partIndex).join('/'), image);
  }
  insertUnique(index.byBasename, parts.at(-1) ?? href, image);
}

function insertUnique(
  values: Map<string, ImageBitmap | null>,
  key: string,
  image: ImageBitmap,
): void {
  values.set(key, values.has(key) ? null : image);
}

function resolveAgainstIndex(
  hrefIndex: ImageHrefLookupIndex,
  src: string,
  stopOnAmbiguous: boolean,
): ImageBitmap | typeof AMBIGUOUS_HREF | undefined {
  const exact = lookupCandidate(hrefIndex.byHref, src, stopOnAmbiguous);
  if (exact !== undefined) return exact;

  const normalized = stripRelativePrefix(src);
  const suffix = lookupCandidate(hrefIndex.bySuffix, normalized, stopOnAmbiguous);
  if (suffix !== undefined) return suffix;

  if (normalized !== src) {
    const stripped = lookupCandidate(hrefIndex.byHref, normalized, stopOnAmbiguous);
    if (stripped !== undefined) return stripped;
  }

  const parts = normalized.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const href = lookupCandidate(hrefIndex.byHref, parts.slice(index).join('/'), stopOnAmbiguous);
    if (href !== undefined) return href;
  }

  const basename = parts.at(-1);
  if (basename) {
    return lookupCandidate(hrefIndex.byBasename, basename, stopOnAmbiguous);
  }
  return undefined;
}

function lookupCandidate(
  values: ReadonlyMap<string, ImageBitmap | null>,
  key: string,
  stopOnAmbiguous: boolean,
): ImageBitmap | typeof AMBIGUOUS_HREF | undefined {
  const value = values.get(key);
  if (value !== null) return value;
  return stopOnAmbiguous ? AMBIGUOUS_HREF : undefined;
}

function stripRelativePrefix(src: string): string {
  let normalized = src;
  while (normalized.startsWith('../')) normalized = normalized.slice(3);
  return normalized;
}

function percentDecode(src: string): string | undefined {
  if (!src.includes('%')) return src;
  try {
    return decodeURIComponent(src);
  } catch {
    return undefined;
  }
}
