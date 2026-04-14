/**
 * Phase 0 characterization: CSS transform parsing inside block-renderer.
 *
 * These tests pin down the CURRENT runtime behavior of the string-based
 * `applyTransform` in block-renderer.ts so that Phase 1 can replace the parser
 * with structured TransformFn[] without silent behavioral drift.
 *
 * Any intentional semantic change in Phase 1 must update these tests explicitly.
 */
import { describe, expect, it } from 'vitest';
import { renderBlock } from '../../src/render/page/block-renderer';
import type { LayoutBlock } from '../../src/layout/core/types';
import { createMockCanvasContext, type CanvasCall, isCall } from '../helpers/mock-canvas-context';

const DEG_TO_RAD = Math.PI / 180;

function makeBlock(transform: string): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: 100, height: 60 },
    children: [],
    transform,
  };
}

/** Calls recorded between the first save() and its matching restore(). */
function calls(records: readonly unknown[]): CanvasCall[] {
  return (records as ReadonlyArray<CanvasCall>).filter(isCall);
}

/** Expected transform-block center for a 100×60 block at origin. */
const CX = 50;
const CY = 30;

describe('Phase 0 — transform characterization', () => {
  describe('rotate()', () => {
    it('rotate(45deg) emits rotate with 45 × (π/180) radians', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('rotate(45deg)'), 0, 0);

      const rotate = calls(mock.records).find((c) => c.method === 'rotate');
      expect(rotate?.args[0]).toBeCloseTo(45 * DEG_TO_RAD, 10);
    });

    it('rotate(1rad) emits rotate with 1 radian', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('rotate(1rad)'), 0, 0);
      const rotate = calls(mock.records).find((c) => c.method === 'rotate');
      expect(rotate?.args[0]).toBeCloseTo(1, 10);
    });

    it('rotate(0.5turn) emits rotate with π radians', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('rotate(0.5turn)'), 0, 0);
      const rotate = calls(mock.records).find((c) => c.method === 'rotate');
      expect(rotate?.args[0]).toBeCloseTo(Math.PI, 10);
    });

    it('rotate(45) without unit is treated as degrees', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('rotate(45)'), 0, 0);
      const rotate = calls(mock.records).find((c) => c.method === 'rotate');
      expect(rotate?.args[0]).toBeCloseTo(45 * DEG_TO_RAD, 10);
    });
  });

  describe('scale()', () => {
    it('scale(2) applies uniform scale to both axes', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('scale(2)'), 0, 0);
      const scale = calls(mock.records).find((c) => c.method === 'scale');
      expect(scale?.args).toEqual([2, 2]);
    });

    it('scale(2, 3) applies sx=2 sy=3', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('scale(2, 3)'), 0, 0);
      const scale = calls(mock.records).find((c) => c.method === 'scale');
      expect(scale?.args).toEqual([2, 3]);
    });

    it('scaleX(2) applies sx=2 sy=1', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('scaleX(2)'), 0, 0);
      const scale = calls(mock.records).find((c) => c.method === 'scale');
      expect(scale?.args).toEqual([2, 1]);
    });

    it('scaleY(2) applies sx=1 sy=2', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('scaleY(2)'), 0, 0);
      const scale = calls(mock.records).find((c) => c.method === 'scale');
      expect(scale?.args).toEqual([1, 2]);
    });
  });

  describe('translate()', () => {
    it('translate(10px, 20px) emits ctx.translate(10, 20) between centering translates', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('translate(10px, 20px)'), 0, 0);

      const translates = calls(mock.records).filter((c) => c.method === 'translate');
      // Centering: [CX, CY], then inner [10, 20], then reverse centering [-CX, -CY]
      expect(translates).toHaveLength(3);
      expect(translates[0]?.args).toEqual([CX, CY]);
      expect(translates[1]?.args).toEqual([10, 20]);
      expect(translates[2]?.args).toEqual([-CX, -CY]);
    });

    it('translateX(15px) applies x=15 y=0', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('translateX(15px)'), 0, 0);
      const translates = calls(mock.records).filter((c) => c.method === 'translate');
      expect(translates[1]?.args).toEqual([15, 0]);
    });

    it('translateY(15px) applies x=0 y=15', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('translateY(15px)'), 0, 0);
      const translates = calls(mock.records).filter((c) => c.method === 'translate');
      expect(translates[1]?.args).toEqual([0, 15]);
    });

    it('translate(20%, 30%) CURRENTLY parses % as bare number (parseFloat behavior)', () => {
      // NOTE: Phase 1 changes this — `%` will be resolved against the box
      // dimensions via the new LengthPct type. When that lands, this assertion
      // must be replaced with the box-relative expected value.
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('translate(20%, 30%)'), 0, 0);
      const translates = calls(mock.records).filter((c) => c.method === 'translate');
      expect(translates[1]?.args).toEqual([20, 30]);
    });

    it('translate(10px) with only one arg sets y to 0 (missing → 0)', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('translate(10px)'), 0, 0);
      const translates = calls(mock.records).filter((c) => c.method === 'translate');
      expect(translates[1]?.args).toEqual([10, 0]);
    });
  });

  describe('composition', () => {
    it('rotate(45deg) translate(10px, 5px) applies rotate then translate in order', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('rotate(45deg) translate(10px, 5px)'), 0, 0);

      const ordered = calls(mock.records).filter(
        (c) => c.method === 'rotate' || c.method === 'scale' || c.method === 'translate',
      );
      // [translate CX,CY] [rotate 45°] [translate 10,5] [translate -CX,-CY]
      expect(ordered.map((c) => c.method)).toEqual([
        'translate',
        'rotate',
        'translate',
        'translate',
      ]);
      expect(ordered[0]?.args).toEqual([CX, CY]);
      expect(ordered[1]?.args[0]).toBeCloseTo(45 * DEG_TO_RAD, 10);
      expect(ordered[2]?.args).toEqual([10, 5]);
      expect(ordered[3]?.args).toEqual([-CX, -CY]);
    });

    it('scale(2) rotate(90deg) applies scale then rotate', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('scale(2) rotate(90deg)'), 0, 0);

      const ordered = calls(mock.records).filter(
        (c) => c.method === 'rotate' || c.method === 'scale',
      );
      expect(ordered.map((c) => c.method)).toEqual(['scale', 'rotate']);
      expect(ordered[0]?.args).toEqual([2, 2]);
      expect(ordered[1]?.args[0]).toBeCloseTo(90 * DEG_TO_RAD, 10);
    });
  });

  describe('unknown / unsupported functions', () => {
    it('matrix() is silently ignored (regex does not match)', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('matrix(1, 0, 0, 1, 10, 20)'), 0, 0);
      const hasRotate = calls(mock.records).some((c) => c.method === 'rotate');
      const hasScale = calls(mock.records).some((c) => c.method === 'scale');
      // Only the two centering translates should be emitted; no inner ops.
      const translates = calls(mock.records).filter((c) => c.method === 'translate');
      expect(hasRotate).toBe(false);
      expect(hasScale).toBe(false);
      expect(translates).toHaveLength(2);
      expect(translates[0]?.args).toEqual([CX, CY]);
      expect(translates[1]?.args).toEqual([-CX, -CY]);
    });

    it('skew() is silently ignored', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('skew(10deg)'), 0, 0);
      const hasRotate = calls(mock.records).some((c) => c.method === 'rotate');
      const hasScale = calls(mock.records).some((c) => c.method === 'scale');
      const translates = calls(mock.records).filter((c) => c.method === 'translate');
      expect(hasRotate).toBe(false);
      expect(hasScale).toBe(false);
      expect(translates).toHaveLength(2);
    });
  });

  describe('save/restore wrapping', () => {
    it('wraps transform application in save/restore', () => {
      const mock = createMockCanvasContext();
      renderBlock(mock.ctx, makeBlock('rotate(45deg)'), 0, 0);
      const all = calls(mock.records);
      // First call must be save (transform path saves before translating)
      expect(all[0]?.method).toBe('save');
      // Last call must be restore (matching the save)
      expect(all.at(-1)?.method).toBe('restore');
    });
  });

  describe('empty / no transform', () => {
    it('missing transform skips the transform path entirely', () => {
      const mock = createMockCanvasContext();
      const block: LayoutBlock = {
        type: 'layout-block',
        bounds: { x: 0, y: 0, width: 100, height: 60 },
        children: [],
      };
      renderBlock(mock.ctx, block, 0, 0);
      const hasRotate = calls(mock.records).some((c) => c.method === 'rotate');
      const hasScale = calls(mock.records).some((c) => c.method === 'scale');
      const hasTranslate = calls(mock.records).some((c) => c.method === 'translate');
      expect(hasRotate).toBe(false);
      expect(hasScale).toBe(false);
      expect(hasTranslate).toBe(false);
    });
  });
});
