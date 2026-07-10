import type { ElementAttributes } from './types';
import { getAttribute, getAttributeNS, hasAttribute } from '../xml';
import type { XmlElement } from '../xml';

/** Extract the normalized/common attributes and raw CSS-selector attributes. */
export function extractElementAttributes(el: XmlElement): ElementAttributes | undefined {
  const cls = optionalAttribute(el, 'class');
  const style = optionalAttribute(el, 'style');
  const id = optionalAttribute(el, 'id');
  const href = el.localName === 'a' ? optionalAttribute(el, 'href') : undefined;
  const language = extractLanguage(el);
  const { colspan, rowspan } = extractTableCellSpans(el);
  const allAttributes = collectAllAttributes(el);

  const attributes = {
    ...(cls !== undefined ? { class: cls } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(href !== undefined ? { href } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(colspan !== undefined ? { colspan } : {}),
    ...(rowspan !== undefined ? { rowspan } : {}),
    ...(allAttributes !== undefined ? { allAttributes } : {}),
  } satisfies ElementAttributes;

  return Object.keys(attributes).length > 0 ? attributes : undefined;
}

function extractLanguage(el: XmlElement): string | undefined {
  return (
    optionalAttribute(el, 'lang') ??
    optionalAttribute(el, 'xml:lang') ??
    optionalNamespacedAttribute(el, 'http://www.w3.org/XML/1998/namespace', 'lang')
  );
}

function optionalAttribute(el: XmlElement, name: string): string | undefined {
  return hasAttribute(el, name) ? (getAttribute(el, name) ?? '') : undefined;
}

function optionalNamespacedAttribute(
  el: XmlElement,
  namespace: string,
  localName: string,
): string | undefined {
  return getAttributeNS(el, namespace, localName);
}

function collectAllAttributes(el: XmlElement): ReadonlyMap<string, string> | undefined {
  if (el.attributes.length === 0) return undefined;
  const map = new Map<string, string>();
  for (const attr of el.attributes) map.set(attr.qualifiedName, attr.value);
  return map.size > 0 ? map : undefined;
}

function extractTableCellSpans(el: XmlElement): {
  colspan: number | undefined;
  rowspan: number | undefined;
} {
  if (el.localName !== 'td' && el.localName !== 'th') {
    return { colspan: undefined, rowspan: undefined };
  }
  const colspanRaw = parseInt(getAttribute(el, 'colspan') ?? '', 10);
  const rowspanRaw = parseInt(getAttribute(el, 'rowspan') ?? '', 10);
  return {
    colspan: !isNaN(colspanRaw) && colspanRaw > 1 ? colspanRaw : undefined,
    rowspan: !isNaN(rowspanRaw) && rowspanRaw > 1 ? rowspanRaw : undefined,
  };
}
