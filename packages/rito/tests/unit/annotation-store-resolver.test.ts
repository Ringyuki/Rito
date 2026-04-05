// @vitest-environment happy-dom
/**
 * Phase 3 tests: AnnotationStore + AnnotationResolver.
 */
import { describe, expect, it } from 'vitest';
import { createAnnotationStore } from '../../src/interaction/annotations/store';
import { resolveAnnotations } from '../../src/interaction/annotations/resolver';
import type { ResolutionContext } from '../../src/interaction/annotations/resolver';
import type { AnnotationDraft } from '../../src/interaction/annotations/model';
import type { AnnotationTarget } from '../../src/interaction/anchors/model';
import { buildChapterTextIndex } from '../../src/interaction/anchors/chapter-text-index';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { createLayoutConfig } from '../../src/layout/core/config';
import { layoutBlocks } from '../../src/layout/block';
import { paginateBlocks } from '../../src/layout/pagination';
import { buildHitMap } from '../../src/interaction/core/hit-map';
import { createGreedyLayouter } from '../../src/layout/line-breaker';
import type { TextMeasurer } from '../../src/layout/text/text-measurer';
import type { HitMap } from '../../src/interaction/core/types';

const measurer: TextMeasurer = {
  measureText: (text: string) => ({ width: text.length * 8, height: 16 }),
};

function makeTarget(href: string, highlight: string): AnnotationTarget {
  return {
    href,
    selectors: {
      sourceRange: {
        type: 'SourceRangeSelector',
        start: { nodePath: [0, 0], textOffset: 0 },
        end: { nodePath: [0, 0], textOffset: highlight.length },
      },
      textQuote: { type: 'TextQuoteSelector', exact: highlight },
      textPosition: { type: 'TextPositionSelector', start: 0, end: highlight.length },
      progression: { type: 'ProgressionSelector', chapter: 0, chapterProgress: 0 },
    },
    text: { highlight },
  };
}

describe('AnnotationStore', () => {
  it('add returns a record with id and createdAt', () => {
    const store = createAnnotationStore();
    const draft: AnnotationDraft = {
      kind: 'highlight',
      target: makeTarget('ch1.xhtml', 'Hello'),
      color: 'yellow',
    };
    const record = store.add(draft);
    expect(record.id).toBeDefined();
    expect(record.kind).toBe('highlight');
    expect(record.target.href).toBe('ch1.xhtml');
    expect(record.createdAt).toBeGreaterThan(0);
  });

  it('getAll returns all added records', () => {
    const store = createAnnotationStore();
    store.add({ kind: 'highlight', target: makeTarget('ch1.xhtml', 'A') });
    store.add({ kind: 'note', target: makeTarget('ch2.xhtml', 'B') });
    expect(store.getAll().length).toBe(2);
  });

  it('getForHref filters by chapter', () => {
    const store = createAnnotationStore();
    store.add({ kind: 'highlight', target: makeTarget('ch1.xhtml', 'A') });
    store.add({ kind: 'highlight', target: makeTarget('ch2.xhtml', 'B') });
    store.add({ kind: 'highlight', target: makeTarget('ch1.xhtml', 'C') });
    expect(store.getForHref('ch1.xhtml').length).toBe(2);
    expect(store.getForHref('ch2.xhtml').length).toBe(1);
  });

  it('remove and update work', () => {
    const store = createAnnotationStore();
    const r = store.add({ kind: 'highlight', target: makeTarget('ch1.xhtml', 'A') });
    expect(store.update(r.id, { color: 'blue' })).toBe(true);
    expect(store.getAll()[0]?.color).toBe('blue');
    expect(store.remove(r.id)).toBe(true);
    expect(store.getAll().length).toBe(0);
  });

  it('onChange fires on add/remove', () => {
    const store = createAnnotationStore();
    const calls: number[] = [];
    store.onChange((records) => calls.push(records.length));
    store.add({ kind: 'highlight', target: makeTarget('ch1.xhtml', 'A') });
    store.add({ kind: 'highlight', target: makeTarget('ch1.xhtml', 'B') });
    expect(calls).toEqual([1, 2]);
  });
});

