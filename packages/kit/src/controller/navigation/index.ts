import type { Reader, ReaderLocator, TocEntry } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../../painter/buffer-pool';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';
import type { SelectionGestureLease } from '../../interaction/selection/selection-interaction-owner';
import * as machine from './machine';
import * as jump from './jump';
import { continuePendingNavigation } from './pending';
import { claimNavigation } from './claim';
import {
  supersedeNavigationForGestureIntent,
  supersedeNavigationForPositionIntent,
  supersedeNavigationForSelectionIntent,
  type NavigationSelectionInputBarrier,
} from './direct-interaction';
import { continueBookTurn, startBookNavigation } from './book-navigation';
import {
  createLocatorNavigator,
  startGestureNavigation,
  startNavigation,
  startRelativeNavigation,
} from './spread-navigation';
import { navigateReaderLocator, navigateTocEntry } from './locator-navigation';

type Machine = machine.NavigationMachine;
type EntryActionName =
  | 'goToSpread'
  | 'startGestureNavigation'
  | 'nextSpread'
  | 'prevSpread'
  | 'navigateToTocEntry'
  | 'navigateToLocator'
  | 'jumpToSpread'
  | 'goToBookSpread'
  | 'jumpToSpreadIfReady'
  | 'prepareSpreadForJump';
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
  /** Invalidates older async position work as soon as a navigation intent is accepted. */
  onNavigationIntent?: () => void;
  /** Supersedes pending content interactions for every accepted navigation/position intent. */
  onContentInteractionIntent?: () => void;
  onNavigationCancelled?: () => void;
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
  /** Resolve and navigate to a durable locator under the shared latest-wins navigation owner. */
  navigateToLocator(locator: ReaderLocator): void;
  /** Snap to a spread without playing a transition animation. */
  jumpToSpread(index: number, preservePositionIntent?: boolean): boolean;
  /**
   * Navigate to a spread a host names by its book-wide index, with a turn
   * or a snap: at once when the whole book is laid out, otherwise when it
   * is. `index` may be read at that moment (the book's last spread).
   */
  goToBookSpread(
    index: number | (() => number),
    mode: 'turn' | 'jump',
    source?: machine.NavigationIntentSource,
  ): void;
  /** Snap only when the target is immediately paintable. */
  jumpToSpreadIfReady(
    index: number,
    selectionGesture?: SelectionGestureLease,
  ): jump.NavigationJumpOutcome;
  /** Prepare a paintable snap without claiming navigation or position ownership. */
  prepareSpreadForJump(index: number): jump.NavigationJumpReadiness;
  /** Continue a deferred navigation once its async content slot is ready. */
  notifyContentReady(spreadIndex: number): void;
  /** Continue a turn that waited for the whole book, once a layout is committed. */
  notifyLayoutCommitted(): void;
  /** Silently retire older navigation work before starting a direct selection gesture. */
  supersedeForSelectionIntent(): NavigationSelectionInputBarrier | null;
  supersedeForPositionIntent(): void;
  /**
   * Retire older navigation work before a finger turns the page itself. A
   * turn in flight is cut into, not landed at once: its outcome is settled
   * and the finger's turn begins from where its picture is.
   */
  supersedeForGesture(): void;
  dispose(): void;
}

/** Cancels a gesture navigation only while it is still waiting for content. */
export interface GestureNavigationToken {
  cancel(): void;
}

/** The navigation-owned subset of the visible-spread write reasons. */
export type NavigationSpreadWriteReason = 'navigation-start' | 'navigation-cancel' | 'jump';

export function createNavigation(deps: NavigationDeps): NavigationActions {
  const nav = machine.createNavigationMachine();
  const locatorNavigator = createLocatorNavigator(nav, deps);
  // Support diagnostics: one console call answers "what is navigation
  // doing right now" without instrumented builds.
  (globalThis as { __ritoNavigationPhase?: () => string }).__ritoNavigationPhase = () =>
    machine.describeNavigationPhase(nav);
  return {
    ...createEntryActions(nav, deps, locatorNavigator),
    ...createRuntimeActions(nav, deps),
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
      startRelativeNavigation(nav, deps, 1, source);
    },
    prevSpread(source) {
      startRelativeNavigation(nav, deps, -1, source);
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
      return jump.jumpToSpread(deps, claim, index);
    },
    goToBookSpread(index, mode, source = 'api') {
      startBookNavigation(nav, deps, source, () => {
        goToNamedSpread(nav, deps, typeof index === 'function' ? index() : index, mode, source);
      });
    },
    jumpToSpreadIfReady(index, selectionGesture) {
      return jump.performReadyJump(nav, deps, index, selectionGesture);
    },
    prepareSpreadForJump(index) {
      if (nav.disposed) return 'superseded';
      return jump.prepareSpreadForJump(deps, index);
    },
  };
}

function goToNamedSpread(
  nav: Machine,
  deps: NavigationDeps,
  target: number,
  mode: 'turn' | 'jump',
  source: machine.NavigationIntentSource,
): void {
  if (mode === 'turn') {
    startNavigation(nav, deps, target, source);
    return;
  }
  jump.jumpToSpread(deps, claimNavigation(nav, deps), target);
}

function createRuntimeActions(
  nav: Machine,
  deps: NavigationDeps,
): Pick<NavigationActions, RuntimeActionName> {
  return {
    notifyContentReady(spreadIndex) {
      if (!nav.disposed) continuePendingNavigation(nav, deps, spreadIndex);
    },
    notifyLayoutCommitted() {
      if (!nav.disposed) continueBookTurn(nav, deps);
    },
    supersedeForSelectionIntent: () => supersedeNavigationForSelectionIntent(nav, deps),
    supersedeForPositionIntent: () => {
      supersedeNavigationForPositionIntent(nav, deps);
    },
    supersedeForGesture: () => {
      supersedeNavigationForGestureIntent(nav, deps);
    },
    dispose: disposeNavigation.bind(undefined, nav),
  };
}

function disposeNavigation(nav: Machine): void {
  if (nav.disposed) return;
  nav.disposed = true;
  nav.claimSeq += 1;
  machine.clearQueuedIntent(nav);
}
