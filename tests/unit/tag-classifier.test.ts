import { describe, expect, it } from 'vitest';
import { classifyTag } from '../../src/parser/xhtml/tag-classifier';

describe('classifyTag', () => {
  it('classifies block-level elements', () => {
    expect(classifyTag('p')).toBe('block');
    expect(classifyTag('div')).toBe('block');
    expect(classifyTag('h1')).toBe('block');
    expect(classifyTag('h6')).toBe('block');
    expect(classifyTag('blockquote')).toBe('block');
    expect(classifyTag('ul')).toBe('block');
    expect(classifyTag('ol')).toBe('block');
    expect(classifyTag('li')).toBe('block');
    expect(classifyTag('section')).toBe('block');
    expect(classifyTag('article')).toBe('block');
    expect(classifyTag('pre')).toBe('block');
    expect(classifyTag('header')).toBe('block');
    expect(classifyTag('footer')).toBe('block');
  });

  it('classifies inline elements', () => {
    expect(classifyTag('span')).toBe('inline');
    expect(classifyTag('em')).toBe('inline');
    expect(classifyTag('strong')).toBe('inline');
    expect(classifyTag('a')).toBe('inline');
    expect(classifyTag('code')).toBe('inline');
    expect(classifyTag('b')).toBe('inline');
    expect(classifyTag('i')).toBe('inline');
  });

  it('classifies ignored elements', () => {
    expect(classifyTag('script')).toBe('ignored');
    expect(classifyTag('style')).toBe('ignored');
    expect(classifyTag('svg')).toBe('ignored');
    expect(classifyTag('video')).toBe('ignored');
    expect(classifyTag('audio')).toBe('ignored');
  });

  it('treats unknown elements as inline', () => {
    expect(classifyTag('custom-element')).toBe('inline');
    expect(classifyTag('x-foo')).toBe('inline');
  });

  it('is case-insensitive', () => {
    expect(classifyTag('P')).toBe('block');
    expect(classifyTag('DIV')).toBe('block');
    expect(classifyTag('SPAN')).toBe('inline');
    expect(classifyTag('IMG')).toBe('inline');
  });
});
