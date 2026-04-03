/** Pre-computed lookup tables for O(1) href resolution. */
interface HrefIndex<T> {
  readonly byHref: ReadonlyMap<string, T>;
  readonly bySuffix: ReadonlyMap<string, T | null>;
  readonly byBasename: ReadonlyMap<string, T | null>;
}

/** Build index maps from resource hrefs for fast lookup. */
function buildHrefIndex<T>(resources: ReadonlyMap<string, T>): HrefIndex<T> {
  const byHref = new Map<string, T>();
  // null = ambiguous (multiple hrefs share this suffix or basename)
  const bySuffix = new Map<string, T | null>();
  const byBasename = new Map<string, T | null>();

  for (const [href, value] of resources) {
    byHref.set(href, value);

    // Build suffix entries for every trailing path segment of this href.
    // e.g. "OEBPS/Images/cover.jpg" -> suffixes: "Images/cover.jpg", "cover.jpg"
    // The full href itself is already in byHref, so we skip it for bySuffix.
    const parts = href.split('/');
    for (let i = 1; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      bySuffix.set(suffix, bySuffix.has(suffix) ? null : value);
    }

    const basename = parts[parts.length - 1] ?? href;
    byBasename.set(basename, byBasename.has(basename) ? null : value);
  }

  return { byHref, bySuffix, byBasename };
}

/** Strip leading "../" segments from a path. */
function stripRelativePrefix(src: string): string {
  let normalized = src;
  while (normalized.startsWith('../')) {
    normalized = normalized.slice(3);
  }
  return normalized;
}

/**
 * Build a lookup function that resolves an EPUB-internal src reference
 * (e.g., `../Images/cover.jpg`) against a map keyed by manifest hrefs
 * (e.g., `Images/cover.jpg`).
 *
 * The lookup tries in order:
 * 1. Exact match on the href key
 * 2. Suffix match via pre-built suffix map (O(1) per path depth)
 * 3. Basename match (only if the basename is unique in the map)
 */
export function buildHrefResolver<T>(
  resources: ReadonlyMap<string, T>,
): (src: string) => T | undefined {
  const { byHref, bySuffix, byBasename } = buildHrefIndex(resources);

  return (src: string): T | undefined => {
    // 1. Exact match
    const exact = byHref.get(src);
    if (exact !== undefined) return exact;

    // 2. Suffix match via pre-built maps.
    const normalized = stripRelativePrefix(src);

    // Check normalized src in suffix map: handles href.endsWith(src) case.
    const suffixDirect = bySuffix.get(normalized);
    if (suffixDirect !== undefined && suffixDirect !== null) return suffixDirect;

    // Check if stripping ../ yields an exact href match.
    if (normalized !== src) {
      const afterStrip = byHref.get(normalized);
      if (afterStrip !== undefined) return afterStrip;
    }

    // Check path suffixes of normalized src against exact hrefs:
    // handles src.endsWith(href) case.
    const srcParts = normalized.split('/');
    for (let i = 1; i < srcParts.length; i++) {
      const srcSuffix = srcParts.slice(i).join('/');
      const hrefMatch = byHref.get(srcSuffix);
      if (hrefMatch !== undefined) return hrefMatch;
    }

    // 3. Basename match (only if unambiguous)
    const srcBasename = srcParts[srcParts.length - 1];
    if (srcBasename) {
      const match = byBasename.get(srcBasename);
      if (match !== undefined && match !== null) return match;
    }

    return undefined;
  };
}
