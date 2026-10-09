import type { PackageMetadata, TocEntry } from '../../../reader';
import type { BrowserReaderLocator, BrowserReaderPublication } from '../reader-session';

type PublicationTocEntry = BrowserReaderPublication['toc'][number];

/** The publication as a reader exposes it: metadata, the TOC tree and the spine. */
export interface SessionReaderPublication {
  readonly metadata: PackageMetadata;
  readonly toc: readonly TocEntry[];
  /** Each spine item's href by its idref. */
  readonly manifestHrefMap: ReadonlyMap<string, string>;
  /** Spine idrefs by spine index. */
  readonly spineIdrefs: readonly string[];
  readonly spineIndexByHref: ReadonlyMap<string, number>;
  /** The engine's id of a TOC entry: by identity, else the first entry with its href. */
  tocId(entry: TocEntry): number | undefined;
  tocEntry(tocId: number): TocEntry | undefined;
  /** Where a TOC entry points inside the book; undefined for an external or unresolved one. */
  tocLocator(tocId: number): BrowserReaderLocator | undefined;
}

export function createSessionReaderPublication(
  publication: BrowserReaderPublication,
): SessionReaderPublication {
  const idByEntry = new Map<TocEntry, number>();
  const idByHref = new Map<string, number>();
  const entryById = new Map<number, TocEntry>();
  const locatorById = new Map<number, BrowserReaderLocator>();
  const convert = (source: PublicationTocEntry): TocEntry => {
    const entry: TocEntry = {
      label: source.label,
      href: tocHref(source),
      children: source.children.map(convert),
    };
    idByEntry.set(entry, source.tocId);
    entryById.set(source.tocId, entry);
    if (source.target.kind === 'locator') locatorById.set(source.tocId, source.target.locator);
    return entry;
  };
  const toc = publication.toc.map(convert);
  // Preorder, so the first entry naming an href is the one a lookup by href finds.
  for (const tocId of [...entryById.keys()].sort((a, b) => a - b)) {
    const href = entryById.get(tocId)?.href;
    if (href !== undefined && !idByHref.has(href)) idByHref.set(href, tocId);
  }
  return {
    metadata: metadata(publication),
    toc,
    manifestHrefMap: new Map(publication.spine.map((item) => [item.idref, item.href])),
    spineIdrefs: publication.spine.map((item) => item.idref),
    spineIndexByHref: new Map(publication.spine.map((item) => [item.href, item.spineIndex])),
    tocId: (entry) => idByEntry.get(entry) ?? idByHref.get(entry.href),
    tocEntry: (tocId) => entryById.get(tocId),
    tocLocator: (tocId) => locatorById.get(tocId),
  };
}

/** A TOC entry's href as a reader shows and matches it: the chapter, then `#anchor`. */
function tocHref(entry: PublicationTocEntry): string {
  if (entry.target.kind !== 'locator') return entry.target.href;
  const { href, anchorId } = entry.target.locator;
  return anchorId === undefined ? href : `${href}#${anchorId}`;
}

function metadata(publication: BrowserReaderPublication): PackageMetadata {
  const { title, language, identifier, creator } = publication.metadata;
  return { title, language, identifier, ...(creator === undefined ? {} : { creator }) };
}
