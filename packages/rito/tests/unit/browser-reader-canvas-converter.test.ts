import { describe, expect, it } from 'vitest';
import type { RitoReaderColor } from '@ritojs/core-wasm';

import {
  convertReaderRuby,
  toCanvasColor,
} from '../../src/bindings/browser/reader-session-canvas-converter';

const INK: RitoReaderColor = {
  space: 'srgb',
  component0: 0,
  component1: 0,
  component2: 0,
  alpha: 1,
  none: { component0: false, component1: false, component2: false, alpha: false },
};

describe('reader session canvas converter', () => {
  it("passes an annotation's cluster origins through and omits an empty list", () => {
    const paint = {
      font: { family: 'serif', sizePx: 8, weight: 400, style: 'normal' as const },
      color: INK,
      textShadows: [],
    };
    const rect = { x: 0, y: 0, width: 10, height: 8 };
    const clusters = [
      { byte: 0, x: 1.5, y: 6 },
      { byte: 1, x: 5.25, y: 6 },
    ];
    expect(convertReaderRuby({ text: 'rb', rect, paint, clusters })).toMatchObject({
      kind: 'paintRuby',
      clusters,
    });
    expect('clusters' in convertReaderRuby({ text: 'rb', rect, paint, clusters: [] })).toBe(false);
  });

  it('spells every predefined color space the canvas parses', () => {
    expect(toCanvasColor(INK)).toBe('rgba(0, 0, 0, 1)');
    expect(
      toCanvasColor({ ...INK, space: 'display-p3', component0: 1, component1: 0.5, alpha: 0.5 }),
    ).toBe('color(display-p3 1 0.5 0 / 0.5)');
    expect(
      toCanvasColor({
        ...INK,
        none: { component0: false, component1: true, component2: false, alpha: false },
      }),
    ).toBe('color(srgb 0 none 0 / 1)');
    expect(() => toCanvasColor({ ...INK, space: 'display-p3-linear' })).toThrow(
      /color-space:display-p3-linear/,
    );
    expect(() => toCanvasColor({ ...INK, space: 'oklch' })).toThrow(/color-space:oklch/);
  });
});
