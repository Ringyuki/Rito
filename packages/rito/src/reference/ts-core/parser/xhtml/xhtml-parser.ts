import type {
  BlockNode,
  DocumentNode,
  ElementAttributes,
  ImageNode,
  InlineNode,
  TextNode,
} from './types';
import { NODE_TYPES } from './types';
import { XhtmlParseError } from './errors';
import { classifyTag } from './tag-classifier';
import { collapseWhitespace, isWhitespaceOnly } from './text-normalizer';
import {
  isXhtmlSourceWithinNormalizationBudget,
  normalizeXhtmlSource,
} from './xhtml-source-normalizer';
import {
  findDescendants,
  findFirstElement,
  getAttribute,
  getAttributeNS,
  parseXml,
  XML_SOURCE_CODE_UNIT_LIMIT,
} from '../xml';
import type { XmlElement, XmlNode, XmlText } from '../xml';
import { extractElementAttributes } from './element-attributes';
import { extractEmbeddedStylesheets, extractStylesheetHrefs } from './stylesheet-metadata';

/** Warnings collected during parsing for unsupported elements. */
export interface ParseResult {
  readonly nodes: readonly DocumentNode[];
  readonly warnings: readonly string[];
  /** Attributes of the <body> element (class, style, id) for per-chapter styling. */
  readonly bodyAttributes?: ElementAttributes;
  /** Relative hrefs of `<link rel="stylesheet">` tags from the chapter `<head>`. */
  readonly stylesheetHrefs?: readonly string[];
  /** Author CSS declared by chapter-local `<style>` elements. */
  readonly embeddedStylesheets?: readonly string[];
}

/**
 * Parse an XHTML chapter string into a DocumentNode tree.
 * Returns the nodes from the <body> element, or all root-level nodes if no body is found.
 */
export function parseXhtml(xhtml: string): ParseResult {
  assertNormalizationBudget(xhtml);
  const doc = parseXml(normalizeXhtmlSource(xhtml), (details) => {
    return new XhtmlParseError(`Invalid XHTML: ${details}`);
  });

  const body = findFirstElement(doc.root, 'body') ?? doc.root;
  const warnings: string[] = [];
  const nodes = convertChildren(body, warnings, false, []);
  const bodyAttributes = extractElementAttributes(body);
  const stylesheetHrefs = extractStylesheetHrefs(doc);
  const embeddedStylesheets = extractEmbeddedStylesheets(doc);

  const result: ParseResult = { nodes, warnings };
  if (bodyAttributes)
    (result as { bodyAttributes: ElementAttributes }).bodyAttributes = bodyAttributes;
  if (stylesheetHrefs.length > 0)
    (result as { stylesheetHrefs: readonly string[] }).stylesheetHrefs = stylesheetHrefs;
  if (embeddedStylesheets.length > 0)
    (result as { embeddedStylesheets: readonly string[] }).embeddedStylesheets =
      embeddedStylesheets;
  return result;
}

function assertNormalizationBudget(source: string): void {
  if (!isXhtmlSourceWithinNormalizationBudget(source, XML_SOURCE_CODE_UNIT_LIMIT)) {
    throw new XhtmlParseError(
      `Invalid XHTML: maximum XML source length of ${String(XML_SOURCE_CODE_UNIT_LIMIT)} exceeded`,
    );
  }
}

function convertChildren(
  parent: XmlElement,
  warnings: string[],
  preserveWhitespace: boolean,
  parentPath: readonly number[],
): DocumentNode[] {
  const result: DocumentNode[] = [];
  let emittedIndex = 0;

  for (const child of parent.children) {
    const childPath = [...parentPath, emittedIndex];
    const node = convertNode(child, warnings, preserveWhitespace, childPath);
    if (node) {
      // When an inline element (e.g. <a>) contains block children (e.g. <div>),
      // unwrap it: hoist block children to this level so they participate in the
      // parent's float context. Propagate href and inline style to block children.
      // Known limitation: stylesheet-level anchor ancestor selectors (a { ... },
      // a > div, a .title) are not preserved — only href and inline style transfer.
      if (node.type === 'inline' && node.children.some((c) => c.type === 'block')) {
        const href = node.attributes?.href;
        const anchorStyle = node.attributes?.style;
        for (const c of node.children) {
          if (c.type === 'block') {
            const merged = mergeAnchorAttrs(c.attributes, href, anchorStyle);
            result.push(merged ? { ...c, attributes: merged } : c);
          } else {
            result.push(c);
          }
          emittedIndex++;
        }
      } else {
        result.push(node);
        emittedIndex++;
      }
    }
  }

  return result;
}

