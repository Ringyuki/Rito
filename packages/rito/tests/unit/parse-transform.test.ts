import { describe, expect, it } from 'vitest';
import { parseTransform } from '../../src/style/css/parse-transform';

const DEG_TO_RAD = Math.PI / 180;

describe('parseTransform', () => {
  describe('rotate', () => {
    it('rotate(45deg)', () => {
      expect(parseTransform('rotate(45deg)')).toEqual([{ kind: 'rotate', rad: 45 * DEG_TO_RAD }]);
    });

    it('rotate(1rad) — rad is already radians', () => {
      expect(parseTransform('rotate(1rad)')).toEqual([{ kind: 'rotate', rad: 1 }]);
    });

    it('rotate(0.5turn) — 180°', () => {
      const fns = parseTransform('rotate(0.5turn)');
      expect(fns[0]?.kind).toBe('rotate');
      const rotate = fns[0];
      if (rotate?.kind === 'rotate') {
        expect(rotate.rad).toBeCloseTo(Math.PI, 10);
      }
    });

    it('rotate(45) bare number is treated as degrees', () => {
      const fns = parseTransform('rotate(45)');
      const rotate = fns[0];
      if (rotate?.kind === 'rotate') {
        expect(rotate.rad).toBeCloseTo(45 * DEG_TO_RAD, 10);
      }
    });

    it('rotate() with junk returns nothing', () => {
      expect(parseTransform('rotate(foo)')).toEqual([]);
    });
  });

  describe('scale', () => {
    it('scale(2) uniform', () => {
      expect(parseTransform('scale(2)')).toEqual([{ kind: 'scale', sx: 2, sy: 2 }]);
    });

    it('scale(2, 3) per-axis', () => {
      expect(parseTransform('scale(2, 3)')).toEqual([{ kind: 'scale', sx: 2, sy: 3 }]);
    });

    it('scaleX(2)', () => {
      expect(parseTransform('scaleX(2)')).toEqual([{ kind: 'scale', sx: 2, sy: 1 }]);
    });

    it('scaleY(2)', () => {
      expect(parseTransform('scaleY(2)')).toEqual([{ kind: 'scale', sx: 1, sy: 2 }]);
    });
  });

  describe('translate', () => {
    it('translate(10px, 20px)', () => {
      expect(parseTransform('translate(10px, 20px)')).toEqual([
        {
          kind: 'translate',
          x: { unit: 'px', value: 10 },
          y: { unit: 'px', value: 20 },
        },
      ]);
    });

    it('translate(20%, 30%)', () => {
      expect(parseTransform('translate(20%, 30%)')).toEqual([
        {
          kind: 'translate',
          x: { unit: 'percent', value: 20 },
          y: { unit: 'percent', value: 30 },
        },
      ]);
    });

    it('translate(10px) → y defaults to 0px', () => {
      expect(parseTransform('translate(10px)')).toEqual([
        {
          kind: 'translate',
          x: { unit: 'px', value: 10 },
          y: { unit: 'px', value: 0 },
        },
      ]);
    });

    it('translateX(15px)', () => {
      expect(parseTransform('translateX(15px)')).toEqual([
        {
          kind: 'translate',
          x: { unit: 'px', value: 15 },
          y: { unit: 'px', value: 0 },
        },
      ]);
    });

    it('translateY(15%)', () => {
      expect(parseTransform('translateY(15%)')).toEqual([
        {
          kind: 'translate',
          x: { unit: 'px', value: 0 },
          y: { unit: 'percent', value: 15 },
        },
      ]);
    });

    it('mixed units translate(10px, 5%)', () => {
      expect(parseTransform('translate(10px, 5%)')).toEqual([
        {
          kind: 'translate',
          x: { unit: 'px', value: 10 },
          y: { unit: 'percent', value: 5 },
        },
      ]);
    });
  });

  describe('composition', () => {
    it('rotate(45deg) translate(10px, 5px)', () => {
      const fns = parseTransform('rotate(45deg) translate(10px, 5px)');
      expect(fns).toHaveLength(2);
      expect(fns[0]?.kind).toBe('rotate');
      expect(fns[1]?.kind).toBe('translate');
    });

    it('ignores unsupported functions in a composition', () => {
      const fns = parseTransform('rotate(90deg) matrix(1,0,0,1,0,0) scale(2)');
      expect(fns).toHaveLength(2);
      expect(fns.map((f) => f.kind)).toEqual(['rotate', 'scale']);
    });
  });

  describe('edge cases', () => {
    it('empty string → []', () => {
      expect(parseTransform('')).toEqual([]);
    });

    it('whitespace only → []', () => {
      expect(parseTransform('   ')).toEqual([]);
    });

    it('"none" → []', () => {
      expect(parseTransform('none')).toEqual([]);
    });

    it('matrix() alone → []', () => {
      expect(parseTransform('matrix(1,0,0,1,10,20)')).toEqual([]);
    });

    it('skew() alone → []', () => {
      expect(parseTransform('skew(10deg)')).toEqual([]);
    });
  });
});
