import type { Reader, ReaderInteractionTarget, ReaderInteractions, Spread } from '@ritojs/core';
import type { CoordinatorState } from '../core/coordinator-state';

export interface NativeTargetHit {
  readonly pageIndex: number;
  readonly target: ReaderInteractionTarget;
}

/** Native targets are authoritative whenever the Reader exposes the atomic capability. */
export function usesNativeTargets(reader: Reader): boolean {
  return reader.interactions !== undefined;
}

/** Clear installed targets and invalidate every outstanding visible-spread read. */
export function invalidateNativeTargets(state: CoordinatorState): void {
  state.nativeTargetLoadGeneration += 1;
  state.nativeTargetsByPage.clear();
}

/**
 * Read both visible pages against one interaction capability and install them atomically.
 * The Reader performs exact-revision validation; this layer additionally guards spread races.
 */
export async function loadNativeTargetsForSpread(
  spread: Spread,
  reader: Reader,
  state: CoordinatorState,
): Promise<void> {
  invalidateNativeTargets(state);
  if (!state.nativeInteractionsAlive) return;
  const interactions = reader.interactions;
  if (!interactions?.enabled) return;
  const generation = state.nativeTargetLoadGeneration;
  const pages = [spread.left, spread.right].filter((page) => page !== undefined);
  let results: Awaited<ReturnType<ReaderInteractions['getPageTargets']>>[];
  try {
    results = await Promise.all(pages.map((page) => interactions.getPageTargets(page.index)));
  } catch (error) {
    if (!canInstall(state, reader, interactions, generation)) return;
    throw error;
  }

  if (!canInstall(state, reader, interactions, generation)) return;
  if (results.some((result) => result === undefined)) return;

  const next = new Map<number, readonly ReaderInteractionTarget[]>();
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const result = results[index];
    if (!page || !result) return;
    if (result.pageIndex !== page.index || result.spreadIndex !== spread.index) {
      throw new Error('Native page targets do not match the visible spread');
    }
    next.set(page.index, result.targets);
  }

  if (!canInstall(state, reader, interactions, generation)) return;
  state.nativeTargetsByPage.clear();
  for (const [pageIndex, targets] of next) state.nativeTargetsByPage.set(pageIndex, targets);
}

/** Hit-test actionable native targets in reverse paint order. */
export function findNativeTargetAtPos(
  pos: { readonly x: number; readonly y: number },
  state: CoordinatorState,
): NativeTargetHit | undefined {
  const resolved = state.mapper?.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return undefined;
  const targets = state.nativeTargetsByPage.get(resolved.pageIndex);
  if (!targets) return undefined;

  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    if (!target || target.kind === 'text') continue;
    const bounds = target.bounds;
    if (
      resolved.x >= bounds.x &&
      resolved.x <= bounds.x + bounds.width &&
      resolved.y >= bounds.y &&
      resolved.y <= bounds.y + bounds.height
    ) {
      return { pageIndex: resolved.pageIndex, target };
    }
  }
  return undefined;
}

function canInstall(
  state: CoordinatorState,
  reader: Reader,
  interactions: ReaderInteractions,
  generation: number,
): boolean {
  return (
    state.nativeTargetLoadGeneration === generation &&
    state.nativeInteractionsAlive &&
    reader.interactions === interactions &&
    interactions.enabled
  );
}
