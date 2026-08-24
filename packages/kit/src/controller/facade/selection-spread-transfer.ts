import {
  captureSelectionGesture,
  captureSelectionInteraction,
  isSelectionGestureSuperseded,
  ownsSelectionGesture,
  type SelectionGestureLease,
} from '../../interaction/selection/selection-interaction-owner';
import type { ReadingPosition } from '../../interaction/index';
import { claimPositionIntentPreservingCurrent } from '../../interaction/position/preserving-intent';
import type { PrimarySelectionInputIntent } from '../wiring/selection-drag';
import type {
  SelectionEdgeDirection,
  SelectionEdgeNavigationOutcome,
} from './selection-edge-navigation';
import type { Internals, Nav } from './types';

export interface SelectionIntentCapture {
  generation: number;
  readonly gesture: SelectionGestureLease;
}

export type SelectionContentPoint = { readonly x: number; readonly y: number };

export type SelectionIntentStart<T> =
  | { readonly kind: 'unmanaged'; readonly value: T }
  | {
      readonly kind: 'rejected';
      readonly value: T;
      readonly cancellationGesture?: SelectionGestureLease;
    }
  | { readonly kind: 'captured'; readonly value: T; readonly intent: SelectionIntentCapture };

/** Claim one physical selection input and cancel older navigation/portable-position work. */
export function claimSelectionInputIntent(
  internals: Internals,
  nav: Nav,
): PrimarySelectionInputIntent | null {
  const generationBefore = currentContentInteractionGeneration(internals);
  const navigationBarrier = nav.supersedeForSelectionIntent();
  if (
    !navigationBarrier ||
    !navigationBarrier.owns() ||
    currentContentInteractionGeneration(internals) !== generationBefore + 1
  ) {
    return null;
  }
  const tracker = internals.engines.position;
  const preservedPosition = tracker?.getPreservableCurrent();
  const positionIntent = tracker ? claimPositionIntentPreservingCurrent(tracker) : undefined;
  if (
    !navigationBarrier.owns() ||
    (positionIntent !== undefined && !tracker?.owns(positionIntent)) ||
    currentContentInteractionGeneration(internals) !== generationBefore + 1
  ) {
    return null;
  }
  recoverSelectionInputPosition(internals, positionIntent, preservedPosition);
  const generation = currentContentInteractionGeneration(internals);
  if (generation !== generationBefore + 1 || !navigationBarrier.owns()) return null;
  return {
    owns: () =>
      navigationBarrier.owns() && currentContentInteractionGeneration(internals) === generation,
  };
}

/**
 * Run one primary-selection start and capture only the exact native session it created.
 * Synchronous selection/navigation reentrancy fails closed.
 */
export function startSelectionIntent<T>(
  internals: Internals,
  startSelection: () => T,
): SelectionIntentStart<T> {
  const engine = internals.engines.selection;
  const before = captureSelectionInteraction(engine);
  const generation = currentContentInteractionGeneration(internals);
  const value = startSelection();
  if (!before) {
    return currentContentInteractionGeneration(internals) === generation
      ? { kind: 'unmanaged', value }
      : { kind: 'rejected', value };
  }
  const after = captureSelectionGesture(engine);
  const expectedGesture = after?.generation === before.generation + 1 ? after : null;
  if (
    !expectedGesture ||
    currentContentInteractionGeneration(internals) !== generation ||
    engine.getState() !== 'selecting'
  ) {
    return expectedGesture
      ? { kind: 'rejected', value, cancellationGesture: expectedGesture }
      : { kind: 'rejected', value };
  }
  return { kind: 'captured', value, intent: { generation, gesture: expectedGesture } };
}

