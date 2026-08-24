import type { PositionIntent, PositionTracker } from './intent';

const preservingClaims = new WeakMap<PositionTracker, () => PositionIntent>();

export function registerPreservingIntentClaim(
  tracker: PositionTracker,
  claim: () => PositionIntent,
): void {
  preservingClaims.set(tracker, claim);
}

/** Cancel older async work through a private policy that keeps a valid current position. */
export function claimPositionIntentPreservingCurrent(tracker: PositionTracker): PositionIntent {
  return preservingClaims.get(tracker)?.() ?? tracker.claimIntent();
}
