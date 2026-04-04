import type { TocEntry } from '../parser/epub/types';
import type { SpineItem } from '../parser/epub/types';
import type { Spread } from '../layout/types';
import type { ChapterRange } from './types';

/**
 * Resolve a TOC entry to a page number using the chapter-to-page mapping.
 *
 * The TOC entry's `href` references a spine item path (e.g. "chapter2.xhtml" or
 * "chapter2.xhtml#section-1"). This function matches the href against spine items
 * and returns the corresponding start page.
 *
 * @returns The page index for the TOC entry, or undefined if not found.
 */
export function findPageForTocEntry(
  entry: TocEntry,
  chapterMap: ReadonlyMap<string, ChapterRange>,
  spine: readonly SpineItem[],
  manifestHrefs: ReadonlyMap<string, string>,
): number | undefined {
  const spineIdref = findSpineItemForHref(entry.href, spine, manifestHrefs);
  return spineIdref ? chapterMap.get(spineIdref)?.startPage : undefined;
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
): { pageIndex: number; spreadIndex: number } | undefined {
  const pageIndex = findPageForTocEntry(entry, chapterMap, spine, manifestHrefs);
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
): TocEntry | undefined {
  let bestEntry: TocEntry | undefined;
  let bestPage = -1;

  const visit = (entries: readonly TocEntry[]): void => {
    for (const entry of entries) {
      const entryPage = findPageForTocEntry(entry, chapterMap, spine, manifestHrefs);
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

function findSpineItemForHref(
  href: string,
  spine: readonly SpineItem[],
  manifestHrefs: ReadonlyMap<string, string>,
): string | undefined {
  const hrefPath = stripFragment(href);
  if (!hrefPath) return undefined;

  for (const spineItem of spine) {
    const itemHref = manifestHrefs.get(spineItem.idref);
    if (itemHref && matchesManifestHref(itemHref, hrefPath)) {
      return spineItem.idref;
    }
  }

  return undefined;
}

function stripFragment(href: string): string | undefined {
  const [hrefPath] = href.split('#');
  return hrefPath || undefined;
}

function matchesManifestHref(manifestHref: string, hrefPath: string): boolean {
  return manifestHref === hrefPath || manifestHref.endsWith(`/${hrefPath}`);
}
