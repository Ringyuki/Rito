import type { PaginationResult } from '../types';
import { createReaderSessionError } from './errors';
import type { ReaderRevisionRecord } from './revision';
import type {
  ReaderFootnotePayload,
  ReaderFootnoteRef,
  ReaderRevisionId,
  ReaderSessionId,
} from './types';

export interface ResolveReaderFootnoteRefInput {
  readonly href: string;
  readonly pageIndex?: number;
  readonly pagination: PaginationResult;
  readonly manifestHrefs: ReadonlyMap<string, string>;
}

export interface ReadReaderFootnoteInput {
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly record: ReaderRevisionRecord;
  readonly ref: ReaderFootnoteRef;
}

export function resolveReaderFootnoteRef(
  input: ResolveReaderFootnoteRefInput,
): ReaderFootnoteRef | undefined {
  const href = resolveFootnoteHref(input);
  if (href === undefined || !input.pagination.footnoteMap.has(href)) return undefined;
  return { href };
}

export function readReaderFootnote(input: ReadReaderFootnoteInput): ReaderFootnotePayload {
  const footnote = input.record.pagination?.footnoteMap.get(input.ref.href);
  if (!footnote) {
    throw createReaderSessionError(
      input.sessionId,
      input.revisionId,
      'not-found',
      `Footnote ${input.ref.href} is not available`,
    );
  }
  return { ref: input.ref, footnote };
}

function resolveFootnoteHref(input: ResolveReaderFootnoteRefInput): string | undefined {
  const split = splitHref(input.href);
  if (!split) return undefined;

  if (split.path === undefined) {
    const chapterHref = pageChapterHref(input.pagination, input.manifestHrefs, input.pageIndex);
    return chapterHref ? `${chapterHref}#${split.fragment}` : undefined;
  }

  const chapterHref = pageChapterHref(input.pagination, input.manifestHrefs, input.pageIndex);
  const resolved = resolveManifestHrefStrict(split.path, input.manifestHrefs, chapterHref);
  return resolved ? `${resolved}#${split.fragment}` : undefined;
}

function pageChapterHref(
  pagination: PaginationResult,
  manifestHrefs: ReadonlyMap<string, string>,
  pageIndex: number | undefined,
): string | undefined {
  if (pageIndex === undefined) return undefined;
  for (const [idref, range] of pagination.chapterMap) {
    if (pageIndex < range.startPage || pageIndex > range.endPage) continue;
    return manifestHrefs.get(idref);
  }
  return undefined;
}

function resolveManifestHrefStrict(
  path: string,
  manifestHrefs: ReadonlyMap<string, string>,
  currentChapterHref: string | undefined,
): string | undefined {
  if (!isInternalHrefPath(path)) return undefined;
  const hrefs = new Set(manifestHrefs.values());
  if (hrefs.has(path)) return path;
  const relative = currentChapterHref
    ? normalizeRelativePath(currentChapterHref, path)
    : normalizePath(path);
  return relative !== undefined && hrefs.has(relative) ? relative : undefined;
}

function isInternalHrefPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith('//') || path.startsWith('/')) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false;
  return !path.includes('?');
}

function normalizeRelativePath(baseHref: string, path: string): string | undefined {
  const slash = baseHref.lastIndexOf('/');
  const baseDir = slash >= 0 ? baseHref.slice(0, slash + 1) : '';
  return normalizePath(`${baseDir}${path}`);
}

function normalizePath(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part.length === 0 || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join('/') : undefined;
}

function splitHref(
  href: string,
): { readonly path?: string; readonly fragment: string } | undefined {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) return undefined;
  const fragment = href.slice(hashIndex + 1);
  if (fragment.length === 0) return undefined;
  const path = href.slice(0, hashIndex);
  return path ? { path, fragment } : { fragment };
}
