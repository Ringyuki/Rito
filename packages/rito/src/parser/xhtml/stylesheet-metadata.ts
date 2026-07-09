/** Extract `<link rel="stylesheet">` hrefs from an XHTML document. */
export function extractStylesheetHrefs(doc: Document): string[] {
  const hrefs: string[] = [];
  const links = doc.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const rel = link?.getAttribute('rel')?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.includes('stylesheet')) continue;
    const href = link?.getAttribute('href');
    if (href) hrefs.push(href);
  }
  return hrefs;
}

/** Extract non-empty author CSS from chapter-local `<style>` elements. */
export function extractEmbeddedStylesheets(doc: Document): string[] {
  const stylesheets: string[] = [];
  const styles = doc.getElementsByTagName('style');
  for (let i = 0; i < styles.length; i++) {
    const css = styles[i]?.textContent.trim();
    if (css) stylesheets.push(css);
  }
  return stylesheets;
}
