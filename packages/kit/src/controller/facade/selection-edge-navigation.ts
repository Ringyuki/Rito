import type { SelectionClientPoint } from '../types';

export const SELECTION_EDGE_ZONE_PX = 48;
export const SELECTION_EDGE_DWELL_MS = 400;

export type SelectionEdgeDirection = -1 | 1;
export type SelectionEdgeNavigationOutcome = 'committed' | 'retry' | 'stop';

interface SelectionEdgeNavigationOptions {
  readonly getSurfaceRect: () => Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
  readonly getCurrentSpread: () => number;
  readonly getTotalSpreads: () => number;
  readonly navigate: (
    target: number,
    direction: SelectionEdgeDirection,
    point: SelectionClientPoint,
  ) => SelectionEdgeNavigationOutcome;
}

export interface SelectionEdgeNavigation {
  update(point: SelectionClientPoint): void;
  cancel(): void;
}

/** Dwell-driven page turns while an active selection endpoint stays at a surface edge. */
export function createSelectionEdgeNavigation(
  options: SelectionEdgeNavigationOptions,
): SelectionEdgeNavigation {
  let latestPoint: SelectionClientPoint | null = null;
  let direction: SelectionEdgeDirection | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const arm = (): void => {
    cancelTimer();
    if (!latestPoint || direction === null || targetSpread(options, direction) === null) return;
    timer = setTimeout(onDwell, SELECTION_EDGE_DWELL_MS);
  };
  function onDwell(): void {
    timer = null;
    const point = latestPoint;
    if (!point || direction === null) return;
    const currentDirection = resolveDirection(point, options.getSurfaceRect());
    if (currentDirection !== direction) {
      direction = currentDirection;
      arm();
      return;
    }
    const target = targetSpread(options, direction);
    if (target === null) return;
    const outcome = options.navigate(target, direction, point);
    if (outcome === 'retry') arm();
    else direction = null;
  }

  return {
    update(point) {
      latestPoint = point;
      const nextDirection = resolveDirection(point, options.getSurfaceRect());
      if (nextDirection === direction) return;
      direction = nextDirection;
      arm();
    },
    cancel() {
      latestPoint = null;
      direction = null;
      cancelTimer();
    },
  };
}

function targetSpread(
  options: SelectionEdgeNavigationOptions,
  direction: SelectionEdgeDirection,
): number | null {
  const target = options.getCurrentSpread() + direction;
  return target >= 0 && target < options.getTotalSpreads() ? target : null;
}

function resolveDirection(
  point: SelectionClientPoint,
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
): SelectionEdgeDirection | null {
  if (
    !Number.isFinite(point.clientX) ||
    !Number.isFinite(point.clientY) ||
    point.clientY < rect.top ||
    point.clientY > rect.bottom
  ) {
    return null;
  }
  if (point.clientX <= rect.left + SELECTION_EDGE_ZONE_PX) return -1;
  if (point.clientX >= rect.right - SELECTION_EDGE_ZONE_PX) return 1;
  return null;
}
