import type { Reader } from '@ritojs/core';
import type { NavigationDeps } from './index';

/**
 * A spread's content arrived: a turn waiting for that page to be painted in
 * its slot is told it is, once it is painted there.
 */
export function continuePendingNavigation(deps: NavigationDeps, spreadIndex: number): void {
  for (const direction of ['next', 'previous'] as const) {
    if (deps.turnTargets.of(direction) !== spreadIndex) continue;
    const slot = direction === 'next' ? 'next' : 'prev';
    if (deps.pool.getSlotFor(spreadIndex) !== slot) continue;
    if (deps.pool.ensureContent(slot, deps.contentRenderer)) deps.td.pagesChanged();
  }
}

/** Clamp a requested spread index into the committed layout's final extent. */
export function navigationTarget(reader: Reader, requested: number): number {
  return Math.max(0, Math.min(requested, reader.totalSpreads - 1));
}
