import { describe, expect, it } from 'vitest';

import {
  cssLandingOn,
  deviceQuarters,
  deviceRow,
  glyphQuarters,
} from '../../src/bindings/browser/gl-pen/glyph-position';

describe('where the canvas puts a glyph', () => {
  it('rounds the device x to the nearest quarter pixel, a tie going up', () => {
    expect(deviceQuarters(10, 1, 0)).toBe(40);
    expect(deviceQuarters(10.1, 1, 0)).toBe(40);
    expect(deviceQuarters(10.125, 1, 0)).toBe(41);
    expect(deviceQuarters(10.375, 1, 0)).toBe(42);
    expect(deviceQuarters(-0.125, 1, 0)).toBe(0);
    expect(deviceQuarters(-0.2, 1, 0)).toBe(-1);
  });

  it('takes the origin at float32 before it rounds', () => {
    // In double this sits just below the tie and would round down; the
    // canvas takes it as 266.125 and rounds up.
    expect(deviceQuarters(266.12499999, 1, 0)).toBe(1065);
  });

  it('adds its eighth in float, so a sum the float rounds up goes to the next quarter', () => {
    // Measured on a page: the glyph at device 1859.87494 draws as the one
    // at 1860.0 — in float, 1859.87494 + 0.125 is 1860.
    expect(deviceQuarters(319.9374694824219, 2, 1220)).toBe(7440);
    expect(deviceQuarters(319.93743896484375, 2, 1220)).toBe(7439);
  });

  it("maps a glyph inside a string after the string's origin went into the matrix", () => {
    // Measured on a page: "Rowling, " drawn at 282.24374 in a right page
    // (translate 1220, ratio 2) draws its g as a g on its own draws at
    // 1860.0; adding origin and offset first would put it at 1859.75.
    expect(glyphQuarters(282.2437438964844, 37.69371032714844, 2, 1220)).toBe(7440);
    expect(deviceQuarters(282.2437438964844 + 37.69371032714844, 2, 1220)).toBe(7439);
  });

  it('scales by the ratio and then translates in device pixels', () => {
    expect(deviceQuarters(5.0625, 2, 0)).toBe(41);
    expect(deviceQuarters(5.0625, 2, 600)).toBe(2441);
    expect(deviceQuarters(10, 1.5, 0)).toBe(60);
  });

  it('puts the baseline on the nearest device row, a tie going down the page', () => {
    expect(deviceRow(32.8, 1, 0)).toBe(33);
    expect(deviceRow(32.5, 1, 0)).toBe(33);
    expect(deviceRow(32.4, 1, 0)).toBe(32);
    expect(deviceRow(16.4, 2, 1)).toBe(34);
  });

  it('finds the CSS coordinate that lands on a device position', () => {
    for (const ratio of [1, 1.25, 1.5, 1.75, 2, 3]) {
      for (const device of [3, 3.25, 3.5, 3.75, 1021.75]) {
        expect(deviceQuarters(cssLandingOn(device, ratio), ratio, 0)).toBe(device * 4);
      }
    }
  });
});
