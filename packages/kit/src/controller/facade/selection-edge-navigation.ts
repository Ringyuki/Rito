import type { SelectionClientPoint } from '../types';

export const SELECTION_EDGE_ZONE_PX = 48;
export const SELECTION_EDGE_DWELL_MS = 400;

export type SelectionEdgeDirection = -1 | 1;
export type SelectionEdgeNavigationOutcome = 'committed' | 'retry' | 'stop';
type SelectionEdgeNavigationResult =
  | SelectionEdgeNavigationOutcome
  | Promise<SelectionEdgeNavigationOutcome>;

interface SelectionEdgeNavigationOptions {
  readonly getSurfaceRect: () => Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
  readonly getCurrentSpread: () => number;
  readonly getTotalSpreads: () => number;
  readonly canGrowForward?: (() => boolean) | undefined;
  readonly navigate: (
    target: number,
    direction: SelectionEdgeDirection,
    point: SelectionClientPoint,
    signal: AbortSignal,
  ) => SelectionEdgeNavigationResult;
}

export interface SelectionEdgeNavigation {
  update(point: SelectionClientPoint): void;
  cancel(): void;
}

/** Dwell-driven page turns while an active selection endpoint stays at a surface edge. */
export function createSelectionEdgeNavigation(
  options: SelectionEdgeNavigationOptions,
): SelectionEdgeNavigation {
  return new SelectionEdgeNavigationController(options);
}

class SelectionEdgeNavigationController implements SelectionEdgeNavigation {
  private latestPoint: SelectionClientPoint | null = null;
  private direction: SelectionEdgeDirection | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: AbortController | null = null;

  constructor(private readonly options: SelectionEdgeNavigationOptions) {}

  update(point: SelectionClientPoint): void {
    this.latestPoint = point;
    const nextDirection = resolveSelectionEdgeDirection(point, this.options.getSurfaceRect());
    if (nextDirection === this.direction) return;
    this.pending?.abort();
    this.pending = null;
    this.direction = nextDirection;
    this.arm();
  }

  cancel(): void {
    this.latestPoint = null;
    this.direction = null;
    this.cancelTimer();
    this.pending?.abort();
    this.pending = null;
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(): void {
    this.cancelTimer();
    if (
      this.pending ||
      !this.latestPoint ||
      this.direction === null ||
      targetSpread(this.options, this.direction) === null
    )
      return;
    this.timer = setTimeout(() => {
      this.onDwell();
    }, SELECTION_EDGE_DWELL_MS);
  }

  private onDwell(): void {
    this.timer = null;
    const point = this.latestPoint;
    if (!point || this.direction === null) return;
    const currentDirection = resolveSelectionEdgeDirection(point, this.options.getSurfaceRect());
    if (currentDirection !== this.direction) {
      this.direction = currentDirection;
      this.arm();
      return;
    }
    const target = targetSpread(this.options, this.direction);
    if (target === null) return;
    const abort = new AbortController();
    this.pending = abort;
    let outcome: SelectionEdgeNavigationResult;
    try {
      outcome = this.options.navigate(target, this.direction, point, abort.signal);
    } catch {
      this.settleSynchronous(abort, 'stop');
      return;
    }
    if (isPromise(outcome)) {
      void outcome.then(
        (settled) => {
          this.settlePending(abort, settled);
        },
        () => {
          this.settlePending(abort, 'stop');
        },
      );
      return;
    }
    this.settleSynchronous(abort, outcome);
  }

  private settleSynchronous(abort: AbortController, outcome: SelectionEdgeNavigationOutcome): void {
    if (this.pending !== abort) return;
    this.pending = null;
    if (abort.signal.aborted) return;
    if (outcome === 'retry' || outcome === 'committed') this.arm();
    else this.direction = null;
  }

  private settlePending(abort: AbortController, outcome: SelectionEdgeNavigationOutcome): void {
    if (this.pending !== abort) return;
    this.pending = null;
    if (abort.signal.aborted) return;
    if (outcome === 'retry') this.onDwell();
    else if (outcome === 'committed') this.arm();
    else this.direction = null;
  }
}

function targetSpread(
  options: SelectionEdgeNavigationOptions,
  direction: SelectionEdgeDirection,
): number | null {
  const target = options.getCurrentSpread() + direction;
  if (target < 0) return null;
  const total = options.getTotalSpreads();
  if (target < total) return target;
  return direction === 1 && target === total && options.canGrowForward?.() === true ? target : null;
}

function isPromise(
  value: SelectionEdgeNavigationResult,
): value is Promise<SelectionEdgeNavigationOutcome> {
  return typeof (value as Promise<SelectionEdgeNavigationOutcome>).then === 'function';
}

/** Resolve the active horizontal edge zone for one finite client-space sample. */
export function resolveSelectionEdgeDirection(
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
