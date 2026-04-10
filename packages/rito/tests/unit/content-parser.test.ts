import { describe, expect, it } from 'vitest';
import { parseContentValue } from '../../src/style/css/property-handlers/content-handler';

describe('parseContentValue', () => {
  it('returns undefined when content is not declared', () => {
    expect(parseContentValue('color: red; font-size: 16px')).toBeUndefined();
  });

  it('returns null for content: none', () => {
    expect(parseContentValue('content: none')).toBeNull();
  });

  it('returns null for content: normal', () => {
    expect(parseContentValue('content: normal')).toBeNull();
  });

  it('parses double-quoted string', () => {
    expect(parseContentValue('content: "Chapter "')).toBe('Chapter ');
  });

  it('parses single-quoted string', () => {
    expect(parseContentValue("content: 'hello'")).toBe('hello');
  });

  it('parses empty string', () => {
    expect(parseContentValue('content: ""')).toBe('');
  });

  it('parses unicode escape \\201C', () => {
    expect(parseContentValue('content: "\\201C"')).toBe('\u201C');
  });

  it('parses unicode escape \\2014', () => {
    expect(parseContentValue('content: "\\2014"')).toBe('\u2014');
  });

  it('concatenates multiple strings', () => {
    expect(parseContentValue('content: "foo" "bar"')).toBe('foobar');
  });

  it('extracts content from multi-property declaration', () => {
    expect(parseContentValue('color: red; content: "→"; font-size: 12px')).toBe('→');
  });

  it('strips !important', () => {
    expect(parseContentValue('content: "test" !important')).toBe('test');
  });

  it('returns undefined for unsupported functions like attr()', () => {
    expect(parseContentValue('content: attr(href)')).toBeUndefined();
  });

  it('returns undefined for unsupported counter()', () => {
    expect(parseContentValue('content: counter(chapter)')).toBeUndefined();
  });
});