function convertNode(
  xmlNode: XmlNode,
  warnings: string[],
  preserveWhitespace: boolean,
  nodePath: readonly number[],
): DocumentNode | undefined {
  if (xmlNode.type === 'text') {
    return convertTextNode(xmlNode, preserveWhitespace, nodePath);
  }

  if (xmlNode.type === 'element') {
    return convertElement(xmlNode, warnings, preserveWhitespace, nodePath);
  }

  // Ignore comments, processing instructions, etc.
  return undefined;
}

function convertTextNode(
  xmlNode: XmlText,
  preserveWhitespace: boolean,
  nodePath: readonly number[],
): TextNode | undefined {
  const raw = xmlNode.value;
  const sourceRef = { nodePath };

  if (!preserveWhitespace) {
    if (isWhitespaceOnly(raw)) {
      if (raw.length > 0) {
        return {
          type: NODE_TYPES.Text,
          content: ' ',
          ...(raw === ' ' ? {} : { sourceText: raw }),
          sourceRef,
        };
      }
      return undefined;
    }
    const content = collapseWhitespace(raw);
    return {
      type: NODE_TYPES.Text,
      content,
      ...(content === raw ? {} : { sourceText: raw }),
      sourceRef,
    };
  }

  if (raw.length === 0) return undefined;
  return { type: NODE_TYPES.Text, content: raw, sourceRef };
}

function convertElement(
  el: XmlElement,
  warnings: string[],
  preserveWhitespace: boolean,
  nodePath: readonly number[],
): DocumentNode | undefined {
  const tagName = el.localName.toLowerCase();
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
  const attributes = extractElementAttributes(el);

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
    const src = getAttribute(el, 'src') ?? '';
    const alt = getAttribute(el, 'alt') ?? '';
    if (!src) return undefined;
    const imgNode: ImageNode = { type: 'image', src, alt, sourceRef };
    return attributes ? { ...imgNode, attributes } : imgNode;
  }

  const inline: InlineNode = attributes
    ? { type: NODE_TYPES.Inline, tag: tagName, attributes, children, sourceRef }
    : { type: NODE_TYPES.Inline, tag: tagName, children, sourceRef };
  return inline;
}

/** Extract an image from an SVG element (common EPUB cover/illustration pattern). */
function extractSvgImage(svg: XmlElement, nodePath: readonly number[]): DocumentNode | undefined {
  for (const img of findDescendants(svg, 'image')) {
    const src =
      getAttributeNS(img, 'http://www.w3.org/1999/xlink', 'href') ||
      getAttribute(img, 'xlink:href') ||
      getAttribute(img, 'href') ||
      '';
    if (src && !src.startsWith('blob:')) {
      return { type: 'image', src, alt: '', sourceRef: { nodePath } };
    }
  }
  return undefined;
}

/** Merge anchor href and inline style onto a block child's attributes. */
function mergeAnchorAttrs(
  childAttrs: ElementAttributes | undefined,
  href: string | undefined,
  anchorStyle: string | undefined,
): ElementAttributes | undefined {
  if (!href && !anchorStyle) return childAttrs;
  const result = { ...childAttrs };
  if (href && !result.href) result.href = href;
  if (anchorStyle) {
    // Prepend anchor style (lower priority) before child's own style
    result.style = result.style ? `${anchorStyle}; ${result.style}` : anchorStyle;
  }
  return result;
}
