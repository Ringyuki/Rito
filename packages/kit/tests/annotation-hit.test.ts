import { describe, expect, it } from 'vitest';
import {
  findAnnotationHitAtPos,
  getAnnotationScreenPlacement,
} from '../src/controller/wiring/annotation';
import { createCoordinatorState } from '../src/controller/core/coordinator-state';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import type { ResolvedAnnotation } from '../src/interaction';
import { annotationTarget } from './annotation-target-fixture';

describe('annotation hit projection', () => {
  it('anchors a multi-page annotation to the segment that was actually hit', () => {
    const state = createCoordinatorState();
    const annotation = resolvedAnnotation();
    state.resolvedAnnotations = [annotation];
    state.mapper = {
      spreadContentToPage: () => ({ pageIndex: 1, x: 15, y: 25 }),
      pageContentToScreen: (
        pageIndex: number,
        rect: { x: number; y: number; width: number; height: number },
      ) => ({ ...rect, x: pageIndex * 1_000 + rect.x }),
    } as never;
    const deps = {
      coordState: state,
      reader: { interactions: { enabled: true } },
    } as unknown as WiringDeps;

    const hit = findAnnotationHitAtPos({ x: 0, y: 0 }, deps);
    expect(hit?.segment.pageIndex).toBe(1);
    expect(
      hit &&
        getAnnotationScreenPlacement(
          hit,
          { getBoundingClientRect: () => ({}) } as HTMLCanvasElement,
          deps,
        ),
    ).toEqual({ x: 1_015, y: 20, screenBounds: { x: 1_010, y: 20, width: 10, height: 10 } });
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
    const deps = {
      coordState: state,
      reader: { interactions: { enabled: true } },
    } as unknown as WiringDeps;

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
      target: annotationTarget('ab'),
    },
    status: 'exact',
    segments: [
      {
        pageIndex: 0,
        rects: [{ x: 100, y: 200, width: 80, height: 20 }],
      },
      {
        pageIndex: 1,
        rects: [{ x: 10, y: 20, width: 10, height: 10 }],
      },
    ],
  };
}
