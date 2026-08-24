import type { ReaderProfileStageInput, ReaderProfileTransition } from './reader-profile-model';
import {
  buildTocSupersedeTransition,
  type ReaderProfileTocSupersedeTransitionInput,
} from './reader-profile-toc-model';
import type { FreshFarBootstrapResult } from './reader-profile-fresh-far';
import type { InitialProfileResult, TransitionProfileResult } from './reader-profile-stages';
import type { FarTocProfileResult, TocSupersedeProfileResult } from './reader-profile-toc-stages';
import type { ReaderChapterLocalPreviewMode } from './reader-chapter-local-preview-mode';
import {
  READER_WORKER_CHAPTER_LOCAL_MUTATION_KINDS,
  readerWorkerResponseHoldCategory,
  type ReaderWorkerOperationObservation,
} from './reader-worker-probe';

const CONTINUATION_KINDS = [
  'continueRevision',
  'continueRevisionAfterTransferRelease',
  'continueRevisionTowardSourceLocator',
] as const;

export function requireProfileProtocol(
  initial: InitialProfileResult,
  cached: TransitionProfileResult,
  growth: TransitionProfileResult,
  supersede: TocSupersedeProfileResult,
  reflow: ReaderProfileStageInput,
  freshFar: FreshFarBootstrapResult,
  farToc: FarTocProfileResult,
  operations: readonly ReaderWorkerOperationObservation[],
  previewMode: ReaderChapterLocalPreviewMode,
): void {
  requireKinds(initial.stage.operations, [
    'open',
    'createBoundedRevision',
    'getRevisionPresentationAtRevision',
    'warmFrameWindowAtRevision',
    'getFootnotesAtRevision',
    'getChapterTextIndicesAtRevision',
  ]);
  rejectKinds(cached.stage.operations, ['open', 'createBoundedRevision', ...CONTINUATION_KINDS]);
  requireKinds(growth.stage.operations, ['warmFrameWindowAtRevision']);
  requireAnyKind(growth.stage.operations, CONTINUATION_KINDS);
  requireTocSupersede(supersede);
  requireKinds(reflow.operations, [
    'open',
    'createBoundedRevision',
    'getRevisionPresentationAtRevision',
    'warmFrameWindowAtRevision',
  ]);
  requireFreshFar(freshFar);
  requireFarToc(farToc, supersede.transition.supersededHref);
  requireChapterLocalPreviewMode(previewMode, farToc, operations);
  rejectKinds(operations, ['createViewRevision']);
  requireExtentGrowth(growth.transition);
  const failed = operations.filter((entry) => entry.ok === false);
  if (failed.length > 0) {
    throw new Error(`Reader profile observed failed worker operations: ${operationIds(failed)}`);
  }
}

function requireChapterLocalPreviewMode(
  mode: ReaderChapterLocalPreviewMode,
  farToc: FarTocProfileResult,
  operations: readonly ReaderWorkerOperationObservation[],
): void {
  const expectedPresentation = mode === 'enabled' ? 'animated' : 'atomic';
  if (farToc.transition.presentation !== expectedPresentation) {
    throw new Error('Reader far-TOC presentation does not match its preview mode');
  }
  requireChapterLocalPreviewOperations(
    mode,
    farToc.transition.toHref,
    farToc.stage.completedAt,
    mode === 'disabled' ? operations : farToc.stage.operations,
  );
}

export function requireChapterLocalPreviewOperations(
  mode: ReaderChapterLocalPreviewMode,
  intendedHref: string,
  firstTargetFrameAt: number,
  operations: readonly ReaderWorkerOperationObservation[],
): void {
  if (mode === 'disabled') {
    rejectKinds(operations, READER_WORKER_CHAPTER_LOCAL_MUTATION_KINDS);
    return;
  }
  const targetHref = intendedHref.split('#', 1)[0] ?? intendedHref;
  const matching = operations.filter(
    (entry) =>
      READER_WORKER_CHAPTER_LOCAL_MUTATION_KINDS.some((kind) => kind === entry.kind) &&
      entry.ok === true &&
      entry.completedAt !== null &&
      entry.completedAt <= firstTargetFrameAt &&
      entry.chapterLocalRevision?.href === targetHref,
  );
  if (matching.length === 0) {
    throw new Error('Enabled reader profile did not observe target chapter-local preview work');
  }
}

