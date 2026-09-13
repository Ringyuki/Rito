import type { Reader, ReaderLocator, ReaderLocatorResolution, TocEntry } from '@ritojs/core';
import { claimNavigation } from './claim';
import type { NavigationDeps } from './index';
import {
  enqueueIntent,
  queuedLocatorSeek,
  type NavigationMachine,
  type PendingLocatorNavigation,
} from './machine';
import { failChapterLocalLocator, settleChapterLocalExact } from './local-preview';
import { continueResolvedLocatorNavigation } from './locator-continuation';

const TOC_FAILURE_SOURCE = 'reader TOC locator navigation';
const LINK_FAILURE_SOURCE = 'reader link locator navigation';

/** Navigate to a TOC entry: directly when the committed layout resolves it, otherwise through the reader's locator seek. */
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
    deps.onNavigationCancelled?.();
    reportLocatorFailure(deps, TOC_FAILURE_SOURCE, new Error('Reader cannot resolve a TOC target'));
    return;
  }
  startLocatorSeek(
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
    reportLocatorFailure(
      deps,
      LINK_FAILURE_SOURCE,
      new Error('Reader cannot resolve a link target'),
    );
    return;
  }
  startLocatorSeek(
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

function startLocatorSeek(
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
      settleLocatorSeek(machine, deps, reader, pending, resolution);
    })
    .catch((error: unknown) => {
      handleLocatorSeekFailure(machine, deps, pending, error);
    });
}

function settleLocatorSeek(
  machine: NavigationMachine,
  deps: NavigationDeps,
  reader: Reader,
  pending: PendingLocatorNavigation,
  resolution: ReaderLocatorResolution | undefined,
): void {
  if (!ownsLocatorSeek(machine, pending)) return;
  if (!resolution) {
    if (failChapterLocalLocator(machine, deps, pending)) return;
    enqueueIntent(machine, undefined);
    deps.onNavigationCancelled?.();
    return;
  }
  if (resolution.status !== 'resolved') {
    failOwnedLocatorSeek(
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
    failOwnedLocatorSeek(
      machine,
      deps,
      pending,
      new Error('Reader locator navigation resolved outside its committed spread extent'),
    );
    return;
  }
  try {
    if (settleChapterLocalExact(machine, deps, pending, resolution)) return;
  } catch (error) {
    handleLocatorSeekFailure(machine, deps, pending, error);
    return;
  }
  continueResolvedLocatorNavigation(machine, deps, pending, resolution.spreadIndex);
}

function failLocatorSeek(
  machine: NavigationMachine,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error: unknown,
): void {
  if (!ownsLocatorSeek(machine, pending)) return;
  if (failChapterLocalLocator(machine, deps, pending, error)) return;
  enqueueIntent(machine, undefined);
  failOwnedLocatorSeek(machine, deps, pending, error);
}

function handleLocatorSeekFailure(
  machine: NavigationMachine,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error: unknown,
): void {
  try {
    failLocatorSeek(machine, deps, pending, error);
  } catch {
    if (ownsLocatorSeek(machine, pending)) enqueueIntent(machine, undefined);
  }
}

function failOwnedLocatorSeek(
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

function ownsLocatorSeek(machine: NavigationMachine, pending: PendingLocatorNavigation): boolean {
  return (
    !machine.disposed &&
    queuedLocatorSeek(machine) === pending &&
    machine.claimSeq === pending.attemptId
  );
}
