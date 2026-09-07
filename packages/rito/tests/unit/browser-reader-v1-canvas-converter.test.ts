import { describe, expect, it } from 'vitest';
import type { RitoReaderColorV1, RitoReaderDisplayCommandV1 } from '@ritojs/core-wasm';

import {
  convertReaderDisplayCommandsV1,
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
    const [text] = convertReaderDisplayCommandsV1([
      {
        kind: 'paint-text',
        opcode: 9,
        text: 'run',
        rect: { x: 0, y: 0, width: 10, height: 20 },
        paint: {
          font: { family: 'serif', sizePx: 16, weight: 400, style: 'normal' },
          color: INK,
          textShadows: [],
          boxOffsets: { top: -2, bottom: 22 },
          boxStart: false,
          boxEnd: true,
        },
      },
    ]);
    expect(text).toMatchObject({
      kind: 'paintText',
      paint: { box: { topPx: -2, bottomPx: 22 }, boxStart: false },
    });
    expect(text && 'paint' in text && 'boxEnd' in text.paint).toBe(false);
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

  it('resolves an explicit background size axis by axis', () => {
    const command: RitoReaderDisplayCommandV1 = {
      kind: 'paint-block',
      opcode: 8,
      rect: { x: 0, y: 0, width: 10, height: 20 },
      paint: {
        background: {
          image: 'paper.png',
          size: { x: { unit: 'px', value: 10 } },
        },
        boxShadows: [],
      },
    };
    const [block] = convertReaderDisplayCommandsV1([command]);
    expect(block).toMatchObject({
      kind: 'paintBlock',
      paint: { background: { size: { x: { unit: 'px', value: 10 }, y: 'auto' } } },
    });
  });
});
