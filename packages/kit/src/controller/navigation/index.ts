import type { Reader, TocEntry } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../../painter/buffer-pool';
import type { TypedEmitter } from '../../utils/event-emitter';
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
  startGestureNavigation(index: number, onTransitionStart: () => void): GestureNavigationToken;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;
  /** Snap to a spread without playing a transition animation. */
  jumpToSpread(index: number): void;
  /** Continue a deferred navigation once its async content slot is ready. */
  notifyContentReady(spreadIndex: number): void;
  /** Retry a TOC target that was unavailable in a partial preview revision. */
  notifyLayoutCommitted(): void;
}

/** Cancels a gesture navigation only while it is still waiting for content. */
export interface GestureNavigationToken {
  cancel(): void;
}

interface GestureNavigationRequest {
  readonly onTransitionStart: () => void;
  started: boolean;
  cancelled: boolean;
}

interface PendingNavigation {
  readonly target: number;
  readonly direction: 'forward' | 'backward';
  readonly previous: number;
  readonly continuityDx: number;
  readonly gesture?: GestureNavigationRequest;
}

interface NavigationState {
  pendingNavigation: PendingNavigation | undefined;
  pendingTocEntry: TocEntry | undefined;
}

export function createNavigation(deps: NavigationDeps): NavigationActions {
  const state: NavigationState = {
    pendingNavigation: undefined,
    pendingTocEntry: undefined,
  };
  return {
    goToSpread(index) {
      startNavigation(state, deps, index);
    },
    startGestureNavigation(index, onTransitionStart) {
      return startGestureNavigation(state, deps, index, onTransitionStart);
    },
    nextSpread() {
      startNavigation(state, deps, deps.getCurrentSpread() + 1);
    },
    prevSpread() {
      startNavigation(state, deps, deps.getCurrentSpread() - 1);
    },
    navigateToTocEntry(entry) {
      navigateToTocEntry(state, deps, entry);
    },
    jumpToSpread(index) {
      state.pendingTocEntry = undefined;
      replacePendingNavigation(state, undefined);
      jumpToSpread(deps, index);
    },
    notifyContentReady(spreadIndex) {
      continuePendingNavigation(state, deps, spreadIndex);
    },
    notifyLayoutCommitted() {
      retryPendingTocNavigation(state, deps);
    },
  };
}

function startNavigation(state: NavigationState, deps: NavigationDeps, index: number): void {
  state.pendingTocEntry = undefined;
  replacePendingNavigation(state, goToSpread(deps, index));
}

function startGestureNavigation(
  state: NavigationState,
  deps: NavigationDeps,
  index: number,
  onTransitionStart: () => void,
): GestureNavigationToken {
  state.pendingTocEntry = undefined;
  const request: GestureNavigationRequest = {
    onTransitionStart,
    started: false,
    cancelled: false,
  };
  replacePendingNavigation(state, goToSpread(deps, index, request));
  return {
    cancel(): void {
      if (request.started) return;
      request.cancelled = true;
      if (state.pendingNavigation?.gesture === request) state.pendingNavigation = undefined;
    },
  };
}

function navigateToTocEntry(state: NavigationState, deps: NavigationDeps, entry: TocEntry): void {
  const resolved = deps.getReader()?.resolveTocEntry(entry);
  if (!resolved) {
    replacePendingNavigation(state, undefined);
    state.pendingTocEntry = entry;
    return;
  }
  state.pendingTocEntry = undefined;
  replacePendingNavigation(state, goToSpread(deps, resolved.spreadIndex));
}

function retryPendingTocNavigation(state: NavigationState, deps: NavigationDeps): void {
  const entry = state.pendingTocEntry;
  if (!entry) return;
  const resolved = deps.getReader()?.resolveTocEntry(entry);
  if (!resolved) return;
  state.pendingTocEntry = undefined;
  replacePendingNavigation(state, goToSpread(deps, resolved.spreadIndex));
}

function continuePendingNavigation(
  state: NavigationState,
  deps: NavigationDeps,
  spreadIndex: number,
): void {
  const pending = state.pendingNavigation;
  if (!pending || pending.target !== spreadIndex) return;
  if (pending.gesture?.cancelled) {
    state.pendingNavigation = undefined;
    return;
  }
  if (!ensureIncomingSlot(deps, pending.target, pending.direction)) return;
  const reader = deps.getReader();
  if (!reader) return;
  state.pendingNavigation = undefined;
  emitNavigationStart(
    deps,
    reader,
    pending.target,
    pending.direction,
    pending.previous,
    pending.continuityDx,
    pending.gesture,
  );
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

function goToSpread(
  deps: NavigationDeps,
  index: number,
  gesture?: GestureNavigationRequest,
): PendingNavigation | undefined {
  const reader = deps.getReader();
  if (!reader) return undefined;
  const clamped = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  let previous = deps.getCurrentSpread();
  if (clamped === previous) return undefined;

  const continuityDx = deps.td.isAnimating ? settleForContinuity(deps) : 0;
  previous = deps.getCurrentSpread();
  if (clamped === previous) return undefined;

  const direction = clamped > previous ? 'forward' : 'backward';
  if (!ensureIncomingSlot(deps, clamped, direction)) {
    deps.frameDriver.scheduleComposite();
    return { target: clamped, direction, previous, continuityDx, ...(gesture ? { gesture } : {}) };
  }
  emitNavigationStart(deps, reader, clamped, direction, previous, continuityDx, gesture);
  return undefined;
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
): boolean {
  const slotPosition = direction === 'forward' ? 'next' : 'prev';
  if (deps.pool.getSlotFor(spreadIndex) !== slotPosition) {
    deps.pool.assignSlot(slotPosition, spreadIndex);
  }
  return deps.pool.ensureContent(slotPosition, deps.contentRenderer);
}

function emitNavigationStart(
  deps: NavigationDeps,
  reader: Reader,
  target: number,
  direction: 'forward' | 'backward',
  previous: number,
  continuityDx: number,
  gesture?: GestureNavigationRequest,
): void {
  if (gesture?.cancelled) return;
  const spread = reader.spreads[target];
  deps.setCurrentSpread(target);
  if (spread) deps.emitter.emit('spreadChange', { spreadIndex: target, spread });
  reader.notifyActiveSpread(target);
  deps.td.goToTarget(direction, previous, target, continuityDx);
  if (gesture) {
    gesture.started = true;
    gesture.onTransitionStart();
  }
  deps.emitter.emit('transitionStart', { direction });
  deps.frameDriver.scheduleComposite();
}

function replacePendingNavigation(
  state: NavigationState,
  next: PendingNavigation | undefined,
): void {
  const previous = state.pendingNavigation;
  if (previous?.gesture && !previous.gesture.started) previous.gesture.cancelled = true;
  state.pendingNavigation = next;
}
