import { XML_NODE_TYPES } from './types';
import type { XmlAttribute, XmlElement, XmlNode } from './types';

/** Return direct element children in document order. */
export function childElements(parent: XmlElement): XmlElement[] {
  return parent.children.filter((child): child is XmlElement => child.type === 'element');
}

/** Find elements by exact qualified name, including the supplied root. */
export function findElements(root: XmlElement, qualifiedName: string): XmlElement[] {
  const matches: XmlElement[] = [];
  walkElements(root, (element) => {
    if (element.qualifiedName === qualifiedName) matches.push(element);
  });
  return matches;
}

/** Find descendants by exact qualified name, excluding the supplied parent. */
export function findDescendants(parent: XmlElement, qualifiedName: string): XmlElement[] {
  const matches: XmlElement[] = [];
  for (const child of childElements(parent)) {
    walkElements(child, (element) => {
      if (element.qualifiedName === qualifiedName) matches.push(element);
    });
  }
  return matches;
}

export function findFirstElement(root: XmlElement, qualifiedName: string): XmlElement | undefined {
  if (root.qualifiedName === qualifiedName) return root;
  return findFirstDescendant(root, qualifiedName);
}

export function findFirstDescendant(
  parent: XmlElement,
  qualifiedName: string,
): XmlElement | undefined {
  for (const child of childElements(parent)) {
    if (child.qualifiedName === qualifiedName) return child;
    const nested = findFirstDescendant(child, qualifiedName);
    if (nested) return nested;
  }
  return undefined;
}

export function getAttribute(element: XmlElement, qualifiedName: string): string | undefined {
  return findAttribute(element, (attribute) => attribute.qualifiedName === qualifiedName)?.value;
}

export function hasAttribute(element: XmlElement, qualifiedName: string): boolean {
  return (
    findAttribute(element, (attribute) => attribute.qualifiedName === qualifiedName) !== undefined
  );
}

export function getAttributeNS(
  element: XmlElement,
  namespaceUri: string,
  localName: string,
): string | undefined {
  return findAttribute(
    element,
    (attribute) => attribute.namespaceUri === namespaceUri && attribute.localName === localName,
  )?.value;
}

/** DOM-compatible descendant text concatenation, including CDATA. */
export function textContent(node: XmlNode): string {
  if (node.type !== XML_NODE_TYPES.ELEMENT) return node.value;
  let text = '';
  for (const child of node.children) text += textContent(child);
  return text;
}

function walkElements(root: XmlElement, visit: (element: XmlElement) => void): void {
  visit(root);
  for (const child of childElements(root)) walkElements(child, visit);
}

function findAttribute(
  element: XmlElement,
  predicate: (attribute: XmlAttribute) => boolean,
): XmlAttribute | undefined {
  return element.attributes.find(predicate);
}
