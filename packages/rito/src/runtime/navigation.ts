import type { TocEntry } from '../parser/epub/types';
import type { SpineItem } from '../parser/epub/types';
import type { Spread } from '../layout/core/types';
import { buildHrefResolver } from '../utils/resolve-href';
import type { ChapterRange } from './types';

/**
 * Resolve a TOC entry to a page number using the chapter-to-page mapping.
 *
 * The TOC entry's `href` references a spine item path (e.g. "chapter2.xhtml" or
 * "chapter2.xhtml#section-1"). This function matches the href against spine items
 * and returns the corresponding start page.
 *
 * When an `anchorMap` is provided and the href contains a `#fragment`, the function
 * returns the precise page for that anchor rather than the chapter start page.
 *
 * @returns The page index for the TOC entry, or undefined if not found.
 */
export function findPageForTocEntry(
  entry: TocEntry,
  chapterMap: ReadonlyMap<string, ChapterRange>,
  spine: readonly SpineItem[],
  manifestHrefs: ReadonlyMap<string, string>,
  anchorMap?: ReadonlyMap<string, number>,
): number | undefined {
  const [hrefPath, fragment] = splitHrefAndFragment(entry.href);
  if (!hrefPath) return undefined;

  const spineIdref = findSpineItemForHref(hrefPath, spine, manifestHrefs);
  if (!spineIdref) return undefined;

  const chapterRange = chapterMap.get(spineIdref);
  if (!chapterRange) return undefined;

  // Try precise anchor lookup, scoped to the target chapter's page range
  if (fragment && anchorMap) {
    const anchorPage = anchorMap.get(fragment);
    if (
      anchorPage !== undefined &&
      anchorPage >= chapterRange.startPage &&
      anchorPage <= chapterRange.endPage
    ) {
      return anchorPage;
    }
  }

  return chapterRange.startPage;
}

/** Find the spread index containing a given page index. */
export function findSpreadForPage(
  pageIndex: number,
  spreads: readonly Spread[],
): number | undefined {
  for (let i = 0; i < spreads.length; i++) {
    const spread = spreads[i];
    if (spread?.left?.index === pageIndex || spread?.right?.index === pageIndex) return i;
  }
  return undefined;
}

/** Resolve a TOC entry to both page and spread indices. */
export function resolveTocEntryLocation(
  entry: TocEntry,
  chapterMap: ReadonlyMap<string, ChapterRange>,
  spine: readonly SpineItem[],
  manifestHrefs: ReadonlyMap<string, string>,
  spreads: readonly Spread[],
  anchorMap?: ReadonlyMap<string, number>,
): { pageIndex: number; spreadIndex: number } | undefined {
  const pageIndex = findPageForTocEntry(entry, chapterMap, spine, manifestHrefs, anchorMap);
  if (pageIndex === undefined) return undefined;
  const spreadIndex = findSpreadForPage(pageIndex, spreads);
  return spreadIndex === undefined ? undefined : { pageIndex, spreadIndex };
}

/** Find the last TOC entry whose page is at or before the given page index. */
export function findActiveTocEntryForPage(
  toc: readonly TocEntry[],
  pageIndex: number,
  chapterMap: ReadonlyMap<string, ChapterRange>,
  spine: readonly SpineItem[],
  manifestHrefs: ReadonlyMap<string, string>,
  anchorMap?: ReadonlyMap<string, number>,
): TocEntry | undefined {
  let bestEntry: TocEntry | undefined;
  let bestPage = -1;

  const visit = (entries: readonly TocEntry[]): void => {
    for (const entry of entries) {
      const entryPage = findPageForTocEntry(entry, chapterMap, spine, manifestHrefs, anchorMap);
      if (entryPage !== undefined && entryPage <= pageIndex && entryPage >= bestPage) {
        bestEntry = entry;
        bestPage = entryPage;
      }
      if (entry.children.length > 0) visit(entry.children);
    }
  };

  visit(toc);
  return bestEntry;
}

/**
 * Find the spine idref whose manifest href matches the given path (already fragment-stripped).
 * Uses the same ambiguity-aware resolver as image/font resolution — ambiguous suffix/basename
 * matches return undefined instead of silently picking the first hit.
 */
function findSpineItemForHref(
  hrefPath: string,
  spine: readonly SpineItem[],
  manifestHrefs: ReadonlyMap<string, string>,
): string | undefined {
  // Build inverted map: manifestHref → idref (only for spine items)
  const hrefToIdref = new Map<string, string>();
  for (const item of spine) {
    const href = manifestHrefs.get(item.idref);
    if (href) hrefToIdref.set(href, item.idref);
  }

  return buildHrefResolver(hrefToIdref)(hrefPath);
}

/** Split an href into [path, fragment]. Fragment is undefined when absent. */
function splitHrefAndFragment(href: string): [string | undefined, string | undefined] {
  const hashIdx = href.indexOf('#');
  if (hashIdx < 0) return [href || undefined, undefined];
  const path = href.slice(0, hashIdx) || undefined;
  const fragment = href.slice(hashIdx + 1) || undefined;
  return [path, fragment];
}
