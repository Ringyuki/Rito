import type { Reader } from '@ritojs/core';
import { publishSpreadChange } from '../core/spread-change';
import type { NavigationClaim } from './claim';
import type { NavigationDeps, NavigationSpreadWriteReason } from './index';

/**
 * The one way a navigation presents a spread: write the visible spread,
 * notify the engine, publish the event — with a reentrancy checkpoint
 * after each externally observable step, because both the engine
 * notification and the event listeners may synchronously start a newer
 * navigation. Returns false as soon as this claim no longer owns the
 * presentation; the caller must stop driving it.
 */
export function presentSpread(
  deps: NavigationDeps,
  reader: Reader,
  claim: NavigationClaim,
  target: number,
  reason: NavigationSpreadWriteReason,
  publish = true,
): boolean {
  deps.setCurrentSpread(target, reason);
  reader.notifyActiveSpread(target);
  if (!ownsPresentation(deps, claim, target)) return false;
  if (!publish) return true;
  publishSpreadChange(deps.emitter, reader, target);
  return ownsPresentation(deps, claim, target);
}

/** This claim still owns the presentation and the reader still shows it. */
export function ownsPresentation(
  deps: NavigationDeps,
  claim: NavigationClaim,
  spreadIndex: number,
): boolean {
  return claim.owns() && deps.getCurrentSpread() === spreadIndex;
}
