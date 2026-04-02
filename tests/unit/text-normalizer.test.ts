import { describe, expect, it } from 'vitest';
import { collapseWhitespace, isWhitespaceOnly } from '../../src/parser/xhtml/text-normalizer';

describe('collapseWhitespace', () => {
  it('collapses consecutive spaces', () => {
    expect(collapseWhitespace('hello   world')).toBe('hello world');
  });

  it('collapses tabs and newlines to a single space', () => {
    expect(collapseWhitespace('hello\n\t  world')).toBe('hello world');
  });

  it('preserves single spaces', () => {
    expect(collapseWhitespace('hello world')).toBe('hello world');
  });

  it('collapses leading and trailing whitespace within the string', () => {
    expect(collapseWhitespace('  hello  ')).toBe(' hello ');
  });

  it('handles empty string', () => {
    expect(collapseWhitespace('')).toBe('');
  });
});

describe('isWhitespaceOnly', () => {
  it('returns true for spaces only', () => {
    expect(isWhitespaceOnly('   ')).toBe(true);
  });

  it('returns true for tabs and newlines', () => {
    expect(isWhitespaceOnly('\n\t  \n')).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isWhitespaceOnly('')).toBe(true);
  });

  it('returns false for non-whitespace content', () => {
    expect(isWhitespaceOnly('hello')).toBe(false);
    expect(isWhitespaceOnly(' hello ')).toBe(false);
  });
});
