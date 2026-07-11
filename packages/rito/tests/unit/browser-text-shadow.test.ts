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
  it('matches reference records with OffscreenCanvas, DPR, spacing, and layered erasure', () => {
    const snapshot = expectProductionToMatchReference({
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
    expect(propertyValues(scratch.records, 'shadowColor')).toEqual([
      '#2244ff',
      '#cc3300',
      'transparent',
    ]);
    expect(propertyValues(scratch.records, 'shadowBlur')).toEqual([2.1875, 3.5, 0]);
    expect(propertyValues(scratch.records, 'wordSpacing')).toEqual(['2.5px']);
    expect(propertyValues(scratch.records, 'letterSpacing')).toEqual(['-0.75px']);
    expect(propertyValues(scratch.records, 'globalCompositeOperation')).toEqual([
      'destination-out',
      'source-over',
    ]);
    expect(callArguments(scratch.records, 'fillText')).toEqual([
      ['shadow text', 7.5, 7],
      ['shadow text', 7.5, 7],
      ['shadow text', 7.5, 7],
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

  it('matches reference records through the DOM canvas fallback', () => {
    const snapshot = expectProductionToMatchReference({
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

  it('restores scratch compositing when glyph erasure throws', () => {
    const environment = installScratchCanvasEnvironment({
      offscreen: 'context',
      dom: 'missing',
      throwOnFillTextCall: 3,
    });
    const main = createMainContext();

    expect(() => {
      drawProductionTextShadows(main.ctx, FRAGMENT, FRAGMENT.rect.x, FRAGMENT.rect.y, COLOR);
    }).toThrow('forced scratch fillText failure');

    const scratch = environment.scratch[0];
    expect(scratch).toBeDefined();
    expect(propertyValues(scratch?.recorder.records ?? [], 'globalCompositeOperation')).toEqual([
      'destination-out',
      'source-over',
    ]);
    expect(scratch?.context.globalCompositeOperation).toBe('source-over');
    expect(main.getCalls('drawImage')).toEqual([]);
  });
});

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
