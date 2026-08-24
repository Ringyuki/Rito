import { describe, expect, it } from 'vitest';
import type {
  BlockNode,
  DocumentNode,
  InlineNode,
  TextNode,
} from '../../src/reference/ts-core/parser/xhtml/types';
import { NODE_TYPES } from '../../src/reference/ts-core/parser/xhtml/types';
import { resolveStyles } from '../../src/reference/ts-core/style/cascade/resolver';
import { DEFAULT_UA_RULES } from '../../src/reference/ts-core/style/ua/default-rules';

function text(content: string): TextNode {
  return { type: NODE_TYPES.Text, content };
}

function inline(tag: string, children: DocumentNode[]): InlineNode {
  return { type: NODE_TYPES.Inline, tag, children };
}

function block(tag: string, children: DocumentNode[]): BlockNode {
  return { type: NODE_TYPES.Block, tag, children };
}

describe('default UA stylesheet', () => {
  it('parses internal rules as user-agent origin', () => {
    expect(DEFAULT_UA_RULES.length).toBeGreaterThan(0);
    expect(DEFAULT_UA_RULES.every((rule) => rule.origin === 'ua')).toBe(true);
  });

  it('applies browser-like heading defaults through the cascade', () => {
    const result = resolveStyles([block('h1', [text('Title')])]);

    expect(result[0]?.style.fontSize).toBe(32);
    expect(result[0]?.style.fontWeight).toBe(700);
    expect(result[0]?.style.marginTop).toBeCloseTo(21.44);
    expect(result[0]?.style.marginBottom).toBeCloseTo(21.44);
  });

  it('applies inline emphasis defaults through grouped selectors', () => {
    const result = resolveStyles([
      block('p', [inline('em', [text('italic')]), inline('b', [text('bold')])]),
    ]);

    expect(result[0]?.children[0]?.style.fontStyle).toBe('italic');
    expect(result[0]?.children[1]?.style.fontWeight).toBe(700);
  });

  it('applies sup and sub defaults through the UA stylesheet', () => {
    const result = resolveStyles([
      block('p', [inline('sup', [text('1')]), inline('sub', [text('2')])]),
    ]);

    expect(result[0]?.children[0]?.style.verticalAlign).toBe('super');
    expect(result[0]?.children[0]?.style.fontSize).toBeCloseTo(13.328);
    expect(result[0]?.children[1]?.style.verticalAlign).toBe('sub');
    expect(result[0]?.children[1]?.style.fontSize).toBeCloseTo(13.328);
  });
});
