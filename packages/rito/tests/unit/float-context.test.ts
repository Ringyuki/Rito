import { describe, expect, it } from 'vitest';
import { FloatContext } from '../../src/layout/block/float-context';

describe('FloatContext', () => {
  it('returns 0 widths when no floats are present', () => {
    const ctx = new FloatContext();
    expect(ctx.getLeftWidth(0)).toBe(0);
    expect(ctx.getRightWidth(0)).toBe(0);
    expect(ctx.getLeftWidth(100)).toBe(0);
    expect(ctx.getRightWidth(100)).toBe(0);
  });

  describe('addFloat left', () => {
    it('reports width when Y is within [startY, bottomY)', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      expect(ctx.getLeftWidth(0)).toBe(80);
      expect(ctx.getLeftWidth(100)).toBe(80);
      expect(ctx.getLeftWidth(199)).toBe(80);
    });

    it('reports 0 when Y is past bottomY + tolerance', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      expect(ctx.getLeftWidth(202)).toBe(0);
      expect(ctx.getLeftWidth(300)).toBe(0);
    });

    it('reports 0 when Y is before startY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 50, 200);
      expect(ctx.getLeftWidth(0)).toBe(0);
      expect(ctx.getLeftWidth(49)).toBe(0);
      expect(ctx.getLeftWidth(50)).toBe(80);
    });

    it('does not affect right width', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      expect(ctx.getRightWidth(0)).toBe(0);
    });
  });

  describe('addFloat right', () => {
    it('reports width when Y is within [startY, bottomY)', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 150);
      expect(ctx.getRightWidth(0)).toBe(60);
      expect(ctx.getRightWidth(149)).toBe(60);
    });

    it('reports 0 when Y is past bottomY + tolerance', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 150);
      expect(ctx.getRightWidth(152)).toBe(0);
      expect(ctx.getRightWidth(200)).toBe(0);
    });

    it('does not affect left width', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 150);
      expect(ctx.getLeftWidth(0)).toBe(0);
    });
  });

  describe('multiple left floats stacking', () => {
    it('sums widths of all active left floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      ctx.addFloat('left', 50, 0, 300);
      expect(ctx.getLeftWidth(0)).toBe(130);
      expect(ctx.getLeftWidth(150)).toBe(130);
    });

    it('only sums floats that are still active at given y', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      ctx.addFloat('left', 50, 0, 300);
      // At y=250, the first float (bottomY=200) has expired
      expect(ctx.getLeftWidth(250)).toBe(50);
    });

    it('returns 0 when all left floats have expired', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      ctx.addFloat('left', 50, 0, 300);
      expect(ctx.getLeftWidth(302)).toBe(0);
    });
  });

  describe('multiple right floats stacking', () => {
    it('sums widths of all active right floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 150);
      ctx.addFloat('right', 40, 0, 250);
      expect(ctx.getRightWidth(0)).toBe(100);
      expect(ctx.getRightWidth(100)).toBe(100);
    });

    it('only sums floats that are still active at given y', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 150);
      ctx.addFloat('right', 40, 0, 250);
      // At y=200, first right float has expired
      expect(ctx.getRightWidth(200)).toBe(40);
    });

    it('returns 0 when all right floats have expired', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 150);
      ctx.addFloat('right', 40, 0, 250);
      expect(ctx.getRightWidth(252)).toBe(0);
    });
  });

  describe('mixed left and right floats', () => {
    it('tracks left and right floats independently', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      ctx.addFloat('left', 30, 0, 250);
      ctx.addFloat('right', 60, 0, 150);
      ctx.addFloat('right', 40, 0, 300);

      expect(ctx.getLeftWidth(0)).toBe(110);
      expect(ctx.getRightWidth(0)).toBe(100);
    });

    it('expires each side independently at a given y', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 100);
      ctx.addFloat('right', 60, 0, 200);
      // At y=150: left expired, right still active
      expect(ctx.getLeftWidth(150)).toBe(0);
      expect(ctx.getRightWidth(150)).toBe(60);
    });
  });

  describe('clearExpired', () => {
    it('removes a left float when Y >= bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 100);
      ctx.clearExpired(100);
      expect(ctx.getLeftWidth(0)).toBe(0);
    });

    it('removes a right float when Y >= bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 100);
      ctx.clearExpired(150);
      expect(ctx.getRightWidth(0)).toBe(0);
    });

    it('keeps a float when Y < bottomY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 100);
      ctx.clearExpired(99);
      expect(ctx.getLeftWidth(0)).toBe(80);
    });

    it('clears both floats independently', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 100);
      ctx.addFloat('right', 60, 0, 200);
      ctx.clearExpired(150);
      expect(ctx.getLeftWidth(0)).toBe(0);
      expect(ctx.getRightWidth(0)).toBe(60);
    });

    it('partially expires stacked floats on the same side', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 100);
      ctx.addFloat('left', 50, 0, 200);
      ctx.addFloat('left', 30, 0, 300);
      ctx.clearExpired(150);
      // Only the first float (bottomY=100) is removed
      expect(ctx.getLeftWidth(0)).toBe(80); // 50 + 30
      expect(ctx.getClearY('left')).toBe(300);
    });

    it('removes all floats when y is past all bottomYs', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 100);
      ctx.addFloat('left', 50, 0, 200);
      ctx.addFloat('right', 60, 0, 150);
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
      ctx.addFloat('left', 80, 0, 120);
      ctx.addFloat('right', 60, 0, 200);
      expect(ctx.getClearY('left')).toBe(120);
    });

    it('returns right bottomY for clear right', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 120);
      ctx.addFloat('right', 60, 0, 200);
      expect(ctx.getClearY('right')).toBe(200);
    });

    it('returns the max of both for clear both', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 120);
      ctx.addFloat('right', 60, 0, 200);
      expect(ctx.getClearY('both')).toBe(200);
    });

    it('returns left bottomY when only left exists and clear is both', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 150);
      expect(ctx.getClearY('both')).toBe(150);
    });

    it('returns max bottomY among multiple left floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 100);
      ctx.addFloat('left', 50, 0, 300);
      ctx.addFloat('left', 30, 0, 200);
      expect(ctx.getClearY('left')).toBe(300);
    });

    it('returns max bottomY among multiple right floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 150);
      ctx.addFloat('right', 40, 0, 350);
      ctx.addFloat('right', 20, 0, 250);
      expect(ctx.getClearY('right')).toBe(350);
    });

    it('returns max across both sides for clear both with stacked floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      ctx.addFloat('left', 50, 0, 100);
      ctx.addFloat('right', 60, 0, 300);
      ctx.addFloat('right', 40, 0, 150);
      expect(ctx.getClearY('both')).toBe(300);
    });
  });

  describe('stacking floats (addFloat accumulates)', () => {
    it('accumulates multiple left floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 0, 200);
      ctx.addFloat('left', 50, 0, 300);
      expect(ctx.getLeftWidth(0)).toBe(130);
      expect(ctx.getClearY('left')).toBe(300);
    });

    it('accumulates multiple right floats', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 0, 100);
      ctx.addFloat('right', 90, 0, 250);
      expect(ctx.getRightWidth(0)).toBe(150);
      expect(ctx.getClearY('right')).toBe(250);
    });
  });

  describe('startY semantics', () => {
    it('pushed-down float is not active at earlier Y values', () => {
      const ctx = new FloatContext();
      // Left float at y=0..100
      ctx.addFloat('left', 200, 0, 100);
      // Right float pushed down to y=100..200
      ctx.addFloat('right', 200, 100, 200);

      // At y=0: only the left float is active
      expect(ctx.getLeftWidth(0)).toBe(200);
      expect(ctx.getRightWidth(0)).toBe(0);

      // At y=50: only the left float is active
      expect(ctx.getLeftWidth(50)).toBe(200);
      expect(ctx.getRightWidth(50)).toBe(0);

      // At y=102: left expired (past tolerance), right active
      expect(ctx.getLeftWidth(102)).toBe(0);
      expect(ctx.getRightWidth(102)).toBe(200);

      // At y=202: both expired (past tolerance)
      expect(ctx.getLeftWidth(202)).toBe(0);
      expect(ctx.getRightWidth(202)).toBe(0);
    });

    it('getNextClearance respects startY', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 100, 0, 50);
      ctx.addFloat('right', 100, 80, 150);

      // At y=0, only left is active → next clearance = 50
      expect(ctx.getNextClearance(0)).toBe(50);
      // At y=80, both active → next clearance = min(50, 150) but left already expired
      // Actually at y=80, left (0..50) is NOT active, right (80..150) is → 150
      expect(ctx.getNextClearance(80)).toBe(150);
    });
  });
});