describe('AnnotationResolver', () => {
  function buildContext(): { context: ResolutionContext; href: string } {
    const xhtml = '<html><body><p>Hello world</p></body></html>';
    const { nodes } = parseXhtml(xhtml);
    const href = 'ch1.xhtml';
    const chapterIndex = buildChapterTextIndex(href, nodes);

    const styled = resolveStyles(nodes);
    const config = createLayoutConfig({ width: 400, height: 600, margin: 0 });
    const layouter = createGreedyLayouter(measurer);
    const contentWidth = config.pageWidth;
    const blocks = layoutBlocks(styled, contentWidth, layouter);
    const pages = paginateBlocks(blocks, config);

    const hitMaps = new Map<number, HitMap>();
    for (const page of pages) {
      hitMaps.set(page.index, buildHitMap(page));
    }

    return {
      href,
      context: {
        chapterIndices: new Map([[href, chapterIndex]]),
        hitMaps,
        chapterPageRanges: new Map([[href, { startPage: 0, endPage: pages.length - 1 }]]),
        measurer,
      },
    };
  }

  it('resolves a record with SourceRangeSelector as exact', () => {
    const { context, href } = buildContext();
    const chapterIndex = context.chapterIndices.get(href);
    expect(chapterIndex).toBeDefined();

    // Target "Hello" — first 5 chars
    const target = makeTarget(href, 'Hello');
    const store = createAnnotationStore();
    const record = store.add({ kind: 'highlight', target });

    const resolved = resolveAnnotations([record], context);
    expect(resolved.length).toBe(1);

    const r = resolved[0];
    expect(r).toBeDefined();
    // Should resolve via some selector path
    expect(r?.status).not.toBe('orphaned');
    expect(r?.segments.length).toBeGreaterThan(0);
  });

  it('resolves via TextQuoteSelector when sourceRange fails', () => {
    const { context, href } = buildContext();
    const chapterIndex = context.chapterIndices.get(href);
    expect(chapterIndex).toBeDefined();

    // Create a target with an invalid sourceRange but valid textQuote
    const target: AnnotationTarget = {
      href,
      selectors: {
        sourceRange: {
          type: 'SourceRangeSelector',
          start: { nodePath: [99, 99], textOffset: 0 }, // invalid path
          end: { nodePath: [99, 99], textOffset: 5 },
        },
        textQuote: { type: 'TextQuoteSelector', exact: 'world' },
        textPosition: { type: 'TextPositionSelector', start: 6, end: 11 },
        progression: { type: 'ProgressionSelector', chapter: 0, chapterProgress: 0.5 },
      },
      text: { highlight: 'world' },
    };

    const store = createAnnotationStore();
    const record = store.add({ kind: 'highlight', target });
    const resolved = resolveAnnotations([record], context);

    expect(resolved.length).toBe(1);
    const r = resolved[0];
    expect(r?.status).toBe('quote-fallback');
    expect(r?.segments.length).toBeGreaterThan(0);
  });

  it('marks orphaned when nothing resolves', () => {
    const { context } = buildContext();
    const target: AnnotationTarget = {
      href: 'nonexistent.xhtml',
      selectors: {
        sourceRange: {
          type: 'SourceRangeSelector',
          start: { nodePath: [0], textOffset: 0 },
          end: { nodePath: [0], textOffset: 5 },
        },
        textQuote: { type: 'TextQuoteSelector', exact: 'nonexistent text xyz' },
        textPosition: { type: 'TextPositionSelector', start: 0, end: 5 },
        progression: { type: 'ProgressionSelector', chapter: 99, chapterProgress: 0 },
      },
      text: { highlight: 'nonexistent' },
    };

    const store = createAnnotationStore();
    const record = store.add({ kind: 'highlight', target });
    const resolved = resolveAnnotations([record], context);
    expect(resolved[0]?.status).toBe('orphaned');
  });
});
