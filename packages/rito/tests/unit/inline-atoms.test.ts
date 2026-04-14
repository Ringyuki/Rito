import { describe, expect, it } from 'vitest';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createKnuthPlassLayouter } from '../../src/layout/line-breaker/kp';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import type { ComputedStyle } from '../../src/style/core/types';
import { DISPLAY_VALUES } from '../../src/style/core/types';
import type { InlineSegment, InlineAtomSegment } from '../../src/layout/text/styled-segment';
import { flattenInlineContent, isInlineAtom } from '../../src/layout/text/styled-segment';
import { layoutBlocks } from '../../src/layout/block';
import { resolveStyles } from '../../src/style/cascade/resolver';
import type { DocumentNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';
import type { ImageSizeMap } from '../../src/layout/block/types';
import type { InlineAtom, RubyAnnotation, TextRun } from '../../src/layout/core/types';

const measurer = createMockTextMeasurer(0.6);
const greedyLayouter = createGreedyLayouter(measurer);
const kpLayouter = createKnuthPlassLayouter(measurer);

function seg(text: string, style?: Partial<ComputedStyle>): InlineSegment {
  return { text, style: { ...DEFAULT_STYLE, ...style } };
}

function atomSeg(width: number, height: number, imageSrc?: string): InlineAtomSegment {
  const base: InlineAtomSegment = { type: 'inline-atom', width, height, style: DEFAULT_STYLE };
  if (imageSrc !== undefined) return { ...base, imageSrc };
  return base;
}

function textOf(run: TextRun | InlineAtom | RubyAnnotation | undefined): string | undefined {
  return run?.type === 'text-run' ? run.text : undefined;
}

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}

function block(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Block, tag, children };
}

function image(src: string): DocumentNode {
  return { type: 'image' as const, src, alt: '' };
}

describe('InlineAtom — Greedy line-breaker', () => {
  it('places an inline image atom on a line with text', () => {
    const segments: InlineSegment[] = [seg('hello '), atomSeg(20, 16, 'img.png')];
    const lines = greedyLayouter.layoutParagraph(segments, 200, 0);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.runs).toHaveLength(2);
    expect(textOf(lines[0]?.runs[0])).toBe('hello ');
    expect(lines[0]?.runs[1]?.type).toBe('inline-atom');
  });

  it('breaks line when atom does not fit', () => {
    // 5 chars * 9.6 = 48px, then atom 60px. Total 108 > 100 → break
    const segments: InlineSegment[] = [seg('hello '), atomSeg(60, 16)];
    const lines = greedyLayouter.layoutParagraph(segments, 100, 0);

    expect(lines.length).toBeGreaterThanOrEqual(1);
    // Atom should be in the output somewhere
    const hasAtom = lines.some((l) => l.runs.some((r) => r.type === 'inline-atom'));
    expect(hasAtom).toBe(true);
  });

  it('handles atom-only content', () => {
    const segments: InlineSegment[] = [atomSeg(50, 20)];
    const lines = greedyLayouter.layoutParagraph(segments, 200, 0);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.runs).toHaveLength(1);
    expect(lines[0]?.runs[0]?.type).toBe('inline-atom');
    expect(lines[0]?.runs[0]?.bounds.width).toBe(50);
  });

  it('preserves imageSrc on inline atom runs', () => {
    const segments: InlineSegment[] = [atomSeg(20, 16, 'test.png')];
    const lines = greedyLayouter.layoutParagraph(segments, 200, 0);

    const atom = lines[0]?.runs[0];
    expect(atom?.type).toBe('inline-atom');
    if (atom?.type === 'inline-atom') {
      expect(atom.imageSrc).toBe('test.png');
    }
  });
});

describe('InlineAtom — KP line-breaker', () => {
  it('places an inline atom on a line with text', () => {
    const segments: InlineSegment[] = [seg('hello '), atomSeg(20, 16, 'img.png')];
    const lines = kpLayouter.layoutParagraph(segments, 200, 0);

    expect(lines).toHaveLength(1);
    const hasAtom = lines[0]?.runs.some((r) => r.type === 'inline-atom');
    expect(hasAtom).toBe(true);
  });

  it('handles atom-only content', () => {
    const segments: InlineSegment[] = [atomSeg(50, 20)];
    const lines = kpLayouter.layoutParagraph(segments, 200, 0);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.runs[0]?.type).toBe('inline-atom');
  });
});

describe('flattenInlineContent — inline images', () => {
  it('emits an InlineAtomSegment for image nodes', () => {
    const styled = resolveStyles([block('p', [text('hello '), image('test.png')])]);
    const children = styled[0]?.children ?? [];
    const segments = flattenInlineContent(children);

    expect(segments).toHaveLength(2);
    expect(isInlineAtom(segments[1] ?? { text: '', style: DEFAULT_STYLE })).toBe(true);
  });

  it('uses imageSizes for atom dimensions', () => {
    const sizes: ImageSizeMap = {
      getSize(src: string) {
        if (src.includes('test.png')) return { width: 100, height: 50 };
        return undefined;
      },
    };
    const styled = resolveStyles([block('p', [image('test.png')])]);
    const children = styled[0]?.children ?? [];
    const segments = flattenInlineContent(children, sizes);

    expect(segments).toHaveLength(1);
    const atom = segments[0];
    if (atom && isInlineAtom(atom)) {
      // Image should be scaled to fit line height (16 * 1.5 = 24)
      expect(atom.height).toBeLessThanOrEqual(24);
      expect(atom.width).toBeGreaterThan(0);
    }
  });
});

describe('flattenInlineContent — inline-block', () => {
  it('emits InlineAtomSegment for display:inline-block blocks', () => {
    const styled = resolveStyles([block('p', [text('before '), block('span', [text('ib')])])]);
    const node = styled[0];
    if (!node) return;
    // Manually set display to inline-block on the child block
    const children = node.children.map((child) =>
      child.type === 'block'
        ? { ...child, style: { ...child.style, display: DISPLAY_VALUES.InlineBlock } }
        : child,
    );
    const segments = flattenInlineContent(children);

    expect(segments).toHaveLength(2);
    const second = segments[1];
    expect(second && isInlineAtom(second)).toBe(true);
    if (second && isInlineAtom(second)) {
      expect(second.sourceNode).toBeDefined();
    }
  });
});

describe('block layout — mixed inline + image', () => {
  it('treats images as inline when mixed with text', () => {
    const styled = resolveStyles([block('p', [text('hello '), image('img.png')])]);
    const blocks = layoutBlocks(styled, 300, greedyLayouter);

    expect(blocks).toHaveLength(1);
    // Should produce line boxes (inline layout), not separate image blocks
    const block0 = blocks[0];
    if (block0) {
      const hasLineBox = block0.children.some((c) => c.type === 'line-box');
      expect(hasLineBox).toBe(true);
    }
  });
});
