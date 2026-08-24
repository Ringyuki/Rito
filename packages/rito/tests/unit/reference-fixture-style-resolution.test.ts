import { describe, expect, it } from 'vitest';
import {
  createFixtureChapterStyleContext,
  resolveFixtureChapterStyleTree,
} from '../../src/reference/fixture-style-resolution';
import { createLayoutConfig } from '../../src/reference/ts-core/layout/core/config';
import { parseXhtml } from '../../src/reference/ts-core/parser/xhtml/xhtml-parser';
import type { StyledNode } from '../../src/reference/ts-core/style/core/types';

function chapter(head: string, body: string): string {
  return `<?xml version="1.0"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head>${head}</head><body class="reader">${body}</body>
    </html>`;
}

function requireTag(nodes: readonly StyledNode[], tag: string): StyledNode {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const child = findTag(node.children, tag);
    if (child) return child;
  }
  throw new Error(`Missing styled <${tag}> node`);
}

function findTag(nodes: readonly StyledNode[], tag: string): StyledNode | undefined {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const child = findTag(node.children, tag);
    if (child) return child;
  }
  return undefined;
}

describe('reference fixture chapter style resolution', () => {
  it('shares pagination root, ancestor, embedded CSS, and missing-link semantics', () => {
    const parsed = parseXhtml(chapter('<style>p { letter-spacing: 2px; }</style>', '<p>Hello</p>'));
    const config = createLayoutConfig({ width: 400, height: 300, rootFontSize: 30 });
    const stylesheets = new Map([
      [
        'book.css',
        `html { font-size: 20px; }
         body.reader { font-size: 2rem; }
         html body.reader > p { color: #123456; font-size: 1rem; }`,
      ],
    ]);
    const context = createFixtureChapterStyleContext(stylesheets, config.rootFontSize);

    const absentLinks = resolveFixtureChapterStyleTree(parsed, config, context);
    const absentLinksParagraph = requireTag(absentLinks.styled, 'p');
    expect(absentLinksParagraph.style.fontSize).toBe(20);
    expect(absentLinksParagraph.style.color).toBe('#123456');
    expect(absentLinksParagraph.style.letterSpacing).toBe(2);

    const explicitEmptyLinks = resolveFixtureChapterStyleTree(
      { ...parsed, stylesheetHrefs: [] },
      config,
      context,
    );
    const explicitEmptyParagraph = requireTag(explicitEmptyLinks.styled, 'p');
    expect(explicitEmptyParagraph.style.fontSize).toBe(30);
    expect(explicitEmptyParagraph.style.color).toBe('#000000');
    expect(explicitEmptyParagraph.style.letterSpacing).toBe(2);
  });

  it('applies body cascade once and honors forced typography overrides', () => {
    const parsed = parseXhtml(chapter('', '<p>Hello</p>'));
    const config = createLayoutConfig({
      width: 400,
      height: 300,
      lineHeightOverride: 1.6,
      lineHeightForce: true,
      fontFamilyOverride: 'Fixture Reader',
      fontFamilyForce: true,
    });
    const stylesheets = new Map([
      [
        'book.css',
        'body.reader { font-size: 22px; } body { font-size: 40px; } p { line-height: 30px; }',
      ],
    ]);
    const context = createFixtureChapterStyleContext(stylesheets, config.rootFontSize);

    const resolved = resolveFixtureChapterStyleTree(parsed, config, context);
    const paragraph = requireTag(resolved.styled, 'p');
    expect(paragraph.style.fontSize).toBe(22);
    expect(paragraph.style.lineHeight).toBe(1.6);
    expect(paragraph.style.lineHeightPx).toBeUndefined();
    expect(paragraph.style.fontFamily).toBe('Fixture Reader');
  });
});
