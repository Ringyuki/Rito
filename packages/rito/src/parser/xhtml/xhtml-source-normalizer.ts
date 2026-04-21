const XML_DECLARATION_RE = /^(\uFEFF?)<\?xml\s+([^?]*?)\?>/;
const SINGLE_QUOTED_XML_DECLARATION_ATTRIBUTE_RE = /\b(version|encoding|standalone)='([^']*)'/g;
const XHTML_NBSP_ENTITY_RE = /&nbsp;/g;

/**
 * Normalize XHTML source quirks commonly found in EPUB files before XML parsing.
 *
 * The browser DOMParser accepts more XHTML-in-the-wild than happy-dom's XML parser.
 * Keeping this layer narrow makes Node tests match browser behavior without
 * turning malformed markup into a full HTML parser path.
 */
export function normalizeXhtmlSource(source: string): string {
  return replaceXhtmlEntities(normalizeXmlDeclaration(source));
}

function normalizeXmlDeclaration(source: string): string {
  return source.replace(XML_DECLARATION_RE, (_match, bom: string, attributes: string) => {
    const normalizedAttributes = attributes.replace(
      SINGLE_QUOTED_XML_DECLARATION_ATTRIBUTE_RE,
      (_attribute, name: string, value: string) => `${name}="${value}"`,
    );
    return `${bom}<?xml ${normalizedAttributes}?>`;
  });
}

function replaceXhtmlEntities(source: string): string {
  return source.replace(XHTML_NBSP_ENTITY_RE, '&#160;');
}