function requireTocSupersede(supersede: TocSupersedeProfileResult): void {
  const heldCategories = new Set(supersede.transition.heldResponses.map((entry) => entry.category));
  if (
    heldCategories.size !== supersede.transition.heldResponses.length ||
    !heldCategories.has('mainContinuation')
  ) {
    throw new Error('Reader TOC supersede stage did not record one exact main response hold');
  }
  for (const held of supersede.transition.heldResponses) {
    const operation = supersede.stage.operations.find(
      (entry) =>
        entry.workerId === held.workerId &&
        entry.requestId === held.requestId &&
        entry.kind === held.kind,
    );
    const acceptedKind = readerWorkerResponseHoldCategory(held.kind) === held.category;
    if (!operation || operation.ok !== true || !acceptedKind || held.releasedAt < held.heldAt) {
      throw new Error(
        `Reader TOC supersede stage did not complete held ${held.category} ${held.kind}#${String(held.requestId)}`,
      );
    }
  }
  const heldMain = supersede.transition.heldResponses.find(
    (entry) => entry.category === 'mainContinuation',
  );
  if (heldMain?.requestId !== supersede.transition.heldContinuationRequestId) {
    throw new Error('Reader TOC supersede legacy continuation id disagrees with held response');
  }
  requireChangedTocTarget(supersede.transition);
  requireTocSupersedeTimeline(supersede.transition);
}

export function requireTocSupersedeTimeline(input: ReaderProfileTocSupersedeTransitionInput): void {
  const transition = buildTocSupersedeTransition(input);
  if (
    !transition.observedHrefObservations.some(
      (entry) => entry.href === transition.toHref && entry.observedAt >= transition.supersededAt,
    )
  ) {
    throw new Error('Reader TOC supersede stage did not observe its near target commit');
  }
  if (transition.staleCommitCount > 0) {
    throw new Error('Reader TOC supersede stage committed the stale far target');
  }
}

function requireFreshFar(fresh: FreshFarBootstrapResult): void {
  requireKinds(fresh.stage.operations, [
    'open',
    'createBoundedRevision',
    'getRevisionPresentationAtRevision',
    'warmFrameWindowAtRevision',
  ]);
  const generation = fresh.generation;
  if (
    generation.previousWorkerCount !== 1 ||
    generation.closedWorkerCount !== 1 ||
    generation.workersBeforeOpen !== 0 ||
    generation.freshWorkerCount !== 1 ||
    generation.positionStorageKey !== 'rito-position' ||
    !Object.is(generation.positionClearedBeforeOpen, true) ||
    generation.freshProbeOperationIndex !== 0
  ) {
    throw new Error('Reader far-TOC bootstrap did not replace its worker generation');
  }
  if (generation.checksumAfter === '' || generation.checksumAfter !== fresh.checksum) {
    throw new Error('Reader far-TOC bootstrap did not stabilize its fresh first frame');
  }
  if (generation.previousRevisionIds.length === 0 || generation.freshRevisionIds.length === 0) {
    throw new Error('Reader far-TOC bootstrap did not record both revision generations');
  }
  const open = fresh.stage.operations.find(
    (entry) => entry.requestId === generation.freshOpenRequestId,
  );
  const revision = fresh.stage.operations.find(
    (entry) => entry.requestId === generation.freshRevisionRequestId,
  );
  if (
    open?.kind !== 'open' ||
    open.ok !== true ||
    revision?.kind !== 'createBoundedRevision' ||
    revision.ok !== true ||
    open.workerId !== revision.workerId ||
    open.completedAt === null ||
    open.completedAt > revision.startedAt
  ) {
    throw new Error('Reader far-TOC bootstrap did not record a fresh open/revision sequence');
  }
}

function requireFarToc(farToc: FarTocProfileResult, intendedHref: string): void {
  requireChangedTocTarget(farToc.transition);
  if (farToc.transition.toHref !== intendedHref) {
    throw new Error('Reader fresh far-TOC stage targeted a different intended href');
  }
  requireAnyKind(farToc.stage.operations, CONTINUATION_KINDS);
  if (farToc.stage.workerRequestsToFirstFrame < 1) {
    throw new Error('Reader far-TOC stage reached first frame without a worker request');
  }
}

function requireChangedTocTarget(transition: {
  readonly fromHref: string;
  readonly toHref: string;
  readonly checksumBefore: string;
  readonly checksumAfter: string;
}): void {
  if (transition.fromHref === transition.toHref || transition.toHref === '') {
    throw new Error('Reader TOC profile did not activate a different chapter');
  }
  if (transition.checksumBefore === transition.checksumAfter) {
    throw new Error('Reader TOC profile did not paint different content');
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

function requireAnyKind(
  operations: readonly ReaderWorkerOperationObservation[],
  required: readonly string[],
): void {
  if (!operations.some((entry) => required.includes(entry.kind) && entry.ok === true)) {
    throw new Error(`Reader profile stage did not complete any of ${required.join(', ')}`);
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
