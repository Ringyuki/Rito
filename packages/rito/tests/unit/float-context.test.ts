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
  });

  describe('replacing an existing float', () => {
    it('replaces a left float with a new one', () => {
      const ctx = new FloatContext();
      ctx.addFloat('left', 80, 200);
      ctx.addFloat('left', 50, 300);
      expect(ctx.getLeftWidth(0)).toBe(50);
      expect(ctx.getClearY('left')).toBe(300);
    });

    it('replaces a right float with a new one', () => {
      const ctx = new FloatContext();
      ctx.addFloat('right', 60, 100);
      ctx.addFloat('right', 90, 250);
      expect(ctx.getRightWidth(0)).toBe(90);
      expect(ctx.getClearY('right')).toBe(250);
    });
  });
});
