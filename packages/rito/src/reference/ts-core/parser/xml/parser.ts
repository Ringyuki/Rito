import { SaxesParser } from 'saxes';
import type { SaxesTagNS } from 'saxes';
import { XML_NODE_TYPES } from './types';
import type { XmlAttribute, XmlDocument, XmlElement, XmlNode } from './types';

type NamespaceSaxesParser = SaxesParser<{ xmlns: true; position: true }>;

export interface XmlParseLimits {
  readonly maxSourceCodeUnits: number;
  readonly maxDepth: number;
  readonly maxTreeNodes: number;
  readonly maxEvents: number;
  readonly maxTotalAttributes: number;
  readonly maxAttributesPerElement: number;
}

export const DEFAULT_XML_PARSE_LIMITS = {
  maxSourceCodeUnits: 32 * 1024 * 1024,
  maxDepth: 256,
  maxTreeNodes: 50_000,
  maxEvents: 100_000,
  maxTotalAttributes: 50_000,
  maxAttributesPerElement: 1_024,
} as const satisfies XmlParseLimits;

export const XML_SOURCE_CODE_UNIT_LIMIT = DEFAULT_XML_PARSE_LIMITS.maxSourceCodeUnits;
const EMPTY_ATTRIBUTES: readonly XmlAttribute[] = [];

interface MutableXmlElement extends Omit<XmlElement, 'children'> {
  readonly children: XmlNode[];
}

interface XmlBuildState {
  root: MutableXmlElement | undefined;
  readonly stack: MutableXmlElement[];
  readonly limits: XmlParseLimits;
  treeNodeCount: number;
  eventCount: number;
  attributeCount: number;
  pendingAttributeCount: number;
  canMergeText: boolean;
}

/** Parse one strict XML document into a small parser-private tree. */
export function parseXml(
  source: string,
  errorFactory: (details: string) => Error,
  limits: XmlParseLimits = DEFAULT_XML_PARSE_LIMITS,
): XmlDocument {
  if (source.length > limits.maxSourceCodeUnits) {
    throw errorFactory(
      `maximum XML source length of ${String(limits.maxSourceCodeUnits)} exceeded`,
    );
  }
  const state = createBuildState(limits);
  const parser = new SaxesParser({ xmlns: true, position: true });
  attachParserHandlers(parser, state);

  try {
    parser.write(source).close();
  } catch (error: unknown) {
    throw errorFactory(errorDetails(error));
  }
  if (!state.root) throw errorFactory('missing document element');
  return { root: state.root };
}

function createBuildState(limits: XmlParseLimits): XmlBuildState {
  return {
    root: undefined,
    stack: [],
    limits,
    treeNodeCount: 0,
    eventCount: 0,
    attributeCount: 0,
    pendingAttributeCount: 0,
    canMergeText: false,
  };
}

function attachParserHandlers(parser: NamespaceSaxesParser, state: XmlBuildState): void {
  parser.on('opentagstart', () => {
    state.pendingAttributeCount = 0;
  });
  parser.on('attribute', () => {
    recordAttribute(state);
  });
  parser.on('opentag', (tag) => {
    openElement(state, tag);
  });
  parser.on('text', (value) => {
    appendCharacterData(state, XML_NODE_TYPES.TEXT, value);
  });
  parser.on('cdata', (value) => {
    appendCharacterData(state, XML_NODE_TYPES.CDATA, value);
  });
  parser.on('comment', () => {
    recordIgnoredNode(state);
  });
  parser.on('processinginstruction', () => {
    recordIgnoredNode(state);
  });
  parser.on('doctype', () => {
    recordIgnoredNode(state);
  });
  parser.on('closetag', () => {
    closeElement(state);
  });
  parser.on('error', (error) => {
    throw error;
  });
}

function openElement(state: XmlBuildState, tag: SaxesTagNS): void {
  assertElementBudget(state);
  recordEvent(state);
  recordTreeNode(state);
  state.canMergeText = false;
  const element = createElement(tag);
  const parent = state.stack.at(-1);
  if (parent) parent.children.push(element);
  else if (state.root) throw new Error('multiple document elements');
  else state.root = element;
  state.stack.push(element);
  state.pendingAttributeCount = 0;
}

function closeElement(state: XmlBuildState): void {
  state.stack.pop();
  state.canMergeText = false;
}

function appendCharacterData(
  state: XmlBuildState,
  type: typeof XML_NODE_TYPES.TEXT | typeof XML_NODE_TYPES.CDATA,
  value: string,
): void {
  if (value.length === 0) return;
  recordEvent(state);
  const parent = state.stack.at(-1);
  if (!parent) return;
  const lastIndex = parent.children.length - 1;
  const previous = parent.children[lastIndex];
  if (type === XML_NODE_TYPES.TEXT && state.canMergeText && previous?.type === type) {
    parent.children[lastIndex] = { type, value: previous.value + value };
    return;
  }
  recordTreeNode(state);
  parent.children.push({ type, value });
  state.canMergeText = type === XML_NODE_TYPES.TEXT;
}

function recordIgnoredNode(state: XmlBuildState): void {
  recordEvent(state);
  state.canMergeText = false;
}

function recordAttribute(state: XmlBuildState): void {
  if (state.pendingAttributeCount >= state.limits.maxAttributesPerElement) {
    throw new Error(
      `maximum attributes per element of ${String(state.limits.maxAttributesPerElement)} exceeded`,
    );
  }
  if (state.attributeCount >= state.limits.maxTotalAttributes) {
    throw new Error(
      `maximum XML attribute count of ${String(state.limits.maxTotalAttributes)} exceeded`,
    );
  }
  state.pendingAttributeCount++;
  state.attributeCount++;
}

function assertElementBudget(state: XmlBuildState): void {
  if (state.stack.length >= state.limits.maxDepth) {
    throw new Error(`maximum XML depth of ${String(state.limits.maxDepth)} exceeded`);
  }
}

function recordTreeNode(state: XmlBuildState): void {
  if (state.treeNodeCount >= state.limits.maxTreeNodes) {
    throw new Error(`maximum XML tree node count of ${String(state.limits.maxTreeNodes)} exceeded`);
  }
  state.treeNodeCount++;
}

function recordEvent(state: XmlBuildState): void {
  if (state.eventCount >= state.limits.maxEvents) {
    throw new Error(`maximum XML event count of ${String(state.limits.maxEvents)} exceeded`);
  }
  state.eventCount++;
}

function createElement(tag: SaxesTagNS): MutableXmlElement {
  const attributes = Object.values(tag.attributes);
  return {
    type: XML_NODE_TYPES.ELEMENT,
    qualifiedName: tag.name,
    localName: tag.local,
    prefix: tag.prefix,
    namespaceUri: tag.uri,
    attributes: attributes.length > 0 ? attributes.map(toXmlAttribute) : EMPTY_ATTRIBUTES,
    children: [],
  };
}

function toXmlAttribute(attribute: SaxesTagNS['attributes'][string]): XmlAttribute {
  return {
    qualifiedName: attribute.name,
    localName: attribute.local,
    prefix: attribute.prefix,
    namespaceUri: attribute.uri,
    value: attribute.value,
  };
}

function errorDetails(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
