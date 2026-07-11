/** Pre-computed lookup tables for O(1) href resolution. */
interface HrefIndex<T> {
  readonly rawExact: ReadonlyMap<string, T>;
  readonly paths: HrefLookupIndex<T>;
  readonly aliases: HrefLookupIndex<T>;
}

interface HrefLookupIndex<T> {
  readonly byHref: ReadonlyMap<string, T | null>;
  readonly bySuffix: ReadonlyMap<string, T | null>;
  readonly byBasename: ReadonlyMap<string, T | null>;
}

interface MutableHrefLookupIndex<T> {
  readonly byHref: Map<string, T | null>;
  readonly bySuffix: Map<string, T | null>;
  readonly byBasename: Map<string, T | null>;
}

const AMBIGUOUS_HREF = Symbol('ambiguous resource href');

/**
 * Build a lookup function that resolves an EPUB-internal src reference
 * (e.g., `../Images/cover.jpg`) against a map keyed by manifest hrefs
 * (e.g., `Images/cover.jpg`).
 *
 * An exact raw source/key match always wins. Remaining path matching ignores
 * URL query/fragment suffixes; after that, one valid percent-decoding pass is
 * applied symmetrically to the source and keys.
 */
export function buildHrefResolver<T>(
  resources: ReadonlyMap<string, T>,
): (src: string) => T | undefined {
  const index = buildHrefIndex(resources);
  return (src) => {
    const exact = index.rawExact.get(src);
    if (exact !== undefined) return exact;
    const path = resolveAgainstIndex(index.paths, sourcePath(src), true);
    if (path === AMBIGUOUS_HREF) return undefined;
    if (path !== undefined) return path;
    const alias = sourceAlias(src);
    if (alias === undefined) return undefined;
    const resolved = resolveAgainstIndex(index.aliases, alias, true);
    return resolved === AMBIGUOUS_HREF ? undefined : resolved;
  };
}

function buildHrefIndex<T>(resources: ReadonlyMap<string, T>): HrefIndex<T> {
  const rawExact = new Map<string, T>();
  const paths = emptyLookupIndex<T>();
  const aliases = emptyLookupIndex<T>();

  for (const [href, value] of resources) {
    rawExact.set(href, value);
    insertHref(paths, resourcePath(href), value);
    insertHref(aliases, resourceAlias(href), value);
  }

  return { rawExact, paths, aliases };
}

function emptyLookupIndex<T>(): MutableHrefLookupIndex<T> {
  return {
    byHref: new Map(),
    bySuffix: new Map(),
    byBasename: new Map(),
  };
}

function insertHref<T>(index: MutableHrefLookupIndex<T>, href: string, value: T): void {
  insertUnique(index.byHref, href, value);

  const parts = href.split('/');
  for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
    insertUnique(index.bySuffix, parts.slice(partIndex).join('/'), value);
  }
  insertUnique(index.byBasename, parts.at(-1) ?? href, value);
}

function insertUnique<T>(values: Map<string, T | null>, key: string, value: T): void {
  values.set(key, values.has(key) ? null : value);
}

function resolveAgainstIndex<T>(
  { byHref, bySuffix, byBasename }: HrefLookupIndex<T>,
  src: string,
  stopOnAmbiguous: boolean,
): T | typeof AMBIGUOUS_HREF | undefined {
  const exact = lookupCandidate(byHref, src, stopOnAmbiguous);
  if (exact !== undefined) return exact;

  const normalized = stripRelativePrefix(src);
  if (normalized !== src) {
    const afterStrip = lookupCandidate(byHref, normalized, stopOnAmbiguous);
    if (afterStrip !== undefined) return afterStrip;
  }
  const suffixDirect = lookupCandidate(bySuffix, normalized, stopOnAmbiguous);
  if (suffixDirect !== undefined) return suffixDirect;

  const srcParts = normalized.split('/');
  for (let index = 1; index < srcParts.length; index += 1) {
    const hrefMatch = lookupCandidate(byHref, srcParts.slice(index).join('/'), stopOnAmbiguous);
    if (hrefMatch !== undefined) return hrefMatch;
  }

  const srcBasename = srcParts.at(-1);
  if (srcBasename) return lookupCandidate(byBasename, srcBasename, stopOnAmbiguous);
  return undefined;
}

function lookupCandidate<T>(
  values: ReadonlyMap<string, T | null>,
  key: string,
  stopOnAmbiguous: boolean,
): T | typeof AMBIGUOUS_HREF | undefined {
  const value = values.get(key);
  if (value !== null) return value;
  return stopOnAmbiguous ? AMBIGUOUS_HREF : undefined;
}

function stripRelativePrefix(src: string): string {
  let normalized = src;
  while (normalized.startsWith('../')) normalized = normalized.slice(3);
  return normalized;
}

function sourceAlias(href: string): string | undefined {
  return percentDecode(sourcePath(href));
}

function resourceAlias(href: string): string {
  const path = resourcePath(href);
  return percentDecode(path) ?? path;
}

function resourcePath(href: string): string {
  return sourcePath(href);
}

function sourcePath(href: string): string {
  const query = href.indexOf('?');
  const fragment = href.indexOf('#');
  let end = href.length;
  if (query >= 0) end = Math.min(end, query);
  if (fragment >= 0) end = Math.min(end, fragment);
  return href.slice(0, end);
}

function percentDecode(src: string): string | undefined {
  if (!src.includes('%')) return src;
  try {
    return decodeURIComponent(src);
  } catch {
    return undefined;
  }
}
