import type { Reader, ReaderLocator, TocEntry } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../../painter/buffer-pool';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';
import type { SelectionGestureLease } from '../../interaction/selection/selection-interaction-owner';
import * as navState from './state';
import * as jump from './jump';
import * as growth from './growth';
import {
  supersedeNavigationForPositionIntent,
  supersedeNavigationForSelectionIntent,
  type NavigationSelectionInputBarrier,
} from './direct-interaction';
import {
  createLocatorNavigator,
  startGestureNavigation,
  startNavigation,
} from './spread-navigation';
import { navigateReaderLocator, navigateTocEntry, retryPendingTocEntry } from './toc-growth';
import type { ProvisionalTransitionRuntime } from '../runtime-frame';
import type { SettledEvent } from '../../driver/types';
import {
  disposeChapterLocalTransition,
  handleChapterLocalTransitionSettled,
  notifyChapterLocalContentReady,
  presentChapterLocalInvalidation,
  refreshChapterLocalTransitionTheme,
  terminateChapterLocalTransitionForLayout,
} from './chapter-local-preview';

type State = navState.NavigationState;
type EntryActionName =
  | 'goToSpread'
  | 'startGestureNavigation'
  | 'nextSpread'
  | 'prevSpread'
  | 'navigateToTocEntry'
  | 'navigateToLocator'
  | 'jumpToSpread'
  | 'jumpToSpreadIfReady'
  | 'prepareSpreadForJump'
  | 'ensureSelectionSpread';
type RuntimeActionName = Exclude<keyof NavigationActions, EntryActionName>;

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
  readonly provisionalRuntime?: ProvisionalTransitionRuntime | undefined;
  /** Invalidates older async position work as soon as a navigation intent is accepted. */
  onNavigationIntent?: () => void;
  /** Supersedes pending content interactions for every accepted navigation/position intent. */
  onContentInteractionIntent?: () => void;
  onNavigationCancelled?: () => void;
  /** Publishes a newly committed known/final spread extent without resetting layout state. */
  onPaginationChanged?: () => void;
  /** Scope one exact native gesture projection transfer to one ready jump attempt. */
  beginSelectionProjectionTransfer?:
    | ((spreadIndex: number, lease: SelectionGestureLease) => () => void)
    | undefined;
}

export interface NavigationActions {
  goToSpread(index: number): void;
  startGestureNavigation(
    index: number,
    onTransitionStart: () => void,
    onUnavailable?: () => void,
  ): GestureNavigationToken;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;
  /** Grow and navigate to a durable locator under the shared latest-wins navigation owner. */
  navigateToLocator(locator: ReaderLocator): void;
  /** Snap to a spread without playing a transition animation. */
  jumpToSpread(index: number, preservePositionIntent?: boolean): boolean;
  /** Snap only when the target is immediately paintable. */
  jumpToSpreadIfReady(
    index: number,
    selectionGesture?: SelectionGestureLease,
  ): jump.NavigationJumpOutcome;
  /** Prepare a paintable snap without claiming navigation or position ownership. */
  prepareSpreadForJump(index: number): jump.NavigationJumpReadiness;
  /** Grow a selection-owned forward target without claiming navigation ownership. */
  ensureSelectionSpread(index: number, signal: AbortSignal): Promise<boolean | undefined>;
  /** Continue a deferred navigation once its async content slot is ready. */
  notifyContentReady(spreadIndex: number): void;
  /** Route the private Reader preview signal before ordinary spread invalidation. */
  presentChapterLocalInvalidation(spreadIndex: number): boolean;
  /** Sole provisional branch of the runtime TD settled listener. */
  handleTransitionSettled(event: SettledEvent): boolean;
  terminateChapterLocalForLayout(): (() => void) | undefined;
  refreshChapterLocalTheme(): void;
  /** Retry a TOC target that was unavailable in a partial preview revision. */
  notifyLayoutCommitted(): void;
  /** Silently retire older navigation work before starting a direct selection gesture. */
  supersedeForSelectionIntent(): NavigationSelectionInputBarrier | null;
  supersedeForPositionIntent(): void;
  dispose(): void;
}

