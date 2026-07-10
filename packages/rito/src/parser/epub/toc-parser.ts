import type { TocEntry } from './types';
import {
  childElements,
  findElements,
  findFirstDescendant,
  findFirstElement,
  getAttribute,
  getAttributeNS,
  textContent,
} from '../xml';
import type { XmlElement } from '../xml';
import { parseEpubXml } from './xml';

/**
 * Parse an EPUB 3 navigation document (XHTML with `<nav epub:type="toc">`).
 *
 * @param xhtml - The raw XHTML string of the nav document.
 * @returns Parsed table of contents entries, or an empty array if none found.
 */
export function parseNavDocument(xhtml: string): readonly TocEntry[] {
  const doc = parseEpubXml(xhtml, 'EPUB navigation document');

  // Find the <nav> element with epub:type="toc"
  let tocNav: XmlElement | undefined;
  for (const nav of findElements(doc.root, 'nav')) {
    const epubType =
      getAttribute(nav, 'epub:type') || getAttributeNS(nav, 'http://www.idpf.org/2007/ops', 'type');
    if (epubType === 'toc') {
      tocNav = nav;
      break;
    }
  }

  if (!tocNav) return [];

  // The TOC is structured as nested <ol> / <li> / <a>
  const ol = findFirstDescendant(tocNav, 'ol');
  if (!ol) return [];

  return parseOlEntries(ol);
}

/**
 * Parse an EPUB 2 NCX document.
 *
 * @param ncxXml - The raw XML string of the NCX file.
 * @returns Parsed table of contents entries, or an empty array if none found.
 */
export function parseNcx(ncxXml: string): readonly TocEntry[] {
  const doc = parseEpubXml(ncxXml, 'NCX document');

  const navMap = findFirstElement(doc.root, 'navMap');
  if (!navMap) return [];

  return parseNavPoints(navMap);
}

/** Recursively parse <li> children of an <ol> element. */
function parseOlEntries(ol: XmlElement): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const li of childElements(ol)) {
    if (li.qualifiedName.toLowerCase() !== 'li') continue;

    const anchor = findFirstDescendant(li, 'a');
    if (!anchor) continue;

    const label = textContent(anchor).trim();
    const href = getAttribute(anchor, 'href') ?? '';
    if (!label) continue;

    // Check for nested <ol> for sub-entries
    const nestedOl = findDirectChildOl(li);
    const children = nestedOl ? parseOlEntries(nestedOl) : [];

    entries.push({ label, href, children });
  }
  return entries;
}

/** Find a direct child <ol> of an element (not nested deeper). */
function findDirectChildOl(el: XmlElement): XmlElement | undefined {
  for (const child of childElements(el)) {
    if (child.qualifiedName.toLowerCase() === 'ol') return child;
  }
  return undefined;
}

/** Recursively parse <navPoint> children of a parent element. */
function parseNavPoints(parent: XmlElement): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const np of childElements(parent)) {
    if (np.qualifiedName !== 'navPoint') continue;

    const navLabel = findFirstDescendant(np, 'navLabel');
    const textEl = navLabel ? findFirstDescendant(navLabel, 'text') : undefined;
    const label = textEl ? textContent(textEl).trim() : '';

    const contentEl = findFirstDescendant(np, 'content');
    const href = contentEl ? (getAttribute(contentEl, 'src') ?? '') : '';

    if (!label) continue;

    // Recursively parse nested navPoints
    const children = parseNavPoints(np);

    entries.push({ label, href, children });
  }
  return entries;
}
