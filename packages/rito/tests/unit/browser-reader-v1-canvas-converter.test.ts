import { describe, expect, it } from 'vitest';
import type { RitoReaderColorV1 } from '@ritojs/core-wasm';

import {
  convertReaderRubyV1,
  convertReaderTextV1,
  toCanvasColorV1,
} from '../../src/bindings/browser/reader-v1-canvas-converter';

const INK: RitoReaderColorV1 = {
  space: 'srgb',
  component0: 0,
  component1: 0,
  component2: 0,
  alpha: 1,
  none: { component0: false, component1: false, component2: false, alpha: false },
};

describe('reader v1 canvas converter', () => {
  it('carries the inline-box tail through to the pen', () => {
    const text = convertReaderTextV1({
      text: 'run',
      alignRight: false,
      vertical: false,
      rect: { x: 0, y: 0, width: 10, height: 20 },
      paint: {
        font: { family: 'serif', sizePx: 16, weight: 400, style: 'normal' },
        color: INK,
        textShadows: [],
        boxOffsets: { top: -2, bottom: 22 },
        boxStart: false,
        boxEnd: true,
      },
    });
    expect(text).toMatchObject({
      kind: 'paintText',
      paint: { box: { topPx: -2, bottomPx: 22 }, boxStart: false },
    });
    expect('boxEnd' in text.paint).toBe(false);
  });

  it('keeps a non-initial ruby alignment and drops the initial one', () => {
    const paint = {
      font: { family: 'serif', sizePx: 8, weight: 400, style: 'normal' as const },
      color: INK,
      textShadows: [],
      boxStart: true,
      boxEnd: true,
    };
    const rect = { x: 0, y: 0, width: 10, height: 8 };
    expect(
      convertReaderRubyV1({ text: 'rb', rect, paint, rubyAlign: 'center', vertical: false }),
    ).toMatchObject({
      kind: 'paintRuby',
      rubyAlign: 'center',
    });
    expect('rubyAlign' in convertReaderRubyV1({ text: 'rb', rect, paint, vertical: false })).toBe(
      false,
    );
  });

  it('fails closed on a border style the canvas cannot stroke', () => {
    expect(() =>
      convertReaderTextV1({
        text: 'run',
        alignRight: false,
        vertical: false,
        rect: { x: 0, y: 0, width: 10, height: 20 },
        paint: {
          font: { family: 'serif', sizePx: 16, weight: 400, style: 'normal' },
          color: INK,
          textShadows: [],
          border: { top: { widthPx: 1, paint: { color: INK, style: 'groove' } } },
          boxStart: true,
          boxEnd: true,
        },
      }),
    ).toThrow(/border-style:groove/);
  });

  it('spells every predefined color space the canvas parses', () => {
    expect(toCanvasColorV1(INK)).toBe('rgba(0, 0, 0, 1)');
    expect(
      toCanvasColorV1({ ...INK, space: 'display-p3', component0: 1, component1: 0.5, alpha: 0.5 }),
    ).toBe('color(display-p3 1 0.5 0 / 0.5)');
    expect(
      toCanvasColorV1({
        ...INK,
        none: { component0: false, component1: true, component2: false, alpha: false },
      }),
    ).toBe('color(srgb 0 none 0 / 1)');
    expect(() => toCanvasColorV1({ ...INK, space: 'display-p3-linear' })).toThrow(
      /color-space:display-p3-linear/,
    );
    expect(() => toCanvasColorV1({ ...INK, space: 'oklch' })).toThrow(/color-space:oklch/);
  });
});
