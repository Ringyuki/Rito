import type { BlockNode, DocumentNode, InlineNode, TextNode } from './types';
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

  if (classification === 'ignored') {
    warnings.push(`Unsupported element <${tagName}> skipped`);
    return undefined;
  }

  const isPreformatted = preserveWhitespace || tagName === 'pre';
  const children = convertChildren(el, warnings, isPreformatted);

  if (classification === 'block') {
    return { type: NODE_TYPES.Block, tag: tagName, children } satisfies BlockNode;
  }

  // Handle <br> as a newline text node
  if (tagName === 'br') {
    return { type: NODE_TYPES.Text, content: '\n' } satisfies TextNode;
  }

  return { type: NODE_TYPES.Inline, tag: tagName, children } satisfies InlineNode;
}
