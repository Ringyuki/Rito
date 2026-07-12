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

export interface A11yMirrorOptions {
  /** Intercepts keyboard or pointer activation after the href passes sanitization. */
  readonly onLinkActivate?: (node: SemanticNode) => boolean | undefined;
}

/**
 * Create an A11y mirror as a child of the given parent element.
 * The mirror is visually hidden but accessible to screen readers.
 */
export function createA11yMirror(parent: HTMLElement, options: A11yMirrorOptions = {}): A11yMirror {
  const container = document.createElement('div');
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('role', 'document');
  applyVisuallyHidden(container);
  parent.appendChild(container);

  return {
    container,
    update(tree) {
      container.replaceChildren(...tree.map((node) => renderNode(node, options)));
    },
    dispose() {
      container.remove();
    },
  };
}

function renderNode(node: SemanticNode, options: A11yMirrorOptions): HTMLElement {
  const element = createNodeElement(node, options);
  appendSemanticContent(element, node, options);
  return element;
}

function createNodeElement(node: SemanticNode, options: A11yMirrorOptions): HTMLElement {
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
      return createLinkElement(node, options.onLinkActivate);
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

function appendSemanticContent(
  element: HTMLElement,
  node: SemanticNode,
  options: A11yMirrorOptions,
): void {
  if (node.role === 'image') return;
  if (node.children.length > 0) {
    element.append(...node.children.map((child) => renderNode(child, options)));
  } else if (node.text) {
    element.textContent = node.text;
  }
}

function clampHeadingLevel(level: number | undefined): number {
  return Math.max(1, Math.min(6, level ?? 1));
}

function createImage(alt: string | undefined): HTMLElement {
  const element = document.createElement('span');
  if (alt === '') {
    element.setAttribute('role', 'presentation');
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
  element.setAttribute('role', 'img');
  if (alt !== undefined) element.setAttribute('aria-label', alt);
  return element;
}

function createLinkElement(
  node: SemanticNode,
  onActivate: A11yMirrorOptions['onLinkActivate'],
): HTMLElement {
  const safeHref = sanitizeA11yHref(node.href);
  if (!safeHref) return document.createElement('span');
  const anchor = document.createElement('a');
  anchor.setAttribute('href', safeHref);
  if (onActivate) {
    anchor.addEventListener('click', (event) => {
      if (onActivate(node) !== false) event.preventDefault();
    });
  }
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
