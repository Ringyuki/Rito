import { describe, expect, it } from 'vitest';
import { parseBackgroundPosition } from '../../src/style/css/parse-background-position';

describe('parseBackgroundPosition', () => {
  describe('two-token keyword combinations', () => {
    it('left top → (0%, 0%)', () => {
      expect(parseBackgroundPosition('left top')).toEqual({
        x: { unit: 'percent', value: 0 },
        y: { unit: 'percent', value: 0 },
      });
    });

    it('center center → (50%, 50%)', () => {
      expect(parseBackgroundPosition('center center')).toEqual({
        x: { unit: 'percent', value: 50 },
        y: { unit: 'percent', value: 50 },
      });
    });

    it('right bottom → (100%, 100%)', () => {
      expect(parseBackgroundPosition('right bottom')).toEqual({
        x: { unit: 'percent', value: 100 },
        y: { unit: 'percent', value: 100 },
      });
    });

    it('center top → (50%, 0%)', () => {
      expect(parseBackgroundPosition('center top')).toEqual({
        x: { unit: 'percent', value: 50 },
        y: { unit: 'percent', value: 0 },
      });
    });

    it('top left (vertical first, horizontal second) is swapped', () => {
      expect(parseBackgroundPosition('top left')).toEqual({
        x: { unit: 'percent', value: 0 },
        y: { unit: 'percent', value: 0 },
      });
    });
  });

  describe('single-token input', () => {
    it('center → both axes 50%', () => {
      expect(parseBackgroundPosition('center')).toEqual({
        x: { unit: 'percent', value: 50 },
        y: { unit: 'percent', value: 50 },
      });
    });

    it('left → x=0% y=50%', () => {
      expect(parseBackgroundPosition('left')).toEqual({
        x: { unit: 'percent', value: 0 },
        y: { unit: 'percent', value: 50 },
      });
    });

    it('top → x=50% y=0%', () => {
      expect(parseBackgroundPosition('top')).toEqual({
        x: { unit: 'percent', value: 50 },
        y: { unit: 'percent', value: 0 },
      });
    });

    it('bottom → x=50% y=100%', () => {
      expect(parseBackgroundPosition('bottom')).toEqual({
        x: { unit: 'percent', value: 50 },
        y: { unit: 'percent', value: 100 },
      });
    });
  });

  describe('length/percentage values', () => {
    it('10px 20px', () => {
      expect(parseBackgroundPosition('10px 20px')).toEqual({
        x: { unit: 'px', value: 10 },
        y: { unit: 'px', value: 20 },
      });
    });

    it('25% 75%', () => {
      expect(parseBackgroundPosition('25% 75%')).toEqual({
        x: { unit: 'percent', value: 25 },
        y: { unit: 'percent', value: 75 },
      });
    });

    it('mixed: 20% 10px', () => {
      expect(parseBackgroundPosition('20% 10px')).toEqual({
        x: { unit: 'percent', value: 20 },
        y: { unit: 'px', value: 10 },
      });
    });

    it('single length 10px → y defaults to 50%', () => {
      expect(parseBackgroundPosition('10px')).toEqual({
        x: { unit: 'px', value: 10 },
        y: { unit: 'percent', value: 50 },
      });
    });
  });

  describe('edge cases / unparseable', () => {
    it('empty string → undefined', () => {
      expect(parseBackgroundPosition('')).toBeUndefined();
    });

    it('whitespace only → undefined', () => {
      expect(parseBackgroundPosition('   ')).toBeUndefined();
    });

    it('pure junk → undefined', () => {
      expect(parseBackgroundPosition('foo bar')).toBeUndefined();
    });

    it('case-insensitive ("LEFT TOP" works)', () => {
      expect(parseBackgroundPosition('LEFT TOP')).toEqual({
        x: { unit: 'percent', value: 0 },
        y: { unit: 'percent', value: 0 },
      });
    });
  });
});