/** Cancels a gesture navigation only while it is still waiting for content. */
export interface GestureNavigationToken {
  cancel(): void;
}

export function createNavigation(deps: NavigationDeps): NavigationActions {
  const state = navState.createNavigationState();
  const locatorNavigator = createLocatorNavigator(state, deps);
  return {
    ...createEntryActions(state, deps, locatorNavigator),
    ...createRuntimeActions(state, deps, locatorNavigator),
  };
}

function createEntryActions(
  state: State,
  deps: NavigationDeps,
  locatorNavigator: (spreadIndex: number) => void,
): Pick<NavigationActions, EntryActionName> {
  return {
    goToSpread: startNavigation.bind(undefined, state, deps),
    startGestureNavigation(index, onTransitionStart, onUnavailable) {
      return startGestureNavigation(state, deps, index, onTransitionStart, onUnavailable);
    },
    nextSpread() {
      startNavigation(state, deps, deps.getCurrentSpread() + 1);
    },
    prevSpread() {
      startNavigation(state, deps, deps.getCurrentSpread() - 1);
    },
    navigateToTocEntry(entry) {
      navigateTocEntry(state, deps, entry, locatorNavigator);
    },
    navigateToLocator(locator) {
      navigateReaderLocator(state, deps, locator, locatorNavigator);
    },
    jumpToSpread(index, preservePositionIntent) {
      if (state.disposed) return false;
      const attemptId = jump.claimNavigationAttempt(state, deps, preservePositionIntent);
      if (state.activeChapterLocalTransition || state.finalizingChapterLocalTransition) {
        return false;
      }
      return jump.jumpToSpread(state, deps, attemptId, index);
    },
    jumpToSpreadIfReady(index, selectionGesture) {
      return jump.performReadyJump(state, deps, index, selectionGesture);
    },
    prepareSpreadForJump(index) {
      if (state.disposed) return 'superseded';
      if (state.activeChapterLocalTransition || state.finalizingChapterLocalTransition) {
        return 'not-ready';
      }
      return jump.prepareSpreadForJump(deps, index);
    },
    ensureSelectionSpread: (index, signal) =>
      growth.ensureSelectionSpread(state, deps, index, signal),
  };
}

function createRuntimeActions(
  state: State,
  deps: NavigationDeps,
  locatorNavigator: (spreadIndex: number) => void,
): Pick<NavigationActions, RuntimeActionName> {
  return {
    notifyContentReady(spreadIndex) {
      if (state.disposed) return;
      if (notifyChapterLocalContentReady(state, deps, spreadIndex)) return;
      growth.continuePendingNavigation(state, deps, spreadIndex);
    },
    presentChapterLocalInvalidation: (spreadIndex) =>
      presentChapterLocalInvalidation(state, deps, spreadIndex),
    handleTransitionSettled: (event) => handleChapterLocalTransitionSettled(state, deps, event),
    terminateChapterLocalForLayout: () => terminateChapterLocalTransitionForLayout(state, deps),
    refreshChapterLocalTheme: () => {
      refreshChapterLocalTransitionTheme(state, deps);
    },
    notifyLayoutCommitted() {
      if (state.disposed) return;
      retryPendingTocEntry(state, deps, locatorNavigator);
    },
    supersedeForSelectionIntent: () => supersedeNavigationForSelectionIntent(state, deps),
    supersedeForPositionIntent: () => {
      supersedeNavigationForPositionIntent(state, deps);
    },
    dispose: disposeNavigation.bind(undefined, state, deps),
  };
}

function disposeNavigation(state: State, deps: NavigationDeps): void {
  if (state.disposed) return;
  disposeChapterLocalTransition(state, deps);
  state.disposed = true;
  state.navigationAttemptId += 1;
  navState.clearPendingNavigation(state);
}