/** Grow/snap one adjacent spread while retaining the captured native selection session. */
export function transferSelectionGesture(
  internals: Internals,
  nav: Nav,
  target: number,
  direction: SelectionEdgeDirection,
  signal: AbortSignal,
  intent: SelectionIntentCapture,
  resolveInput: () => SelectionContentPoint,
  replay: (point: SelectionContentPoint) => void,
  onSpreadTransfer?: () => void,
): SelectionEdgeNavigationOutcome | Promise<SelectionEdgeNavigationOutcome> {
  if (selectionTransferWasAborted(signal) || !ownsSelectionIntent(internals, intent)) return 'stop';
  if (target >= internals.reader.totalSpreads) {
    return nav
      .ensureSelectionSpread(target, signal)
      .then((available) =>
        available === true &&
        !selectionTransferWasAborted(signal) &&
        ownsSelectionIntent(internals, intent)
          ? 'retry'
          : 'stop',
      );
  }
  const readiness = nav.prepareSpreadForJump(target);
  if (readiness !== 'ready') return readiness === 'not-ready' ? 'retry' : 'stop';
  if (selectionTransferWasAborted(signal) || !ownsSelectionIntent(internals, intent)) return 'stop';
  const generationBeforeJump = currentContentInteractionGeneration(internals);
  const spreadBeforeJump = internals.currentSpread;
  const outcome = nav.jumpToSpreadIfReady(target, intent.gesture);
  if (internals.currentSpread !== spreadBeforeJump) onSpreadTransfer?.();
  if (
    outcome === 'superseded' ||
    selectionTransferWasAborted(signal) ||
    !ownsSelectionGesture(intent.gesture) ||
    !adoptOwnedNavigationIntent(internals, intent, generationBeforeJump)
  ) {
    return 'stop';
  }
  if (outcome !== 'committed') return 'retry';
  replay(clampToVisibleEdge(internals, resolveInput(), direction));
  return 'committed';
}

function selectionTransferWasAborted(signal: AbortSignal): boolean {
  // The signal can be aborted by synchronous navigation/selection reentrancy.
  return signal.aborted;
}

export function ownsSelectionIntent(
  internals: Internals,
  capture: SelectionIntentCapture,
): boolean {
  return (
    ownsSelectionGesture(capture.gesture) && ownsSelectionContentGeneration(internals, capture)
  );
}

/** True only when another selection/content lifecycle replaced this exact intent. */
export function isSelectionIntentSuperseded(
  internals: Internals,
  capture: SelectionIntentCapture,
): boolean {
  return (
    isSelectionGestureSuperseded(capture.gesture) ||
    !ownsSelectionContentGeneration(internals, capture)
  );
}

function ownsSelectionContentGeneration(
  internals: Internals,
  capture: SelectionIntentCapture,
): boolean {
  const currentGeneration = currentContentInteractionGeneration(internals);
  if (currentGeneration === capture.generation) return true;
  const transfer = internals.coordState.selectionProjectionTransfer;
  return currentGeneration === capture.generation + 1 && transfer?.gesture === capture.gesture;
}

function adoptOwnedNavigationIntent(
  internals: Internals,
  capture: SelectionIntentCapture,
  previousGeneration: number,
): boolean {
  const currentGeneration = currentContentInteractionGeneration(internals);
  if (currentGeneration !== previousGeneration + 1) return false;
  capture.generation = currentGeneration;
  return true;
}

function currentContentInteractionGeneration(internals: Internals): number {
  return internals.coordState.contentInteractionGeneration;
}

function recoverSelectionInputPosition(
  internals: Internals,
  intent: { readonly generation: number } | undefined,
  preserved: ReadingPosition | null | undefined,
): void {
  const tracker = internals.engines.position;
  if (!intent || !tracker?.owns(intent)) return;
  if (preserved?.projection.spreadIndex === internals.currentSpread) return;
  tracker.update(internals.currentSpread);
}

export function clampToVisibleEdge(
  internals: Internals,
  input: SelectionContentPoint,
  direction: SelectionEdgeDirection,
): SelectionContentPoint {
  const pages = internals.coordState.mapper?.getPages() ?? [];
  const page = direction === 1 ? pages.at(-1) : pages[0];
  if (!page) return input;
  return {
    x: clamp(input.x, page.spreadContentOriginX, page.spreadContentOriginX + page.contentWidth),
    y: clamp(input.y, 0, page.contentHeight),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
