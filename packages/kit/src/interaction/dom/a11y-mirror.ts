/**
 * Hidden DOM mirror for screen readers.
 * Creates an aria-live region that reflects the semantic tree of the current spread.
 */

import type { SemanticNode } from '../core';

/** A mounted accessibility mirror that can be updated on spread change. */
export interface A11yMirror {
  readonly container: HTMLElement;
  update(tree: readonly SemanticNode[]): void;
  dispose(): void;
}

/**
 * Create an A11y mirror as a child of the given parent element.
 * The mirror is visually hidden but accessible to screen readers.
 */
export function createA11yMirror(parent: HTMLElement): A11yMirror {
  const container = document.createElement('div');
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('role', 'document');
  applyVisuallyHidden(container);
  parent.appendChild(container);

  return {
    container,
    update(tree) {
      container.replaceChildren(...tree.map(renderNode));
    },
    dispose() {
      container.remove();
    },
  };
}

function renderNode(node: SemanticNode): HTMLElement {
  const element = createNodeElement(node);
  appendSemanticContent(element, node);
  return element;
}

function createNodeElement(node: SemanticNode): HTMLElement {
  switch (node.role) {
    case 'heading':
      return document.createElement(`h${String(clampHeadingLevel(node.level))}`);
    case 'paragraph':
      return document.createElement('p');
    case 'listitem':
      return document.createElement('li');
    case 'list':
      return document.createElement('ul');
    case 'image':
      return createImage(node.alt);
    case 'link':
      return createLinkElement(node.href);
    case 'blockquote':
      return document.createElement('blockquote');
    case 'table': {
      const table = document.createElement('div');
      table.setAttribute('role', 'table');
      return table;
    }
    case 'generic':
      return document.createElement(node.children.length > 0 ? 'div' : 'span');
  }
}

function appendSemanticContent(element: HTMLElement, node: SemanticNode): void {
  if (node.role === 'image') return;
  if (node.children.length > 0) {
    element.append(...node.children.map(renderNode));
  } else if (node.text) {
    element.textContent = node.text;
  }
}

function clampHeadingLevel(level: number | undefined): number {
  return Math.max(1, Math.min(6, level ?? 1));
}

function createImage(alt: string | undefined): HTMLElement {
  const element = document.createElement('span');
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', alt ?? '');
  return element;
}

function createLinkElement(href: string | undefined): HTMLElement {
  const safeHref = sanitizeA11yHref(href);
  if (!safeHref) return document.createElement('span');
  const anchor = document.createElement('a');
  anchor.setAttribute('href', safeHref);
  return anchor;
}

/** Allow EPUB-relative links and a small set of navigable URL schemes. */
function sanitizeA11yHref(href: string | undefined): string | undefined {
  const trimmed = href?.trim();
  if (!trimmed) return undefined;
  const protocolProbe = Array.from(trimmed)
    .filter((character) => character.charCodeAt(0) > 0x20)
    .join('');
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(protocolProbe)?.[1]?.toLowerCase();
  if (!scheme) return trimmed;
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel'
    ? trimmed
    : undefined;
}

function applyVisuallyHidden(el: HTMLElement): void {
  Object.assign(el.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: '0',
  });
}
