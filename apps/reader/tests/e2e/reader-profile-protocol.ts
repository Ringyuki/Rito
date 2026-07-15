import type { ReaderProfileStageInput, ReaderProfileTransition } from './reader-profile-model';
import type { InitialProfileResult, TransitionProfileResult } from './reader-profile-stages';
import type { ReaderWorkerOperationObservation } from './reader-worker-probe';

export function requireProfileProtocol(
  initial: InitialProfileResult,
  cached: TransitionProfileResult,
  growth: TransitionProfileResult,
  reflow: ReaderProfileStageInput,
  operations: readonly ReaderWorkerOperationObservation[],
): void {
  requireKinds(initial.stage.operations, [
    'open',
    'createBoundedRevision',
    'getRevisionPresentationAtRevision',
    'warmFrameWindowAtRevision',
    'getFootnotesAtRevision',
    'getChapterTextIndicesAtRevision',
  ]);
  rejectKinds(cached.stage.operations, ['open', 'createBoundedRevision', 'continueRevision']);
  requireKinds(growth.stage.operations, ['continueRevision', 'warmFrameWindowAtRevision']);
  requireKinds(reflow.operations, [
    'open',
    'createBoundedRevision',
    'getRevisionPresentationAtRevision',
    'warmFrameWindowAtRevision',
  ]);
  rejectKinds(operations, ['createViewRevision']);
  requireExtentGrowth(growth.transition);
  const failed = operations.filter((entry) => entry.ok === false);
  if (failed.length > 0) {
    throw new Error(`Reader profile observed failed worker operations: ${operationIds(failed)}`);
  }
}

export function requireIncompleteRevision(
  operations: readonly ReaderWorkerOperationObservation[],
): void {
  const status = operations
    .filter((entry) => entry.revision !== null && entry.revision.status !== null)
    .at(-1)?.revision?.status;
  if (status === 'complete') {
    throw new Error('Reader profile fixture completed before deferred growth could be measured');
  }
}

function requireKinds(
  operations: readonly ReaderWorkerOperationObservation[],
  required: readonly string[],
): void {
  for (const kind of required) {
    if (!operations.some((entry) => entry.kind === kind && entry.ok === true)) {
      throw new Error(`Reader profile stage did not complete ${kind}`);
    }
  }
}

function rejectKinds(
  operations: readonly ReaderWorkerOperationObservation[],
  rejected: readonly string[],
): void {
  const found = operations.filter((entry) => rejected.includes(entry.kind));
  if (found.length > 0) {
    throw new Error(`Reader profile stage unexpectedly ran ${operationIds(found)}`);
  }
}

function requireExtentGrowth(transition: ReaderProfileTransition): void {
  if (transition.knownSpreadCountAfter <= transition.knownSpreadCountBefore) {
    throw new Error('Reader deferred-growth profile did not increase the known spread extent');
  }
}

function operationIds(operations: readonly ReaderWorkerOperationObservation[]): string {
  return operations.map((entry) => `${entry.kind}#${String(entry.requestId)}`).join(', ');
}
