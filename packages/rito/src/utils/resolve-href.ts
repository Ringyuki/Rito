/**
 * Build a lookup function that resolves an EPUB-internal src reference
 * (e.g., `../Images/cover.jpg`) against a map keyed by manifest hrefs
 * (e.g., `Images/cover.jpg`).
 *
 * The lookup tries in order:
 * 1. Exact match on the href key
 * 2. Suffix match (src ends with href or vice-versa, excluding ambiguous basenames)
 * 3. Basename match (only if the basename is unique in the map)
 */
export function buildHrefResolver<T>(
  resources: ReadonlyMap<string, T>,
): (src: string) => T | undefined {
  const byHref = new Map<string, T>();
  const byBasename = new Map<string, T | null>(); // null = ambiguous (multiple matches)

  for (const [href, value] of resources) {
    byHref.set(href, value);
    const basename = href.split('/').pop() ?? href;
    if (byBasename.has(basename)) {
      byBasename.set(basename, null); // ambiguous
    } else {
      byBasename.set(basename, value);
    }
  }

  return (src: string): T | undefined => {
    // 1. Exact match
    const exact = byHref.get(src);
    if (exact !== undefined) return exact;

    // 2. Suffix match (handles ../relative paths)
    for (const [href, value] of byHref) {
      if (src.endsWith(href) || href.endsWith(src)) return value;
    }

    // 3. Basename match (only if unambiguous)
    const srcBasename = src.split('/').pop();
    if (srcBasename) {
      const match = byBasename.get(srcBasename);
      if (match !== undefined && match !== null) return match;
    }

    return undefined;
  };
}
