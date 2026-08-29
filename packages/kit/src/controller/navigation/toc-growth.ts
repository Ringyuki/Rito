import type { Reader, ReaderLocator, ReaderLocatorResolution, TocEntry } from '@ritojs/core';
import { claimNavigation } from './claim';
import type { NavigationDeps } from './index';
import {
  enqueueIntent,
  queuedLocatorSeek,
  queuedTocNavigation,
  type NavigationMachine,
  type PendingLocatorNavigation,
} from './machine';
import { failChapterLocalLocator, settleChapterLocalExact } from './local-preview';
import { continueResolvedLocatorNavigation } from './locator-continuation';

const TOC_FAILURE_SOURCE = 'reader TOC locator navigation';
const LINK_FAILURE_SOURCE = 'reader link locator navigation';

export function navigateTocEntry(
  machine: NavigationMachine,
  deps: NavigationDeps,
  entry: TocEntry,
  onResolved: (spreadIndex: number) => void,
): void {
  if (machine.disposed) return;
  const reader = deps.getReader();
  const resolved = reader?.resolveTocEntry(entry);
  if (resolved) {
    onResolved(resolved.spreadIndex);
    return;
  }
  const attemptId = claimNavigation(machine, deps).id;
  if (!reader?.navigateToLocator) {
    enqueueIntent(machine, { kind: 'toc', target: { attemptId, entry } });
    return;
  }
  startLocatorGrowth(
    machine,
    deps,
    reader,
    { href: entry.href },
    attemptId,
    onResolved,
    TOC_FAILURE_SOURCE,
    'TOC target',
  );
}

export function navigateReaderLocator(
  machine: NavigationMachine,
  deps: NavigationDeps,
  locator: ReaderLocator,
  onResolved: (spreadIndex: number) => void,
): void {
  if (machine.disposed) return;
  const reader = deps.getReader();
  const attemptId = claimNavigation(machine, deps).id;
  if (!reader?.navigateToLocator) {
    deps.onNavigationCancelled?.();
    reportLocatorFailure(deps, LINK_FAILURE_SOURCE, new Error('Reader cannot grow a link target'));
    return;
  }
  startLocatorGrowth(
    machine,
    deps,
    reader,
    locator,
    attemptId,
    onResolved,
    LINK_FAILURE_SOURCE,
    'link target',
  );
}

export function retryPendingTocEntry(
  machine: NavigationMachine,
  deps: NavigationDeps,
  onResolved: (spreadIndex: number) => void,
): void {
  const entry = pendingLegacyTocEntry(machine);
  if (!entry) return;
  const resolved = deps.getReader()?.resolveTocEntry(entry);
  if (resolved) onResolved(resolved.spreadIndex);
}

function startLocatorGrowth(
  machine: NavigationMachine,
  deps: NavigationDeps,
  reader: Reader,
  locator: ReaderLocator,
  attemptId: number,
  onResolved: (spreadIndex: number) => void,
  failureSource: string,
  targetLabel: string,
): void {
  if (!reader.navigateToLocator) return;
  const locatorAbort = new AbortController();
  const pending: PendingLocatorNavigation = {
    attemptId,
    locator,
    locatorAbort,
    failureSource,
    targetLabel,
    onResolved,
    provisionalPhase: 'none',
    previewReadySpread: undefined,
    exactResolution: undefined,
  };
  enqueueIntent(machine, { kind: 'locator', seek: pending });
  let task: Promise<ReaderLocatorResolution | undefined>;
  try {
    task = Promise.resolve(reader.navigateToLocator(locator, locatorAbort.signal));
  } catch (error) {
    task = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  void task
    .then((resolution) => {
      settleLocatorGrowth(machine, deps, reader, pending, resolution);
    })
    .catch((error: unknown) => {
      handleLocatorGrowthFailure(machine, deps, pending, error);
    });
}

export function pendingLegacyTocEntry(machine: NavigationMachine): TocEntry | undefined {
  return queuedTocNavigation(machine)?.entry;
}

function settleLocatorGrowth(
  machine: NavigationMachine,
  deps: NavigationDeps,
  reader: Reader,
  pending: PendingLocatorNavigation,
  resolution: ReaderLocatorResolution | undefined,
): void {
  if (!ownsLocatorGrowth(machine, pending)) return;
  if (!resolution) {
    if (failChapterLocalLocator(machine, deps, pending)) return;
    enqueueIntent(machine, undefined);
    deps.onNavigationCancelled?.();
    return;
  }
  if (resolution.status !== 'resolved') {
    failOwnedLocatorGrowth(
      machine,
      deps,
      pending,
      new Error(`Reader locator navigation did not resolve its ${pending.targetLabel}`),
    );
    return;
  }
  const currentReader = deps.getReader();
  if (
    currentReader !== reader ||
    !Number.isSafeInteger(resolution.spreadIndex) ||
    resolution.spreadIndex < 0 ||
    resolution.spreadIndex >= reader.totalSpreads ||
    !reader.spreads[resolution.spreadIndex]
  ) {
    failOwnedLocatorGrowth(
      machine,
      deps,
      pending,
      new Error('Reader locator navigation resolved outside its committed spread extent'),
    );
    return;
  }
  try {
    deps.onPaginationChanged?.();
    if (machine.disposed || machine.claimSeq !== pending.attemptId) return;
    if (settleChapterLocalExact(machine, deps, pending, resolution)) return;
  } catch (error) {
    handleLocatorGrowthFailure(machine, deps, pending, error);
    return;
  }
  continueResolvedLocatorNavigation(machine, deps, pending, resolution.spreadIndex);
}

function failLocatorGrowth(
  machine: NavigationMachine,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error: unknown,
): void {
  if (!ownsLocatorGrowth(machine, pending)) return;
  if (failChapterLocalLocator(machine, deps, pending, error)) return;
  enqueueIntent(machine, undefined);
  failOwnedLocatorGrowth(machine, deps, pending, error);
}

function handleLocatorGrowthFailure(
  machine: NavigationMachine,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error: unknown,
): void {
  try {
    failLocatorGrowth(machine, deps, pending, error);
  } catch {
    if (ownsLocatorGrowth(machine, pending)) enqueueIntent(machine, undefined);
  }
}

function failOwnedLocatorGrowth(
  machine: NavigationMachine,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error: unknown,
): void {
  if (failChapterLocalLocator(machine, deps, pending, error)) return;
  if (pending.attemptId === machine.claimSeq) deps.onNavigationCancelled?.();
  reportLocatorFailure(deps, pending.failureSource, error);
}

function reportLocatorFailure(deps: NavigationDeps, source: string, error: unknown): void {
  deps.emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source,
  });
}

function ownsLocatorGrowth(machine: NavigationMachine, pending: PendingLocatorNavigation): boolean {
  return (
    !machine.disposed &&
    queuedLocatorSeek(machine) === pending &&
    machine.claimSeq === pending.attemptId
  );
}
