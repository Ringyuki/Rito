import { describe, expect, it } from 'vitest';
import {
  canBreakTextAt,
  getLineBreakOffsets,
  splitLineBreakSegments,
} from '../../src/layout/line-breaker/break-classifier';

describe('break classifier', () => {
  it('uses UAX/CSS line-break segments for mixed-script text', () => {
    expect(
      splitLineBreakSegments('ABC甲DEF', {
        lineBreak: 'strict',
        language: 'ja',
        wordBreak: 'normal',
      }),
    ).toEqual(['ABC', '甲', 'DEF']);
  });

  it('forbids breaks before closing punctuation', () => {
    const text = '甲乙丙。丁戊';
    const options = { lineBreak: 'strict', language: 'ja', wordBreak: 'normal' } as const;

    expect(canBreakTextAt(text, 3, options)).toBe(false);
    expect(canBreakTextAt(text, 4, options)).toBe(true);
    expect(Array.from(getLineBreakOffsets(text, options))).toEqual([1, 2, 4, 5]);
  });
});
