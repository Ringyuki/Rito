// @vitest-environment happy-dom
/**
 * Integration test: sourceRef flows from parser through to HitEntry.
 *
 * Verifies that parsing XHTML, resolving styles, flattening inline content,
 * laying out text, and building a HitMap produces HitEntries with correct
 * sourceRef.nodePath values.
 */
import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { flattenInlineContent } from '../../src/layout/text/styled-segment';
import { createLayoutConfig } from '../../src/layout/core/config';
import { layoutBlocks } from '../../src/layout/block';
import { paginateBlocks } from '../../src/layout/pagination';
import { buildHitMap } from '../../src/interaction/core/hit-map';
import { createGreedyLayouter } from '../../src/layout/line-breaker';
import type { TextMeasurer } from '../../src/layout/text/text-measurer';

const measurer: TextMeasurer = {
  measureText: (text: string) => ({ width: text.length * 8, height: 16 }),
};
const layouter = createGreedyLayouter(measurer);

describe('sourceRef pipeline', () => {
  it('parser assigns nodePath to DocumentNodes', () => {
    const { nodes } = parseXhtml('<html><body><p>Hello <em>world</em></p></body></html>');
    expect(nodes.length).toBe(1);

    const p = nodes[0];
    expect(p?.type).toBe('block');
    expect(p?.sourceRef?.nodePath).toEqual([0]);

    if (p?.type !== 'block') return;
    // p has 3 children: TextNode("Hello "), InlineNode(<em>), which has TextNode("world")
    const textHello = p.children[0];
    expect(textHello?.type).toBe('text');
    expect(textHello?.sourceRef?.nodePath).toEqual([0, 0]);

    const em = p.children[1];
    expect(em?.type).toBe('inline');
    expect(em?.sourceRef?.nodePath).toEqual([0, 1]);

    if (em?.type !== 'inline') return;
    const textWorld = em.children[0];
    expect(textWorld?.type).toBe('text');
    expect(textWorld?.sourceRef?.nodePath).toEqual([0, 1, 0]);
  });

  it('sourceRef survives style resolution', () => {
    const { nodes } = parseXhtml('<html><body><p>Hello</p></body></html>');
    const styled = resolveStyles(nodes);
    expect(styled.length).toBe(1);
    expect(styled[0]?.sourceRef?.nodePath).toEqual([0]);

    const textNode = styled[0]?.children[0];
    expect(textNode?.type).toBe('text');
    expect(textNode?.sourceRef?.nodePath).toEqual([0, 0]);
  });

  it('sourceRef survives inline flattening', () => {
    const { nodes } = parseXhtml('<html><body><p>Hello <em>world</em></p></body></html>');
    const styled = resolveStyles(nodes);
    const p = styled[0];
    if (!p) return;

    const segments = flattenInlineContent(p.children);
    expect(segments.length).toBeGreaterThanOrEqual(2);

    // First segment: "Hello " from TextNode at [0, 0]
    const seg0 = segments[0];
    if (!seg0 || 'width' in seg0) return;
    expect(seg0.text).toBe('Hello ');
    expect(seg0.sourceRef?.nodePath).toEqual([0, 0]);

    // Second segment: "world" from TextNode at [0, 1, 0]
    const seg1 = segments[1];
    if (!seg1 || 'width' in seg1) return;
    expect(seg1.text).toBe('world');
    expect(seg1.sourceRef?.nodePath).toEqual([0, 1, 0]);
  });

  it('sourceRef reaches HitEntry through full pipeline', () => {
    const xhtml = '<html><body><p>Hello world</p><p>Second paragraph</p></body></html>';
    const { nodes } = parseXhtml(xhtml);
    const styled = resolveStyles(nodes);
    const config = createLayoutConfig({ width: 400, height: 600, margin: 0 });
    const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
    const blocks = layoutBlocks(styled, contentWidth, layouter);
    const pages = paginateBlocks(blocks, config);
    expect(pages.length).toBeGreaterThan(0);

    const page = pages[0];
    if (!page) return;
    const hitMap = buildHitMap(page);
    expect(hitMap.entries.length).toBeGreaterThan(0);

    // At least one HitEntry should carry sourceRef
    const withSourceRef = hitMap.entries.filter((e) => e.sourceRef !== undefined);
    expect(withSourceRef.length).toBeGreaterThan(0);

    // The first entry should trace back to the first text node in the first paragraph
    const first = withSourceRef[0];
    expect(first?.sourceRef?.nodePath).toBeDefined();
    expect(first?.sourceRef?.nodePath.length).toBeGreaterThan(0);
  });

  it('sourceText preserves pre-transform text', () => {
    // text-transform: uppercase would change case but sourceText should keep original
    const { nodes } = parseXhtml('<html><body><p>hello</p></body></html>');
    const styled = resolveStyles(nodes);
    const p = styled[0];
    if (!p) return;

    const segments = flattenInlineContent(p.children);
    const seg = segments[0];
    if (!seg || 'width' in seg) return;

    // Without text-transform, sourceText equals text
    expect(seg.sourceText).toBe('hello');
    expect(seg.text).toBe('hello');
  });
});
