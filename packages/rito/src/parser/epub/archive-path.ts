import { EpubParseError } from './errors';

const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Normalize a name stored in the ZIP central directory.
 *
 * ZIP entry names are paths rather than URLs, so percent escapes are left
 * literal. Dot segments are still collapsed to give the reader one canonical
 * key for every archive entry.
 */
export function normalizeArchiveEntryPath(path: string): string {
  return normalizePath(path, 'ZIP entry name');
}

/** Resolve an EPUB URL path against a canonical archive directory. */
export function resolveArchiveHref(baseDirectory: string, href: string): string {
  const path = stripQueryAndFragment(href);
  if (!path) throw new EpubParseError(`Invalid empty EPUB resource path: ${href}`);

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new EpubParseError(`Invalid percent escape in EPUB resource path: ${href}`);
  }

  if (URI_SCHEME_RE.test(decoded) || decoded.startsWith('/')) {
    throw new EpubParseError(`External URL is not an EPUB archive path: ${href}`);
  }

  return normalizePath(`${baseDirectory}${decoded}`, 'EPUB resource path');
}

/** Return the canonical archive directory containing a path. */
export function archiveDirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash + 1);
}

/**
 * Express a canonical archive path relative to another canonical directory.
 * The result may start with `../`, but resolving it against `baseDirectory`
 * always remains inside the archive root.
 */
export function relativeArchivePath(baseDirectory: string, path: string): string {
  const base = baseDirectory.replace(/\/$/, '').split('/').filter(Boolean);
  const target = path.split('/').filter(Boolean);
  let common = 0;
  while (common < base.length && base[common] === target[common]) common++;
  return [...base.slice(common).map(() => '..'), ...target.slice(common)].join('/');
}

function stripQueryAndFragment(href: string): string {
  const query = href.indexOf('?');
  const fragment = href.indexOf('#');
  let end = href.length;
  if (query >= 0) end = Math.min(end, query);
  if (fragment >= 0) end = Math.min(end, fragment);
  return href.slice(0, end);
}

function normalizePath(path: string, kind: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || hasControlCharacter(path)) {
    throw new EpubParseError(`Invalid ${kind}: ${path}`);
  }

  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new EpubParseError(`${kind} escapes the EPUB archive root: ${path}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) throw new EpubParseError(`Invalid empty ${kind}: ${path}`);
  return segments.join('/');
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
