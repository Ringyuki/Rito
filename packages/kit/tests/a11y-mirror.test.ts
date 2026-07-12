// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createA11yMirror } from '../src/interaction/dom/a11y-mirror';
import type { SemanticNode } from '../src/interaction/core';

const bounds = { x: 0, y: 0, width: 10, height: 10 };

afterEach(() => {
  document.body.replaceChildren();
});

describe('createA11yMirror', () => {
  it('recursively preserves text, links, and images', () => {
    const tree: readonly SemanticNode[] = [
      {
        role: 'paragraph',
        text: 'Before link',
        bounds,
        children: [
          { role: 'generic', text: 'Before ', bounds, children: [] },
          { role: 'link', text: 'link', href: '#target', bounds, children: [] },
          {
            role: 'generic',
            bounds,
            children: [{ role: 'image', alt: 'Cover', bounds, children: [] }],
          },
        ],
      },
    ];
    const mirror = createA11yMirror(document.body);
    mirror.update(tree);

    expect(mirror.container.querySelector('p')?.textContent).toBe('Before link');
    expect(mirror.container.querySelector('a')?.getAttribute('href')).toBe('#target');
    expect(mirror.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Cover',
    );

    mirror.dispose();
    expect(document.body.contains(mirror.container)).toBe(false);
  });

  it('keeps safe links but does not create anchors for dangerous schemes', () => {
    const mirror = createA11yMirror(document.body);
    mirror.update([
      { role: 'link', text: 'safe', href: 'https://example.com', bounds, children: [] },
      { role: 'link', text: 'unsafe', href: 'java\nscript:alert(1)', bounds, children: [] },
    ]);

    expect(mirror.container.querySelectorAll('a')).toHaveLength(1);
    expect(mirror.container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(mirror.container.textContent).toBe('safeunsafe');
  });
});
