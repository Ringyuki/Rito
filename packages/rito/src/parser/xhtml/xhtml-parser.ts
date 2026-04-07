import type { BlockNode, DocumentNode, ElementAttributes, InlineNode, TextNode } from './types';
import { NODE_TYPES } from './types';
import { XhtmlParseError } from './errors';
import { classifyTag } from './tag-classifier';
import { collapseWhitespace, isWhitespaceOnly } from './text-normalizer';

/** Warnings collected during parsing for unsupported elements. */
export interface ParseResult {
  readonly nodes: readonly DocumentNode[];
  readonly warnings: readonly string[];
}

/**
 * Parse an XHTML chapter string into a DocumentNode tree.
 * Returns the nodes from the <body> element, or all root-level nodes if no body is found.
 */
export function parseXhtml(xhtml: string): ParseResult {
  const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new XhtmlParseError(`Invalid XHTML: ${parserError.textContent}`);
  }

  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
  const warnings: string[] = [];
  const nodes = convertChildren(body, warnings, false, []);

  return { nodes, warnings };
}

function convertChildren(
  parent: Element,
  warnings: string[],
  preserveWhitespace: boolean,
  parentPath: readonly number[],
): DocumentNode[] {
  const result: DocumentNode[] = [];
  let emittedIndex = 0;

  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (!child) continue;

    const childPath = [...parentPath, emittedIndex];
    const node = convertNode(child, warnings, preserveWhitespace, childPath);
    if (node) {
      result.push(node);
      emittedIndex++;
    }
  }

  return result;
}

function convertNode(
  domNode: Node,
  warnings: string[],
  preserveWhitespace: boolean,
  nodePath: readonly number[],
): DocumentNode | undefined {
  if (domNode.nodeType === Node.TEXT_NODE) {
    return convertTextNode(domNode, preserveWhitespace, nodePath);
  }

  if (domNode.nodeType === Node.ELEMENT_NODE) {
    return convertElement(domNode as Element, warnings, preserveWhitespace, nodePath);
  }

  // Ignore comments, processing instructions, etc.
  return undefined;
}

function convertTextNode(
  domNode: Node,
  preserveWhitespace: boolean,
  nodePath: readonly number[],
): TextNode | undefined {
  const raw = domNode.textContent ?? '';
  const sourceRef = { nodePath };

  if (!preserveWhitespace) {
    if (isWhitespaceOnly(raw)) {
      if (raw.length > 0) {
        return { type: NODE_TYPES.Text, content: ' ', sourceRef };
      }
      return undefined;
    }
    return { type: NODE_TYPES.Text, content: collapseWhitespace(raw), sourceRef };
  }

  if (raw.length === 0) return undefined;
  return { type: NODE_TYPES.Text, content: raw, sourceRef };
}

function convertElement(
  el: Element,
  warnings: string[],
  preserveWhitespace: boolean,
  nodePath: readonly number[],
): DocumentNode | undefined {
  const tagName = el.localName;
  const classification = classifyTag(tagName);
  const sourceRef = { nodePath };

  // Extract image from SVG wrapper (common EPUB cover pattern)
  if (tagName === 'svg') {
    const imageNode = extractSvgImage(el, nodePath);
    if (imageNode) return imageNode;
  }

  if (classification === 'ignored') {
    warnings.push(`Unsupported element <${tagName}> skipped`);
    return undefined;
  }

  const isPreformatted = preserveWhitespace || tagName === 'pre';
  const children = convertChildren(el, warnings, isPreformatted, nodePath);
  const attributes = extractAttributes(el);

  if (classification === 'block') {
    const block: BlockNode = attributes
      ? { type: NODE_TYPES.Block, tag: tagName, attributes, children, sourceRef }
      : { type: NODE_TYPES.Block, tag: tagName, children, sourceRef };
    return block;
  }

  // Handle <br> as a newline text node
  if (tagName === 'br') {
    return { type: NODE_TYPES.Text, content: '\n', sourceRef } satisfies TextNode;
  }

  // Handle <img> as an image node
  if (tagName === 'img') {
    const src = el.getAttribute('src') ?? '';
    const alt = el.getAttribute('alt') ?? '';
    if (src) return { type: 'image', src, alt, sourceRef };
    return undefined;
  }

  const inline: InlineNode = attributes
    ? { type: NODE_TYPES.Inline, tag: tagName, attributes, children, sourceRef }
    : { type: NODE_TYPES.Inline, tag: tagName, children, sourceRef };
  return inline;
}

/** Extract an image from an SVG element (common EPUB cover/illustration pattern). */
function extractSvgImage(svg: Element, nodePath: readonly number[]): DocumentNode | undefined {
  const imageEls = svg.getElementsByTagName('image');
  for (let i = 0; i < imageEls.length; i++) {
    const img = imageEls[i];
    if (!img) continue;
    const src =
      img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
      img.getAttribute('xlink:href') ??
      img.getAttribute('href') ??
      '';
    if (src && !src.startsWith('blob:')) {
      return { type: 'image', src, alt: '', sourceRef: { nodePath } };
    }
  }
  return undefined;
}

function extractAttributes(el: Element): ElementAttributes | undefined {
  const cls = el.getAttribute('class') ?? undefined;
  const style = el.getAttribute('style') ?? undefined;
  const id = el.getAttribute('id') ?? undefined;
  const href = el.localName === 'a' ? (el.getAttribute('href') ?? undefined) : undefined;
  const { colspan, rowspan } = extractTableCellSpans(el);

  // Collect all attributes for CSS attribute selector matching
  const allAttributes = collectAllAttributes(el);

  if (
    cls === undefined &&
    style === undefined &&
    id === undefined &&
    href === undefined &&
    colspan === undefined &&
    rowspan === undefined &&
    allAttributes === undefined
  ) {
    return undefined;
  }
  return {
    ...(cls !== undefined ? { class: cls } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(href !== undefined ? { href } : {}),
    ...(colspan !== undefined ? { colspan } : {}),
    ...(rowspan !== undefined ? { rowspan } : {}),
    ...(allAttributes !== undefined ? { allAttributes } : {}),
  } satisfies ElementAttributes;
}

function collectAllAttributes(el: Element): ReadonlyMap<string, string> | undefined {
  if (el.attributes.length === 0) return undefined;
  // Only create the map if there are attributes beyond the common ones
  // that might be targeted by CSS attribute selectors
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
