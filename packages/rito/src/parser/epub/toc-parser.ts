import type { TocEntry } from './types';
import { childElements, parseEpubXmlDocument } from './xml-dom';

/**
 * Parse an EPUB 3 navigation document (XHTML with `<nav epub:type="toc">`).
 *
 * @param xhtml - The raw XHTML string of the nav document.
 * @returns Parsed table of contents entries, or an empty array if none found.
 */
export function parseNavDocument(xhtml: string): readonly TocEntry[] {
  const doc = parseEpubXmlDocument(xhtml, 'application/xhtml+xml', 'EPUB navigation document');

  // Find the <nav> element with epub:type="toc"
  const navElements = doc.getElementsByTagName('nav');
  let tocNav: Element | undefined;
  for (let i = 0; i < navElements.length; i++) {
    const nav = navElements[i];
    if (!nav) continue;
    const epubType =
      nav.getAttribute('epub:type') || nav.getAttributeNS('http://www.idpf.org/2007/ops', 'type');
    if (epubType === 'toc') {
      tocNav = nav;
      break;
    }
  }

  if (!tocNav) return [];

  // The TOC is structured as nested <ol> / <li> / <a>
  const ol = tocNav.getElementsByTagName('ol')[0];
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
  const doc = parseEpubXmlDocument(ncxXml, 'application/xml', 'NCX document');

  const navMap = doc.getElementsByTagName('navMap')[0];
  if (!navMap) return [];

  return parseNavPoints(navMap);
}

/** Recursively parse <li> children of an <ol> element. */
function parseOlEntries(ol: Element): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const li of childElements(ol)) {
    if (li.tagName.toLowerCase() !== 'li') continue;

    const anchor = li.getElementsByTagName('a')[0];
    if (!anchor) continue;

    const label = anchor.textContent.trim();
    const href = anchor.getAttribute('href') ?? '';
    if (!label) continue;

    // Check for nested <ol> for sub-entries
    const nestedOl = findDirectChildOl(li);
    const children = nestedOl ? parseOlEntries(nestedOl) : [];

    entries.push({ label, href, children });
  }
  return entries;
}

/** Find a direct child <ol> of an element (not nested deeper). */
function findDirectChildOl(el: Element): Element | undefined {
  for (const child of childElements(el)) {
    if (child.tagName.toLowerCase() === 'ol') return child;
  }
  return undefined;
}

/** Recursively parse <navPoint> children of a parent element. */
function parseNavPoints(parent: Element): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const np of childElements(parent)) {
    if (np.tagName !== 'navPoint') continue;

    const navLabel = np.getElementsByTagName('navLabel')[0];
    const textEl = navLabel?.getElementsByTagName('text')[0];
    const label = (textEl?.textContent ?? '').trim();

    const contentEl = np.getElementsByTagName('content')[0];
    const href = contentEl?.getAttribute('src') ?? '';

    if (!label) continue;

    // Recursively parse nested navPoints
    const children = parseNavPoints(np);

    entries.push({ label, href, children });
  }
  return entries;
}
