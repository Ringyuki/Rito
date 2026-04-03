import type { TocEntry } from '../parser/epub/types';
import type { SpineItem } from '../parser/epub/types';
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
  // Strip fragment identifier
  const [hrefPath] = entry.href.split('#');
  if (!hrefPath) return undefined;

  // Find the spine item whose manifest href matches the TOC entry href
  for (const spineItem of spine) {
    const itemHref = manifestHrefs.get(spineItem.idref);
    if (!itemHref) continue;

    if (itemHref === hrefPath || itemHref.endsWith(`/${hrefPath}`)) {
      const range = chapterMap.get(spineItem.idref);
      return range?.startPage;
    }
  }

  return undefined;
}
