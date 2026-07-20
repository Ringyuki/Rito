import type { Reader } from '@ritojs/core';
import type { FrameDriver } from '../driver/frame-driver';
import type { ContentRenderer, PageBufferPool } from '../painter/buffer-pool';
import type { Internals } from './core/internals';
import type { Emitter } from './facade/types';
import type { PrerenderScheduler } from './prerender';

type TransitionDirection = 'forward' | 'backward';

export interface ProvisionalTransitionRuntime {
  begin(direction: TransitionDirection): void;
  visualSettled(direction: TransitionDirection): void;
  reopenVisual(ownerDirection: TransitionDirection, direction: TransitionDirection): boolean;
  complete(direction: TransitionDirection): void;
  cancel(direction: TransitionDirection): void;
  deferForLayout(direction: TransitionDirection): (() => void) | undefined;
}

interface ActiveProvisionalTransition {
  readonly ownerDirection: TransitionDirection;
  openVisualDirection: TransitionDirection | undefined;
}

class ProvisionalTransitionState implements ProvisionalTransitionRuntime {
  private active: ActiveProvisionalTransition | undefined;

  constructor(
    private readonly prerenderScheduler: PrerenderScheduler,
    private readonly onVisualSettled: (direction: TransitionDirection) => void,
    private readonly onComplete: (openVisualDirection: TransitionDirection | undefined) => void,
  ) {}

  begin(direction: TransitionDirection): void {
    if (this.active !== undefined) {
      throw new Error('A provisional transition is already logically active');
    }
    this.active = { ownerDirection: direction, openVisualDirection: direction };
    this.prerenderScheduler.pause();
  }

  visualSettled(direction: TransitionDirection): void {
    if (this.active?.openVisualDirection !== direction) return;
    this.active.openVisualDirection = undefined;
    this.onVisualSettled(direction);
  }

  reopenVisual(ownerDirection: TransitionDirection, direction: TransitionDirection): boolean {
    if (
      this.active?.ownerDirection !== ownerDirection ||
      this.active.openVisualDirection !== undefined
    ) {
      return false;
    }
    this.active.openVisualDirection = direction;
    return true;
  }

  complete(direction: TransitionDirection): void {
    const released = this.release(direction);
    if (released) this.onComplete(released.openVisualDirection);
  }

  cancel(direction: TransitionDirection): void {
    this.release(direction);
  }

  deferForLayout(direction: TransitionDirection): (() => void) | undefined {
    const released = this.take(direction);
    if (!released) return undefined;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.prerenderScheduler.resume();
      this.onComplete(released.openVisualDirection);
    };
  }

  private take(direction: TransitionDirection): ActiveProvisionalTransition | undefined {
    if (this.active?.ownerDirection !== direction) return undefined;
    const released = this.active;
    this.active = undefined;
    return released;
  }

  private release(direction: TransitionDirection): ActiveProvisionalTransition | undefined {
    const released = this.take(direction);
    if (!released) return undefined;
    this.prerenderScheduler.resume();
    return released;
  }
}

interface ProvisionalCompletion {
  readonly internals: Internals;
  readonly emitter: Emitter;
  readonly frameDriver: FrameDriver;
  readonly reader: Reader;
  readonly pool: PageBufferPool;
  readonly contentRenderer: ContentRenderer;
  readonly prerenderScheduler: PrerenderScheduler;
  readonly isAnimating: () => boolean;
}

export function createProvisionalTransitionRuntime(
  internals: Internals,
  emitter: Emitter,
  frameDriver: FrameDriver,
  reader: Reader,
  pool: PageBufferPool,
  contentRenderer: ContentRenderer,
  prerenderScheduler: PrerenderScheduler,
  isAnimating: () => boolean,
): ProvisionalTransitionRuntime {
  const completion = {
    internals,
    emitter,
    frameDriver,
    reader,
    pool,
    contentRenderer,
    prerenderScheduler,
    isAnimating,
  };
  return new ProvisionalTransitionState(
    prerenderScheduler,
    (direction) => {
      settleProvisionalVisual(direction, completion);
    },
    (openVisualDirection) => {
      completeProvisionalRuntime(openVisualDirection, completion);
    },
  );
}

function completeProvisionalRuntime(
  openVisualDirection: TransitionDirection | undefined,
  completion: ProvisionalCompletion,
): void {
  completion.prerenderScheduler.schedule({
    getCurrentSpread: () => completion.internals.currentSpread,
    isAnimating: completion.isAnimating,
    reader: completion.reader,
    pool: completion.pool,
    contentRenderer: completion.contentRenderer,
  });
  try {
    completion.frameDriver.compositeNow();
  } finally {
    try {
      if (openVisualDirection) {
        completion.emitter.emit('transitionEnd', { direction: openVisualDirection });
      }
    } finally {
      completion.frameDriver.scheduleComposite();
    }
  }
}

function settleProvisionalVisual(
  direction: TransitionDirection,
  completion: ProvisionalCompletion,
): void {
  try {
    completion.frameDriver.compositeNow();
  } finally {
    try {
      completion.emitter.emit('transitionEnd', { direction });
    } finally {
      completion.frameDriver.scheduleComposite();
    }
  }
}
