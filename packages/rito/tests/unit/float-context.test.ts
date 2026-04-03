import { describe, expect, it } from 'vitest';
import { FloatContext } from '../../src/layout/float-context';

describe('FloatContext', () => {
  it('returns 0 widths when no floats are present', () => {
    const ctx = new FloatContext();
    expect(ctx.getLeftWidth(0)).toBe(0);
    expect(ctx.getRightWidth(0)).toBe(0);
    expect(ctx.getLeftWidth(100)).toBe(0);
    expect(ctx.getRightWidth(100)).toBe(0);
  });

  describe('addFloat left', () => {
    it('reports width when Y is above bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      expect(ctx.getLeftWidth(0)).toBe(80);
      expect(ctx.getLeftWidth(100)).toBe(80);
      expect(ctx.getLeftWidth(199)).toBe(80);
    });

    it('reports 0 when Y is at or past bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      expect(ctx.getLeftWidth(200)).toBe(0);
      expect(ctx.getLeftWidth(300)).toBe(0);
    });

    it('does not affect right width', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      expect(ctx.getRightWidth(0)).toBe(0);
    });
  });

  describe('addFloat right', () => {
    it('reports width when Y is above bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 150);
      expect(ctx.getRightWidth(0)).toBe(60);
      expect(ctx.getRightWidth(149)).toBe(60);
    });

    it('reports 0 when Y is at or past bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 150);
      expect(ctx.getRightWidth(150)).toBe(0);
      expect(ctx.getRightWidth(200)).toBe(0);
    });

    it('does not affect left width', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 150);
      expect(ctx.getLeftWidth(0)).toBe(0);
    });
  });

  describe('multiple left floats stacking', () => {
    it('sums widths of all active left floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      ctx.addFloat('left', 50, 300);
      expect(ctx.getLeftWidth(0)).toBe(130);
      expect(ctx.getLeftWidth(150)).toBe(130);
    });

    it('only sums floats that are still active at given y', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      ctx.addFloat('left', 50, 300);
      // At y=250, the first float (bottomY=200) has expired
      expect(ctx.getLeftWidth(250)).toBe(50);
    });

    it('returns 0 when all left floats have expired', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      ctx.addFloat('left', 50, 300);
      expect(ctx.getLeftWidth(300)).toBe(0);
    });
  });

  describe('multiple right floats stacking', () => {
    it('sums widths of all active right floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 150);
      ctx.addFloat('right', 40, 250);
      expect(ctx.getRightWidth(0)).toBe(100);
      expect(ctx.getRightWidth(100)).toBe(100);
    });

    it('only sums floats that are still active at given y', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 150);
      ctx.addFloat('right', 40, 250);
      // At y=200, first right float has expired
      expect(ctx.getRightWidth(200)).toBe(40);
    });

    it('returns 0 when all right floats have expired', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 150);
      ctx.addFloat('right', 40, 250);
      expect(ctx.getRightWidth(250)).toBe(0);
    });
  });

  describe('mixed left and right floats', () => {
    it('tracks left and right floats independently', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      ctx.addFloat('left', 30, 250);
      ctx.addFloat('right', 60, 150);
      ctx.addFloat('right', 40, 300);

      expect(ctx.getLeftWidth(0)).toBe(110);
      expect(ctx.getRightWidth(0)).toBe(100);
    });

    it('expires each side independently at a given y', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 100);
      ctx.addFloat('right', 60, 200);
      // At y=150: left expired, right still active
      expect(ctx.getLeftWidth(150)).toBe(0);
      expect(ctx.getRightWidth(150)).toBe(60);
    });
  });

  describe('clearExpired', () => {
    it('removes a left float when Y >= bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 100);
      ctx.clearExpired(100);
      expect(ctx.getLeftWidth(0)).toBe(0);
    });

    it('removes a right float when Y >= bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 100);
      ctx.clearExpired(150);
      expect(ctx.getRightWidth(0)).toBe(0);
    });

    it('keeps a float when Y < bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 100);
      ctx.clearExpired(99);
      expect(ctx.getLeftWidth(0)).toBe(80);
    });

    it('clears both floats independently', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 100);
      ctx.addFloat('right', 60, 200);
      ctx.clearExpired(150);
      expect(ctx.getLeftWidth(0)).toBe(0);
      expect(ctx.getRightWidth(0)).toBe(60);
    });

    it('partially expires stacked floats on the same side', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 100);
      ctx.addFloat('left', 50, 200);
      ctx.addFloat('left', 30, 300);
      ctx.clearExpired(150);
      // Only the first float (bottomY=100) is removed
      expect(ctx.getLeftWidth(0)).toBe(80); // 50 + 30
      expect(ctx.getClearY('left')).toBe(300);
    });

    it('removes all floats when y is past all bottomYs', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 100);
      ctx.addFloat('left', 50, 200);
      ctx.addFloat('right', 60, 150);
      ctx.clearExpired(200);
      expect(ctx.getLeftWidth(0)).toBe(0);
      expect(ctx.getRightWidth(0)).toBe(0);
    });
  });

  describe('getClearY', () => {
    it('returns 0 when no floats exist', () => {
      const ctx = new FloatContext();
      expect(ctx.getClearY('left')).toBe(0);
      expect(ctx.getClearY('right')).toBe(0);
      expect(ctx.getClearY('both')).toBe(0);
    });

    it('returns left bottomY for clear left', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 120);
      ctx.addFloat('right', 60, 200);
      expect(ctx.getClearY('left')).toBe(120);
    });

    it('returns right bottomY for clear right', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 120);
      ctx.addFloat('right', 60, 200);
      expect(ctx.getClearY('right')).toBe(200);
    });

    it('returns the max of both for clear both', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 120);
      ctx.addFloat('right', 60, 200);
      expect(ctx.getClearY('both')).toBe(200);
    });

    it('returns left bottomY when only left exists and clear is both', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 150);
      expect(ctx.getClearY('both')).toBe(150);
    });

    it('returns max bottomY among multiple left floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 100);
      ctx.addFloat('left', 50, 300);
      ctx.addFloat('left', 30, 200);
      expect(ctx.getClearY('left')).toBe(300);
    });

    it('returns max bottomY among multiple right floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 150);
      ctx.addFloat('right', 40, 350);
      ctx.addFloat('right', 20, 250);
      expect(ctx.getClearY('right')).toBe(350);
    });

    it('returns max across both sides for clear both with stacked floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      ctx.addFloat('left', 50, 100);
      ctx.addFloat('right', 60, 300);
      ctx.addFloat('right', 40, 150);
      expect(ctx.getClearY('both')).toBe(300);
    });
  });

  describe('stacking floats (addFloat accumulates)', () => {
    it('accumulates multiple left floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      ctx.addFloat('left', 50, 300);
      expect(ctx.getLeftWidth(0)).toBe(130);
      expect(ctx.getClearY('left')).toBe(300);
    });

    it('accumulates multiple right floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 100);
      ctx.addFloat('right', 90, 250);
      expect(ctx.getRightWidth(0)).toBe(150);
      expect(ctx.getClearY('right')).toBe(250);
    });
  });
});
