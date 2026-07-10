import { findElements, getAttribute, textContent } from '../xml';
import type { XmlDocument } from '../xml';

/** Extract `<link rel="stylesheet">` hrefs from an XHTML document. */
export function extractStylesheetHrefs(doc: XmlDocument): string[] {
  const hrefs: string[] = [];
  for (const link of findElements(doc.root, 'link')) {
    const rel = getAttribute(link, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.includes('stylesheet')) continue;
    const href = getAttribute(link, 'href');
    if (href) hrefs.push(href);
  }
  return hrefs;
}

/** Extract non-empty author CSS from chapter-local `<style>` elements. */
export function extractEmbeddedStylesheets(doc: XmlDocument): string[] {
  const stylesheets: string[] = [];
  for (const style of findElements(doc.root, 'style')) {
    const css = textContent(style).trim();
    if (css) stylesheets.push(css);
  }
  return stylesheets;
}
