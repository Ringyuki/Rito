import { activeEffect, activePhysics, type TransitionDriverState } from './transition-state';
import { forceSettleMode, turningInstruction, type TurningMode } from './transition-steps';
import type { LeavingNeighbour, SettledEvent, TransitionMode } from './types';

/** Where a turn begins: where the picture is, how fast it moves (px/s), and what is leaving it. */
export interface Leftover {
  readonly dx: number;
  readonly vx: number;
  readonly leaving: LeavingNeighbour | null;
}

const AT_REST: Leftover = { dx: 0, vx: 0, leaving: null };

/** What a turn beginning now starts from: what is left of the one it cut into, or rest. */
export function leftoverOf(state: TransitionDriverState): Leftover {
  const mode = state.mode;
  return mode.kind === 'finishing' ? { dx: mode.dx, vx: mode.vx, leaving: mode.leaving } : AT_REST;
}

/**
 * What a turn beginning now, `direction` with or without a neighbour to
 * bring in, starts from: what its physics make of what the turn it cut into
 * left, or that itself.
 */
export function beginningOf(
  state: TransitionDriverState,
  direction: 'forward' | 'backward',
  hasIncoming: boolean,
): Leftover {
  const left = leftoverOf(state);
  const physics = activePhysics(state);
  if (left.leaving === null || !physics?.begins) return left;
  const own = hasIncoming ? (direction === 'forward' ? 'next' : 'prev') : null;
  const at = physics.begins({
    dx: left.dx,
    velocity: left.vx,
    width: state.viewportWidth,
    direction,
    sameSpreads: left.leaving === own,
  });
  // A turn that begins elsewhere shows nothing of the one it cut into.
  return { dx: at.dx, vx: at.velocity, leaving: at.dx === left.dx ? left.leaving : null };
}

/**
 * Cuts into the open turn: its outcome is settled now, as a forced settle
 * would settle it, and the picture carries on from where it is. Returns the
 * event to report, or null when no turn is open. The mode is what is left
 * of the turn before the caller reports anything, so whatever a listener
 * starts begins from it.
 */
export function handOverMode(state: TransitionDriverState): SettledEvent | null {
  const mode = state.mode;
  if (mode.kind === 'idle' || mode.kind === 'finishing') return null;
  const { settled } = forceSettleMode(mode);
  // A turn that lands at once has nothing left to show.
  state.mode = activeEffect(state).instant
    ? { kind: 'idle' }
    : whatIsLeft(state, mode, settled?.committed ?? false);
  return settled;
}

/**
 * The rest of a turn, in the coordinates its outcome leaves. A turn that
 * landed has a new current spread: what was a page width short of arriving
 * is now that far from rest, with the page it left as its neighbour. One
 * that was going back, or pulling against the end of the book, stays where
 * it is. Nothing lies more than a page width from rest.
 */
function whatIsLeft(
  state: TransitionDriverState,
  mode: TurningMode,
  committed: boolean,
): TransitionMode {
  const width = state.viewportWidth;
  const forward = mode.direction === 'forward';
  const shift = committed ? (forward ? width : -width) : 0;
  const moved = mode.dx + shift;
  const dx = Math.max(-width, Math.min(width, moved));
  // A finger's speed is in px/ms; a turn left alone moves in px/s.
  const vx = mode.kind === 'tracking' ? mode.vx * 1000 : mode.vx;
  const leaving: LeavingNeighbour = committed
    ? forward
      ? 'prev'
      : 'next'
    : (turningInstruction(mode).incoming ?? 'none');
  // A turn left alone keeps the motion it was on; one a finger held, or cut short, starts one.
  if (mode.kind !== 'tracking' && dx === moved) {
    return {
      kind: 'finishing',
      leaving,
      dx,
      vx,
      settle: mode.settle,
      elapsed: mode.elapsed,
      shift,
    };
  }
  const settle = activePhysics(state)?.settle?.(dx, vx, 0) ?? null;
  return { kind: 'finishing', leaving, dx, vx, settle, elapsed: 0, shift: 0 };
}
