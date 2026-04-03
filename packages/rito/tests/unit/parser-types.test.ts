import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../../src/parser/xhtml/types.js';
import type { BlockNode, DocumentNode, TextNode } from '../../src/parser/xhtml/types.js';

describe('NODE_TYPES', () => {
  it('has expected values', () => {
    expect(NODE_TYPES.Block).toBe('block');
    expect(NODE_TYPES.Inline).toBe('inline');
    expect(NODE_TYPES.Text).toBe('text');
  });
});

describe('DocumentNode type system', () => {
  it('allows constructing a simple document tree', () => {
    const textNode: TextNode = {
      type: NODE_TYPES.Text,
      content: 'Hello, world!',
    };

    const block: BlockNode = {
      type: NODE_TYPES.Block,
      tag: 'p',
      children: [textNode],
    };

    const nodes: readonly DocumentNode[] = [block];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe('block');
  });
});
