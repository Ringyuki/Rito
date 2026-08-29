import type { Reader, ReaderLocator, TocEntry } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../../painter/buffer-pool';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';
import type { SelectionGestureLease } from '../../interaction/selection/selection-interaction-owner';
import * as machine from './machine';
import * as jump from './jump';
import * as growth from './growth';
import { claimNavigation } from './claim';
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
} from './local-preview';

type Machine = machine.NavigationMachine;
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
  setCurrentSpread: (index: number, reason: NavigationSpreadWriteReason) => void;
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
  goToSpread(index: number, source?: machine.NavigationIntentSource): void;
  startGestureNavigation(
    index: number,
    onTransitionStart: () => void,
    onUnavailable?: () => void,
  ): GestureNavigationToken;
  nextSpread(source?: machine.NavigationIntentSource): void;
  prevSpread(source?: machine.NavigationIntentSource): void;
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

/** The navigation-owned subset of the visible-spread write reasons. */
export type NavigationSpreadWriteReason =
  | 'navigation-start'
  | 'navigation-cancel'
  | 'jump'
  | 'chapter-local-promotion';

export function createNavigation(deps: NavigationDeps): NavigationActions {
  const nav = machine.createNavigationMachine();
  const locatorNavigator = createLocatorNavigator(nav, deps);
  // Support diagnostics: one console call answers "what is navigation
  // doing right now" without instrumented builds.
  (globalThis as { __ritoNavigationPhase?: () => string }).__ritoNavigationPhase = () =>
    machine.describeNavigationPhase(nav);
  return {
    ...createEntryActions(nav, deps, locatorNavigator),
    ...createRuntimeActions(nav, deps, locatorNavigator),
  };
}

function createEntryActions(
  nav: Machine,
  deps: NavigationDeps,
  locatorNavigator: (spreadIndex: number) => void,
): Pick<NavigationActions, EntryActionName> {
  return {
    goToSpread(index, source) {
      startNavigation(nav, deps, index, source);
    },
    startGestureNavigation(index, onTransitionStart, onUnavailable) {
      return startGestureNavigation(nav, deps, index, onTransitionStart, onUnavailable);
    },
    nextSpread(source) {
      startNavigation(nav, deps, deps.getCurrentSpread() + 1, source);
    },
    prevSpread(source) {
      startNavigation(nav, deps, deps.getCurrentSpread() - 1, source);
    },
    navigateToTocEntry(entry) {
      navigateTocEntry(nav, deps, entry, locatorNavigator);
    },
    navigateToLocator(locator) {
      navigateReaderLocator(nav, deps, locator, locatorNavigator);
    },
    jumpToSpread(index, preservePositionIntent) {
      if (nav.disposed) return false;
      const claim = claimNavigation(nav, deps, preservePositionIntent);
      if (machine.foregroundIsBusy(nav)) return false;
      return jump.jumpToSpread(deps, claim, index);
    },
    jumpToSpreadIfReady(index, selectionGesture) {
      return jump.performReadyJump(nav, deps, index, selectionGesture);
    },
    prepareSpreadForJump(index) {
      if (nav.disposed) return 'superseded';
      if (machine.foregroundIsBusy(nav)) return 'not-ready';
      return jump.prepareSpreadForJump(deps, index);
    },
    ensureSelectionSpread: (index, signal) =>
      growth.ensureSelectionSpread(nav, deps, index, signal),
  };
}

function createRuntimeActions(
  nav: Machine,
  deps: NavigationDeps,
  locatorNavigator: (spreadIndex: number) => void,
): Pick<NavigationActions, RuntimeActionName> {
  return {
    notifyContentReady(spreadIndex) {
      if (nav.disposed) return;
      if (notifyChapterLocalContentReady(nav, deps, spreadIndex)) return;
      growth.continuePendingNavigation(nav, deps, spreadIndex);
    },
    presentChapterLocalInvalidation: (spreadIndex) =>
      presentChapterLocalInvalidation(nav, deps, spreadIndex),
    handleTransitionSettled: (event) => handleChapterLocalTransitionSettled(nav, deps, event),
    terminateChapterLocalForLayout: () => terminateChapterLocalTransitionForLayout(nav, deps),
    refreshChapterLocalTheme: () => {
      refreshChapterLocalTransitionTheme(nav, deps);
    },
    notifyLayoutCommitted() {
      if (nav.disposed) return;
      retryPendingTocEntry(nav, deps, locatorNavigator);
    },
    supersedeForSelectionIntent: () => supersedeNavigationForSelectionIntent(nav, deps),
    supersedeForPositionIntent: () => {
      supersedeNavigationForPositionIntent(nav, deps);
    },
    dispose: disposeNavigation.bind(undefined, nav, deps),
  };
}

function disposeNavigation(nav: Machine, deps: NavigationDeps): void {
  if (nav.disposed) return;
  disposeChapterLocalTransition(nav, deps);
  nav.disposed = true;
  nav.claimSeq += 1;
  machine.clearQueuedIntent(nav);
}
