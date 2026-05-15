import type { TocEntry } from '@ritojs/core';
import type { Reader } from '@ritojs/core/web';
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
  /**
   * Snap to a spread without playing a transition animation. Use for cold-start
   * restore, deep-linking, search jumps, and other programmatic navigation
   * where the user did not initiate a turn.
   */
  jumpToSpread(index: number): void;
}

export function createNavigation(deps: NavigationDeps): NavigationActions {
  return {
    goToSpread: (index: number): void => {
      goToSpread(deps, index);
    },
    nextSpread(): void {
      goToSpread(deps, deps.getCurrentSpread() + 1);
    },
    prevSpread(): void {
      goToSpread(deps, deps.getCurrentSpread() - 1);
    },
    navigateToTocEntry(entry: TocEntry): void {
      const reader = deps.getReader();
      if (!reader) return;
      const resolved = reader.resolveTocEntry(entry);
      if (resolved) goToSpread(deps, resolved.spreadIndex);
    },
    jumpToSpread(index: number): void {
      jumpToSpread(deps, index);
    },
  };
}

function jumpToSpread(deps: NavigationDeps, index: number): void {
  const reader = deps.getReader();
  if (!reader) return;
  const clamped = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  if (deps.td.isAnimating) deps.td.forceSettle();
  deps.pool.jump(clamped);
  deps.pool.ensureContent('curr', deps.contentRenderer);
  deps.setCurrentSpread(clamped);
  const spread = reader.spreads[clamped];
  if (spread) deps.emitter.emit('spreadChange', { spreadIndex: clamped, spread });
  reader.notifyActiveSpread(clamped);
  deps.frameDriver.scheduleComposite();
}

function goToSpread(deps: NavigationDeps, index: number): void {
  const reader = deps.getReader();
  if (!reader) return;
  const clamped = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  let prev = deps.getCurrentSpread();
  if (clamped === prev) return;

  const continuityDx = deps.td.isAnimating ? settleForContinuity(deps) : 0;
  prev = deps.getCurrentSpread();
  if (clamped === prev) return;

  const direction = clamped > prev ? 'forward' : 'backward';
  deps.setCurrentSpread(clamped);
  ensureIncomingSlot(deps, clamped, direction);
  emitNavigationStart(deps, reader, clamped, direction, prev, continuityDx);
}

function settleForContinuity(deps: NavigationDeps): number {
  const residualDx = deps.td.forceSettle();
  const width = deps.td.viewportWidth;
  return residualDx > 0 ? residualDx - width : residualDx + width;
}

function ensureIncomingSlot(
  deps: NavigationDeps,
  spreadIndex: number,
  direction: 'forward' | 'backward',
): void {
  const slotPos = direction === 'forward' ? 'next' : 'prev';
  if (deps.pool.getSlotFor(spreadIndex) !== slotPos) deps.pool.assignSlot(slotPos, spreadIndex);
  deps.pool.ensureContent(slotPos, deps.contentRenderer);
}

function emitNavigationStart(
  deps: NavigationDeps,
  reader: Reader,
  target: number,
  direction: 'forward' | 'backward',
  previous: number,
  continuityDx: number,
): void {
  const spread = reader.spreads[target];
  if (spread) deps.emitter.emit('spreadChange', { spreadIndex: target, spread });
  reader.notifyActiveSpread(target);
  deps.td.goToTarget(direction, previous, target, continuityDx);
  deps.emitter.emit('transitionStart', { direction });
  deps.frameDriver.scheduleComposite();
}
