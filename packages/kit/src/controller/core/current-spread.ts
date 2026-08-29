import type { Internals } from './internals';

/**
 * Why a visible-spread write happened. Every mutation names its cause so
 * a wrong-looking position can be attributed from the console without
 * instrumented builds (the snap-back hunt cost days because writers were
 * anonymous closures).
 */
export type CurrentSpreadWriteReason =
  | 'navigation-start'
  | 'navigation-cancel'
  | 'jump'
  | 'chapter-local-promotion'
  | 'settle-commit'
  | 'settle-snap-back'
  | 'layout-commit';

interface SpreadMoveRecord {
  from: number;
  to: number;
  reason: CurrentSpreadWriteReason;
  at: string;
}

/**
 * The only writer of `internals.currentSpread` (an architecture test
 * enforces this). Every move is recorded in a capped diagnostics ring at
 * `globalThis.__ritoSpreadMoves`, newest last.
 */
export function commitCurrentSpread(
  internals: Internals,
  next: number,
  reason: CurrentSpreadWriteReason,
): void {
  if (internals.currentSpread === next) return;
  recordSpreadMove(internals.currentSpread, next, reason);
  internals.currentSpread = next;
}

function recordSpreadMove(from: number, to: number, reason: CurrentSpreadWriteReason): void {
  const scope = globalThis as { __ritoSpreadMoves?: SpreadMoveRecord[] };
  const log = (scope.__ritoSpreadMoves ??= []);
  log.push({ from, to, reason, at: new Date().toISOString() });
  if (log.length > 40) log.splice(0, log.length - 40);
}
