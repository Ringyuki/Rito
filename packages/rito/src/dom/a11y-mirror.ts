/**
 * L2 DOM helper: hidden DOM mirror for screen readers.
 * Creates an aria-live region that reflects the semantic tree of the current spread.
 */

import type { SemanticNode } from '../interaction/semantic-tree';

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
      container.innerHTML = '';
      for (const node of tree) {
        const el = renderNode(node);
        if (el) container.appendChild(el);
      }
    },
    dispose() {
      container.remove();
    },
  };
}

function renderNode(node: SemanticNode): HTMLElement | null {
  switch (node.role) {
    case 'heading':
      return createHeading(node);
    case 'paragraph':
      return createEl('p', node.text);
    case 'listitem':
      return createEl('li', node.text);
    case 'list':
      return createList(node);
    case 'image':
      return createImage(node);
    case 'link':
      return createLink(node);
    case 'blockquote':
      return createEl('blockquote', node.text);
    case 'table':
      return createEl('div', node.text);
    case 'generic':
      return node.text ? createEl('div', node.text) : null;
  }
}

function createHeading(node: SemanticNode): HTMLElement {
  const level = Math.max(1, Math.min(6, node.level ?? 1));
  return createEl(`h${String(level)}`, node.text);
}

function createList(node: SemanticNode): HTMLElement {
  const ul = document.createElement('ul');
  for (const child of node.children) {
    const li = renderNode(child);
    if (li) ul.appendChild(li);
  }
  return ul;
}

function createImage(node: SemanticNode): HTMLElement {
  const img = document.createElement('img');
  img.setAttribute('role', 'img');
  img.alt = node.alt ?? '';
  img.src = '';
  return img;
}

function createLink(node: SemanticNode): HTMLElement {
  const a = document.createElement('a');
  if (node.href) a.href = node.href;
  a.textContent = node.text ?? '';
  return a;
}

function createEl(tag: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  return el;
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
