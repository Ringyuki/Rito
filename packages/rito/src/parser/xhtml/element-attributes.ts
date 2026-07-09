import type { ElementAttributes } from './types';

/** Extract the normalized/common attributes and raw CSS-selector attributes. */
export function extractElementAttributes(el: Element): ElementAttributes | undefined {
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

function extractLanguage(el: Element): string | undefined {
  return (
    optionalAttribute(el, 'lang') ??
    optionalAttribute(el, 'xml:lang') ??
    optionalNamespacedAttribute(el, 'http://www.w3.org/XML/1998/namespace', 'lang')
  );
}

function optionalAttribute(el: Element, name: string): string | undefined {
  return el.hasAttribute(name) ? (el.getAttribute(name) ?? '') : undefined;
}

function optionalNamespacedAttribute(
  el: Element,
  namespace: string,
  localName: string,
): string | undefined {
  return el.hasAttributeNS(namespace, localName)
    ? (el.getAttributeNS(namespace, localName) ?? '')
    : undefined;
}

function collectAllAttributes(el: Element): ReadonlyMap<string, string> | undefined {
  if (el.attributes.length === 0) return undefined;
  const map = new Map<string, string>();
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr) map.set(attr.name, attr.value);
  }
  return map.size > 0 ? map : undefined;
}

function extractTableCellSpans(el: Element): {
  colspan: number | undefined;
  rowspan: number | undefined;
} {
  if (el.localName !== 'td' && el.localName !== 'th') {
    return { colspan: undefined, rowspan: undefined };
  }
  const colspanRaw = parseInt(el.getAttribute('colspan') ?? '', 10);
  const rowspanRaw = parseInt(el.getAttribute('rowspan') ?? '', 10);
  return {
    colspan: !isNaN(colspanRaw) && colspanRaw > 1 ? colspanRaw : undefined,
    rowspan: !isNaN(rowspanRaw) && rowspanRaw > 1 ? rowspanRaw : undefined,
  };
}
