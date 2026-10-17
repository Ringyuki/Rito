// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { bindClipboard } from '../src/interaction/dom/clipboard';
import type { SelectionEngine } from '../src/interaction/selection';

const engine = { getText: () => '' } as unknown as SelectionEngine;

describe('reader canvas focus', () => {
  it('takes keys without the browser focus ring', () => {
    const canvas = document.createElement('canvas');

    const dispose = bindClipboard(canvas, engine);

    expect(canvas.getAttribute('tabindex')).toBe('0');
    expect(canvas.style.outlineStyle).toBe('none');
    dispose();
  });

  it('gives back a canvas the host never made focusable as it was', () => {
    const canvas = document.createElement('canvas');

    bindClipboard(canvas, engine)();

    expect(canvas.hasAttribute('tabindex')).toBe(false);
    expect(canvas.style.outlineStyle).toBe('');
  });

  it("gives back the host's own tabindex and outline", () => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('tabindex', '-1');
    canvas.style.outline = '2px dashed red';

    bindClipboard(canvas, engine)();

    expect(canvas.getAttribute('tabindex')).toBe('-1');
    expect(canvas.style.outlineStyle).toBe('dashed');
    expect(canvas.style.outlineWidth).toBe('2px');
  });
});
