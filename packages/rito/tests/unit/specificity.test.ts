import { describe, expect, it } from 'vitest';
import { calculateSpecificity, compareSpecificity } from '../../src/style/specificity';

describe('calculateSpecificity', () => {
  it('element selector', () => {
    expect(calculateSpecificity('p')).toEqual([0, 0, 1]);
  });

  it('class selector', () => {
    expect(calculateSpecificity('.intro')).toEqual([0, 1, 0]);
  });

  it('id selector', () => {
    expect(calculateSpecificity('#ch1')).toEqual([1, 0, 0]);
  });

  it('compound element + class', () => {
    expect(calculateSpecificity('p.intro')).toEqual([0, 1, 1]);
  });

  it('compound with id + class + element', () => {
    expect(calculateSpecificity('div#main.container')).toEqual([1, 1, 1]);
  });

  it('multiple classes', () => {
    expect(calculateSpecificity('.a.b.c')).toEqual([0, 3, 0]);
  });

  it('element with multiple classes', () => {
    expect(calculateSpecificity('p.a.b')).toEqual([0, 2, 1]);
  });
});

describe('compareSpecificity', () => {
  it('id beats class', () => {
    expect(compareSpecificity([1, 0, 0], [0, 1, 0])).toBeGreaterThan(0);
  });

  it('class beats element', () => {
    expect(compareSpecificity([0, 1, 0], [0, 0, 1])).toBeGreaterThan(0);
  });

  it('equal specificities return 0', () => {
    expect(compareSpecificity([0, 1, 1], [0, 1, 1])).toBe(0);
  });

  it('higher class count wins', () => {
    expect(compareSpecificity([0, 2, 0], [0, 1, 1])).toBeGreaterThan(0);
  });
});
