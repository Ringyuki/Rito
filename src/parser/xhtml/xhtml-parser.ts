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
  const nodes = convertChildren(body, warnings, false);

  return { nodes, warnings };
}

function convertChildren(
  parent: Element,
  warnings: string[],
  preserveWhitespace: boolean,
): DocumentNode[] {
  const result: DocumentNode[] = [];

  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (!child) continue;

    const node = convertNode(child, warnings, preserveWhitespace);
    if (node) {
      result.push(node);
    }
  }

  return result;
}

function convertNode(
  domNode: Node,
  warnings: string[],
  preserveWhitespace: boolean,
): DocumentNode | undefined {
  if (domNode.nodeType === Node.TEXT_NODE) {
    return convertTextNode(domNode, preserveWhitespace);
  }

  if (domNode.nodeType === Node.ELEMENT_NODE) {
    return convertElement(domNode as Element, warnings, preserveWhitespace);
  }

  // Ignore comments, processing instructions, etc.
  return undefined;
}

function convertTextNode(domNode: Node, preserveWhitespace: boolean): TextNode | undefined {
  const raw = domNode.textContent ?? '';

  if (!preserveWhitespace) {
    if (isWhitespaceOnly(raw)) {
      // Keep whitespace-only text nodes as a single space to preserve
      // inter-element spacing (e.g., between inline elements)
      if (raw.length > 0) {
        return { type: NODE_TYPES.Text, content: ' ' };
      }
      return undefined;
    }
    return { type: NODE_TYPES.Text, content: collapseWhitespace(raw) };
  }

  // In pre-formatted contexts, preserve the text as-is
  if (raw.length === 0) return undefined;
  return { type: NODE_TYPES.Text, content: raw };
}

function convertElement(
  el: Element,
  warnings: string[],
  preserveWhitespace: boolean,
): DocumentNode | undefined {
  const tagName = el.localName;
  const classification = classifyTag(tagName);

  // Extract image from SVG wrapper (common EPUB cover pattern)
  if (tagName === 'svg') {
    const imageNode = extractSvgImage(el);
    if (imageNode) return imageNode;
  }

  if (classification === 'ignored') {
    warnings.push(`Unsupported element <${tagName}> skipped`);
    return undefined;
  }

  const isPreformatted = preserveWhitespace || tagName === 'pre';
  const children = convertChildren(el, warnings, isPreformatted);
  const attributes = extractAttributes(el);

  if (classification === 'block') {
    if (attributes) {
      return { type: NODE_TYPES.Block, tag: tagName, attributes, children } satisfies BlockNode;
    }
    return { type: NODE_TYPES.Block, tag: tagName, children } satisfies BlockNode;
  }

  // Handle <br> as a newline text node
  if (tagName === 'br') {
    return { type: NODE_TYPES.Text, content: '\n' } satisfies TextNode;
  }

  // Handle <img> as an image node
  if (tagName === 'img') {
    const src = el.getAttribute('src') ?? '';
    const alt = el.getAttribute('alt') ?? '';
    if (src) return { type: 'image', src, alt };
    return undefined;
  }

  if (attributes) {
    return { type: NODE_TYPES.Inline, tag: tagName, attributes, children } satisfies InlineNode;
  }
  return { type: NODE_TYPES.Inline, tag: tagName, children } satisfies InlineNode;
}

/** Extract an image from an SVG element (common EPUB cover/illustration pattern). */
function extractSvgImage(svg: Element): DocumentNode | undefined {
  // Look for <image> with xlink:href or href
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
      return { type: 'image', src, alt: '' };
    }
  }
  return undefined;
}

function extractAttributes(el: Element): ElementAttributes | undefined {
  const cls = el.getAttribute('class') ?? undefined;
  const style = el.getAttribute('style') ?? undefined;
  const id = el.getAttribute('id') ?? undefined;
  const href = el.localName === 'a' ? (el.getAttribute('href') ?? undefined) : undefined;
  if (cls === undefined && style === undefined && id === undefined && href === undefined) {
    return undefined;
  }
  const attrs = {
    ...(cls !== undefined ? { class: cls } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(href !== undefined ? { href } : {}),
  } satisfies ElementAttributes;
  return attrs;
}
