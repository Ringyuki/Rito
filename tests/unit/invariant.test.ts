import { describe, expect, it } from 'vitest';
import { invariant } from '../../src/utils/invariant.js';

describe('invariant', () => {
  it('does not throw when condition is true', () => {
    expect(() => {
      invariant(true, 'should not throw');
    }).not.toThrow();
  });

  it('throws with message when condition is false', () => {
    expect(() => {
      invariant(false, 'expected failure');
    }).toThrow('Invariant violation: expected failure');
  });
});
