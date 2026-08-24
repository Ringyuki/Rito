import { describe, expect, it } from 'vitest';
import {
  findAnnotationHitAtPos,
  getAnnotationScreenCenter,
} from '../src/controller/wiring/annotation';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import type { ResolvedAnnotation } from '../src/interaction';

describe('annotation hit projection', () => {
  it('anchors a multi-page annotation to the segment that was actually hit', () => {
    const state = createCoordinatorState();
    const annotation = resolvedAnnotation();
    state.resolvedAnnotations = [annotation];
    state.mapper = {
      spreadContentToPage: () => ({ pageIndex: 1, x: 15, y: 25 }),
      pageContentToScreen: (pageIndex: number, rect: { x: number; y: number }) => ({
        x: pageIndex * 1_000 + rect.x,
        y: rect.y,
        width: 0,
        height: 0,
      }),
    } as never;
    const deps = { coordState: state, reader: {} } as unknown as WiringDeps;

    const hit = findAnnotationHitAtPos({ x: 0, y: 0 }, deps);
    expect(hit?.segment.pageIndex).toBe(1);
    expect(
      hit &&
        getAnnotationScreenCenter(
          hit.annotation,
          { getBoundingClientRect: () => ({}) } as HTMLCanvasElement,
          deps,
          hit.segment,
        ),
    ).toEqual({ x: 1_015, y: 20 });
  });

  it('does not fall back to installed geometry while native interactions are disabled', () => {
    const state = createCoordinatorState();
    state.resolvedAnnotations = [resolvedAnnotation()];
    state.mapper = {
      spreadContentToPage: () => ({ pageIndex: 1, x: 15, y: 25 }),
    } as never;
    const deps = {
      coordState: state,
      reader: {
        interactions: {
          enabled: false,
          resolveExactSourceRange: () => Promise.resolve(undefined),
        },
      },
    } as unknown as WiringDeps;

    expect(findAnnotationHitAtPos({ x: 0, y: 0 }, deps)).toBeUndefined();
  });

  it('hits the last-painted annotation when annotation rectangles overlap', () => {
    const state = createCoordinatorState();
    const lower = resolvedAnnotation();
    const upperBase = resolvedAnnotation();
    const upper = {
      ...upperBase,
      id: 'upper',
      record: { ...upperBase.record, id: 'upper' },
    };
    state.resolvedAnnotations = [lower, upper];
    state.mapper = {
      spreadContentToPage: () => ({ pageIndex: 1, x: 15, y: 25 }),
    } as never;
    const deps = { coordState: state, reader: {} } as unknown as WiringDeps;

    expect(findAnnotationHitAtPos({ x: 0, y: 0 }, deps)?.annotation.id).toBe('upper');
  });
});

function resolvedAnnotation(): ResolvedAnnotation {
  return {
    id: 'annotation',
    record: {
      id: 'annotation',
      kind: 'highlight',
      createdAt: 1,
      target: {
        href: 'chapter.xhtml',
        selectors: {
          sourceRange: {
            type: 'SourceRangeSelector',
            start: { nodePath: [0], textOffset: 0 },
            end: { nodePath: [0], textOffset: 2 },
          },
          textQuote: { type: 'TextQuoteSelector', exact: 'ab' },
          textPosition: { type: 'TextPositionSelector', start: 0, end: 2 },
          progression: { type: 'ProgressionSelector', chapter: 0, chapterProgress: 0 },
        },
        text: { highlight: 'ab' },
      },
    },
    status: 'exact',
    segments: [
      {
        pageIndex: 0,
        range: null,
        rects: [{ x: 100, y: 200, width: 80, height: 20 }],
      },
      {
        pageIndex: 1,
        range: null,
        rects: [{ x: 10, y: 20, width: 10, height: 10 }],
      },
    ],
  };
}
