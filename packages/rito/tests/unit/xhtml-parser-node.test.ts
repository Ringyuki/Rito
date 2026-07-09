import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';

describe('parseXhtml in Node', () => {
  it('does not require browser DOMParser or Node globals', () => {
    const parsed = parseXhtml(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello</p></body></html>',
    );

    expect(parsed.nodes[0]).toMatchObject({ type: 'block', tag: 'p' });
  });
});
