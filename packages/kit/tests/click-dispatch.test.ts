import { describe, expect, it } from 'vitest';
import { resolveInternalLinkHref } from '../src/controller/wiring/click-dispatch';

describe('resolveInternalLinkHref', () => {
  it('resolves same-document fragments against the current chapter', () => {
    expect(resolveInternalLinkHref('#section', 'OPS/text/chapter.xhtml')).toBe(
      'OPS/text/chapter.xhtml#section',
    );
  });

  it('leaves cross-document and context-free links unchanged', () => {
    expect(resolveInternalLinkHref('other.xhtml#section', 'OPS/text/chapter.xhtml')).toBe(
      'other.xhtml#section',
    );
    expect(resolveInternalLinkHref('#section', undefined)).toBe('#section');
  });
});
