import { describe, expect, it } from 'vitest';
import type {
  RitoReaderColor,
  RitoReaderPrimitive,
  RitoReaderPrimitiveList,
} from '@ritojs/core-wasm';

import { paintsWhollyOnGpu } from '../../src/bindings/browser/gl-pen/split';
import { clusterTable } from '../helpers/cluster-table';

function srgb(r: number, g: number, b: number, alpha = 1): RitoReaderColor {
  return {
    space: 'srgb',
    component0: r,
    component1: g,
    component2: b,
    alpha,
    none: { component0: false, component1: false, component2: false, alpha: false },
  };
}

const INK = srgb(0, 0, 0);
const PAPER = srgb(1, 1, 1);

function list(commands: readonly RitoReaderPrimitive[]): RitoReaderPrimitiveList {
  return { formatVersion: 3, ratio: 1, commandCount: commands.length, commands };
}

function run(text = 'Ab', overrides: Partial<{ color: RitoReaderColor; shadow: boolean }> = {}) {
  return {
    kind: 'text',
    text,
    rect: { x: 10, y: 10, width: 20, height: 16 },
    paint: {
      font: { family: 'serif', sizePx: 16, weight: 400, style: 'normal' },
      color: overrides.color ?? INK,
      textShadows: overrides.shadow ? [{ offsetX: 1, offsetY: 1, blur: 2, color: INK }] : [],
    },
    clusters: clusterTable([
      [0, 10, 22.8],
      [1, 20, 22.8, true],
    ]),
  } as const satisfies RitoReaderPrimitive;
}

const ground = {
  kind: 'fill-rect',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  color: PAPER,
  ground: 'page',
} as const satisfies RitoReaderPrimitive;

const noColorGlyphs = (): boolean => false;

describe('which lists the GPU pen paints itself', () => {
  it('takes a page of whole-pixel fills and plain runs', () => {
    expect(paintsWhollyOnGpu(list([ground, run(), run('cd')]), noColorGlyphs)).toBe(true);
  });

  it('leaves a list with anything else to the canvas pen, wholly', () => {
    const path = {
      kind: 'fill-path',
      path: [{ op: 'ellipse', cx: 5, cy: 5, rx: 3, ry: 3 }],
      rule: 'nonzero',
      color: INK,
      ground: 'none',
    } as const satisfies RitoReaderPrimitive;
    expect(paintsWhollyOnGpu(list([ground, run(), path]), noColorGlyphs)).toBe(false);
    expect(paintsWhollyOnGpu(list([path, ground, run()]), noColorGlyphs)).toBe(false);
  });

  it('takes fills only on whole device pixels, after the translation in force', () => {
    const fill = (x: number) =>
      ({
        kind: 'fill-rect',
        rect: { x, y: 2, width: 3, height: 4 },
        color: INK,
        ground: 'none',
      }) as const;
    expect(paintsWhollyOnGpu(list([fill(1)]), noColorGlyphs)).toBe(true);
    expect(paintsWhollyOnGpu(list([fill(1.5)]), noColorGlyphs)).toBe(false);
    const moved = (dx: number) =>
      list([{ kind: 'push-state' }, { kind: 'translate', dx, dy: 0 }, fill(1)]);
    expect(paintsWhollyOnGpu(moved(600), noColorGlyphs)).toBe(true);
    expect(paintsWhollyOnGpu(moved(0.5), noColorGlyphs)).toBe(false);
  });

  it('takes fills and runs only in an opaque sRGB colour', () => {
    const translucent = srgb(0, 0, 0, 0.5);
    expect(paintsWhollyOnGpu(list([run('Ab', { color: translucent })]), noColorGlyphs)).toBe(false);
    const p3: RitoReaderColor = { ...INK, space: 'display-p3' };
    expect(paintsWhollyOnGpu(list([run('Ab', { color: p3 })]), noColorGlyphs)).toBe(false);
  });

  it('leaves opacity, transforms and clips other than whole-pixel rects to the canvas pen', () => {
    const under = (state: RitoReaderPrimitive) =>
      paintsWhollyOnGpu(
        list([{ kind: 'push-state' }, state, run(), { kind: 'pop-state' }]),
        noColorGlyphs,
      );
    expect(under({ kind: 'opacity', value: 1 })).toBe(true);
    expect(under({ kind: 'opacity', value: 0.5 })).toBe(false);
    expect(under({ kind: 'transform', origin: { x: 0, y: 0 }, transforms: [] })).toBe(false);
    expect(
      under({ kind: 'clip-path', path: [{ op: 'rect', x: 0, y: 0, width: 40, height: 30 }] }),
    ).toBe(true);
    expect(
      under({ kind: 'clip-path', path: [{ op: 'rect', x: 0, y: 0, width: 40.5, height: 30 }] }),
    ).toBe(false);
    expect(
      under({ kind: 'clip-path', path: [{ op: 'ellipse', cx: 5, cy: 5, rx: 3, ry: 3 }] }),
    ).toBe(false);
    // The state ends with its pop: what follows is plain again.
    expect(
      paintsWhollyOnGpu(
        list([
          { kind: 'push-state' },
          { kind: 'opacity', value: 0.5 },
          { kind: 'pop-state' },
          run(),
        ]),
        noColorGlyphs,
      ),
    ).toBe(true);
  });

  it('leaves shadowed runs, combining marks and colour glyphs to the canvas pen', () => {
    expect(paintsWhollyOnGpu(list([run('Ab', { shadow: true })]), noColorGlyphs)).toBe(false);
    expect(paintsWhollyOnGpu(list([run('é')]), noColorGlyphs)).toBe(false);
    const seen: string[] = [];
    const starsInColor = (_: unknown, character: string) => {
      seen.push(character);
      return character === '★';
    };
    expect(paintsWhollyOnGpu(list([run('a★')]), starsInColor)).toBe(false);
    expect(paintsWhollyOnGpu(list([run('a♪')]), starsInColor)).toBe(true);
    expect(seen).toEqual(['★', '♪']);
  });

  it('under a translucent theme, leaves the runs and the page ground to the canvas pen', () => {
    const block = { ...ground, ground: 'block' } as const;
    expect(paintsWhollyOnGpu(list([block]), noColorGlyphs, false)).toBe(true);
    expect(paintsWhollyOnGpu(list([ground]), noColorGlyphs, false)).toBe(false);
    expect(paintsWhollyOnGpu(list([run()]), noColorGlyphs, false)).toBe(false);
  });
});
