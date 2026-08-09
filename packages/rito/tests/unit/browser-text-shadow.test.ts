import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawTextShadows as drawProductionTextShadows } from '../../src/bindings/browser/canvas-text/text-shadow';
import { drawTextShadows as drawReferenceTextShadows } from '../../src/reference/ts-core/render/backends/canvas/text/text-shadow';
import {
  createMockCanvasContext,
  isCall,
  isPropertySet,
  type CanvasCall,
  type CanvasPropertySet,
  type CanvasRecord,
  type MockCanvasContext,
} from '../helpers/mock-canvas-context';
import {
  installScratchCanvasEnvironment,
  snapshotCanvasRecords,
  type CanvasRecordsSnapshot,
  type ScratchCanvasEnvironmentOptions,
  type ScratchCanvasSnapshot,
} from '../helpers/mock-scratch-canvas';

type TextFragment = Parameters<typeof drawProductionTextShadows>[1];
type ShadowRenderer = (
  ctx: CanvasRenderingContext2D,
  fragment: TextFragment,
  x: number,
  y: number,
  color: string,
) => void;
const DPR = 1.75;
const FONT = 'italic 600 18px "Test Family"';
const COLOR = '#314159';
const FRAGMENT: TextFragment = {
  text: 'shadow text',
  rect: { x: 30, y: 40, width: 51.25, height: 20.5 },
  paint: {
    color: '#000000',
    font: { style: 'italic', weight: 600, sizePx: 18, family: 'Test Family' },
    wordSpacingPx: 2.5,
    letterSpacingPx: -0.75,
    textShadow: [
      { offsetX: 4, offsetY: -3, blur: 2, color: '#cc3300' },
      { offsetX: -5, offsetY: 6, blur: 1.25, color: '#2244ff' },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('production Canvas text shadows', () => {
  it('paints pure shadow layers with an off-canvas caster, no glyph erasure', () => {
    // The scratch holds ONLY shadow ink: the casting glyph paints far
    // off-canvas with the shadow offset walked back (device space), so
    // no destination-out erasure runs — erasing by the glyph's own
    // alpha left color residue on antialiased edges and every shadowed
    // glyph rimmed darker than the browser's.
    const snapshot = renderProduction({
      offscreen: 'context',
      dom: 'context',
    });
    const scratch = onlyScratch(snapshot);

    expect(scratch).toMatchObject({
      kind: 'offscreen',
      width: 117,
      height: 63,
      getContextCalls: ['2d'],
    });
    expect(snapshot.domCreateElementCalls).toEqual([]);
    expect(propertyValues(scratch.records, 'shadowColor')).toEqual(['#2244ff', '#cc3300']);
    expect(propertyValues(scratch.records, 'shadowBlur')).toEqual([2.1875, 3.5]);
    expect(propertyValues(scratch.records, 'wordSpacing')).toEqual(['2.5px']);
    expect(propertyValues(scratch.records, 'letterSpacing')).toEqual(['-0.75px']);
    expect(propertyValues(scratch.records, 'globalCompositeOperation')).toEqual([]);
    expect(propertyValues(scratch.records, 'shadowOffsetY')).toEqual([
      (6 + 20000) * 1.75,
      (-3 + 20000) * 1.75,
    ]);
    // The caster anchors at the alphabetic baseline: padTop 7 plus
    // 0.8 × 18px, the renderer's shared convention (adfff36e — a
    // top-baseline caster hung every shadow fontAscent − 0.8em low).
    expect(callArguments(scratch.records, 'fillText')).toEqual([
      ['shadow text', 7.5, 7 + 0.8 * 18 - 20000],
      ['shadow text', 7.5, 7 + 0.8 * 18 - 20000],
    ]);
    expect(callArguments(snapshot.main, 'drawImage')).toEqual([
      [
        { scratchCanvas: 0, kind: 'offscreen', width: 117, height: 63 },
        0,
        0,
        117,
        63,
        22.5,
        33,
        66.75,
        36,
      ],
    ]);
  });

  it('renders through the DOM canvas fallback', () => {
    const snapshot = renderProduction({
      offscreen: 'missing',
      dom: 'context',
    });

    expect(onlyScratch(snapshot).kind).toBe('dom');
    expect(snapshot.domCreateElementCalls).toEqual(['canvas']);
  });

  it('matches the reference early return when no canvas implementation exists', () => {
    const snapshot = expectProductionToMatchReference({
      offscreen: 'missing',
      dom: 'missing',
    });

    expect(snapshot.scratch).toEqual([]);
    expect(callArguments(snapshot.main, 'drawImage')).toEqual([]);
  });

  it('does not fall back to DOM when OffscreenCanvas getContext returns null', () => {
    const snapshot = expectProductionToMatchReference({
      offscreen: 'null',
      dom: 'context',
    });
    const scratch = onlyScratch(snapshot);

    expect(scratch.kind).toBe('offscreen');
    expect(scratch.getContextCalls).toEqual(['2d']);
    expect(scratch.records).toEqual([]);
    expect(snapshot.domCreateElementCalls).toEqual([]);
    expect(callArguments(snapshot.main, 'drawImage')).toEqual([]);
  });

  it('propagates a scratch fillText failure without compositing to the main canvas', () => {
    const environment = installScratchCanvasEnvironment({
      offscreen: 'context',
      dom: 'missing',
      throwOnFillTextCall: 2,
    });
    const main = createMainContext();

    expect(() => {
      drawProductionTextShadows(main.ctx, FRAGMENT, FRAGMENT.rect.x, FRAGMENT.rect.y, COLOR);
    }).toThrow('forced scratch fillText failure');

    expect(environment.scratch[0]).toBeDefined();
    expect(main.getCalls('drawImage')).toEqual([]);
  });
});

function renderProduction(options: ScratchCanvasEnvironmentOptions): CanvasRecordsSnapshot {
  return renderWith(drawProductionTextShadows, options);
}

function expectProductionToMatchReference(
  options: ScratchCanvasEnvironmentOptions,
): CanvasRecordsSnapshot {
  const reference = renderWith(drawReferenceTextShadows, options);
  vi.unstubAllGlobals();
  const production = renderWith(drawProductionTextShadows, options);
  expect(production).toEqual(reference);
  return production;
}

function renderWith(
  renderer: ShadowRenderer,
  options: ScratchCanvasEnvironmentOptions,
): CanvasRecordsSnapshot {
  const environment = installScratchCanvasEnvironment(options);
  const main = createMainContext();
  renderer(main.ctx, FRAGMENT, FRAGMENT.rect.x, FRAGMENT.rect.y, COLOR);
  return snapshotCanvasRecords(main, environment);
}

function createMainContext(): MockCanvasContext {
  const main = createMockCanvasContext();
  main.ctx.font = FONT;
  main.ctx.scale(DPR, DPR);
  return main;
}

function propertyValues(records: readonly CanvasRecord[], property: string): readonly unknown[] {
  return records
    .filter(
      (record): record is CanvasPropertySet =>
        isPropertySet(record) && record.property === property,
    )
    .map((record) => record.value);
}

function callArguments(records: readonly CanvasRecord[], method: string): readonly unknown[][] {
  return records
    .filter((record): record is CanvasCall => isCall(record) && record.method === method)
    .map((record) => [...record.args]);
}

function onlyScratch(snapshot: CanvasRecordsSnapshot): ScratchCanvasSnapshot {
  const scratch = snapshot.scratch[0];
  if (!scratch || snapshot.scratch.length !== 1) {
    throw new Error(`Expected one scratch canvas, received ${String(snapshot.scratch.length)}.`);
  }
  return scratch;
}
