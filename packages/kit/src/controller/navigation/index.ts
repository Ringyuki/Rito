import type { Reader, TocEntry } from '@ritojs/core';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { FrameDriver } from '../../driver/frame-driver';
import type { PageBufferPool, ContentRenderer } from '../../painter/buffer-pool';
import type { ReaderControllerEvents } from '../types';

export interface NavigationDeps {
  getReader: () => Reader | null;
  getCurrentSpread: () => number;
  setCurrentSpread: (index: number) => void;
  getRenderScale: () => number;
  emitter: TypedEmitter<ReaderControllerEvents>;
  td: TransitionDriver;
  frameDriver: FrameDriver;
  pool: PageBufferPool;
  contentRenderer: ContentRenderer;
}

export interface NavigationActions {
  goToSpread(index: number): void;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;
}

export function createNavigation(deps: NavigationDeps): NavigationActions {
  const goTo = (index: number): void => {
    const reader = deps.getReader();
    if (!reader) return;
    const clamped = Math.max(0, Math.min(index, reader.totalSpreads - 1));
    let prev = deps.getCurrentSpread();
    if (clamped === prev) return;

    // If a transition is in progress, force-complete it and compute a visual-continuity offset.
    let continuityDx = 0;
    if (deps.td.isAnimating) {
      const residualDx = deps.td.forceSettle();
      prev = deps.getCurrentSpread();
      if (clamped === prev) return;
      // The old incoming was at (residualDx ± W). After rotation it's now curr.
      // Start the new animation from that visual position for smooth handoff.
      const W = deps.td.viewportWidth;
      continuityDx = residualDx > 0 ? residualDx - W : residualDx + W;
    }

    const dir = clamped > prev ? 'forward' : 'backward';

    // Update currentSpread IMMEDIATELY so subsequent goTo calls use the new base
    deps.setCurrentSpread(clamped);

    // Ensure incoming slot has the target spread. Reuse if prerender already filled it.
    const slotPos = dir === 'forward' ? 'next' : 'prev';
    const existing = deps.pool.getSlotFor(clamped);
    if (existing !== slotPos) {
      deps.pool.assignSlot(slotPos, clamped);
    }
    deps.pool.ensureContent(slotPos, deps.contentRenderer);

    // Emit spreadChange immediately so React state updates
    const spread = reader.spreads[clamped];
    if (spread) deps.emitter.emit('spreadChange', { spreadIndex: clamped, spread });

    // Rebuild coordinator (hitMaps, mapper, annotations) for the target spread
    reader.notifyActiveSpread(clamped);

    deps.td.goToTarget(dir, prev, clamped, continuityDx);
    deps.emitter.emit('transitionStart', { direction: dir });
    deps.frameDriver.scheduleComposite();
  };

  return {
    goToSpread: goTo,
    nextSpread(): void {
      goTo(deps.getCurrentSpread() + 1);
    },
    prevSpread(): void {
      goTo(deps.getCurrentSpread() - 1);
    },
    navigateToTocEntry(entry: TocEntry): void {
      const reader = deps.getReader();
      if (!reader) return;
      const resolved = reader.resolveTocEntry(entry);
      if (resolved) goTo(resolved.spreadIndex);
    },
  };
}
