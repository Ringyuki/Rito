import {
  requireMatchingSourceLocatorRequest,
  requireSourceLocatorRequest,
} from './reader-worker-interaction-validation-runtime.js';
import {
  canonicalChapterLocalTarget,
  nextChapterLocalOwner,
  requireChapterLocalCursor,
  requireChapterLocalOwner,
  requireChapterLocalTransferCount,
  requireCount,
  requireMatchingChapterLocalOwner,
  requireNonEmptyString,
  requireRecord,
} from './chapter-local-owner-validation-runtime.js';

const ACTIVE_STATUSES = new Set(['warming', 'ready', 'complete']);
const MATCH_KINDS = new Set(['sourceRange', 'sourcePoint', 'anchor', 'progression', 'href']);

export function requireCreatedChapterLocalAdvance(value, request, maximum, operation, bindOwner) {
  const advance = requireRecord(value, `${operation} advance`);
  const targetLocator = canonicalChapterLocalTarget(request.targetLocator, operation);
  const revision = requireChapterLocalSummary(
    advance.revision,
    {
      revisionVersion: 0,
      chapterIndex: request.targetChapterIndex,
      localPageCap: request.localPageCap,
    },
    operation,
  );
  const owner = ownerFromSummary(revision);
  bindOwner?.(owner);
  if (
    Object.hasOwn(advance, 'releasedPreviousOwner') ||
    Object.hasOwn(advance, 'releasedPreviousOwnerTransferCount')
  ) {
    throw new Error(`${operation} create advance forged predecessor-release proof`);
  }
  validateAdvanceBody(advance, revision, owner, targetLocator, maximum, operation, true);
  return advance;
}

export function requireContinuedChapterLocalAdvance(value, request, maximum, operation, bindOwner) {
  const advance = requireRecord(value, `${operation} advance`);
  const previous = request.continuation.owner;
  const expected = nextChapterLocalOwner(previous, operation);
  const revision = requireChapterLocalSummary(advance.revision, expected, operation);
  const owner = ownerFromSummary(revision);
  bindOwner?.(owner);
  validateAdvanceBody(
    advance,
    revision,
    owner,
    request.continuation.targetLocator,
    maximum,
    operation,
    false,
  );
  requireMatchingChapterLocalOwner(
    advance.releasedPreviousOwner,
    previous,
    `${operation} released predecessor`,
  );
  requireChapterLocalTransferCount(
    advance.releasedPreviousOwnerTransferCount,
    `${operation} released predecessor`,
  );
  return advance;
}

export function requireChapterLocalRelease(value, expectedOwner, operation) {
  const release = requireRecord(value, `${operation} result`);
  const owner = requireMatchingChapterLocalOwner(release.owner, expectedOwner, operation);
  if (typeof release.releasedRevision !== 'boolean') {
    throw new Error(`${operation} returned an invalid releasedRevision proof`);
  }
  const releasedTransferCount = requireChapterLocalTransferCount(
    release.releasedTransferCount,
    operation,
  );
  return { owner, releasedRevision: release.releasedRevision, releasedTransferCount };
}

export function ownerFromChapterLocalAdvance(value, operation) {
  const advance = requireRecord(value, `${operation} advance`);
  return ownerFromSummary(requireRecord(advance.revision, `${operation} revision`));
}

function validateAdvanceBody(advance, revision, owner, targetLocator, maximum, operation, initial) {
  const previous = requireExtent(advance.previousKnownExtent, `${operation} previous extent`);
  const range = requirePageRange(advance.newlyKnownLocalPages, operation);
  requireAdvanceExtents(previous, range, revision.knownExtent, operation);
  if (initial && (previous.localPageCount !== 0 || previous.localSpreadCount !== 0)) {
    throw new Error(`${operation} returned a non-empty initial previous extent`);
  }
  const processed = requireCount(
    advance.processedTopLevelNodes,
    `${operation} processedTopLevelNodes`,
  );
  if (processed > maximum) throw new Error(`${operation} exceeded its work budget`);
  requireTarget(advance.target, owner, revision.knownExtent, targetLocator, operation);
  requireContinuation(advance.continuation, owner, revision, targetLocator, operation);
}

function requireChapterLocalSummary(value, expected, operation) {
  const summary = requireRecord(value, `${operation} revision`);
  const owner = requireChapterLocalOwner(summary, `${operation} revision`);
  requireExpectedOwner(owner, expected, operation);
  requireNonEmptyString(summary.layoutKey, `${operation} layoutKey`);
  if (!ACTIVE_STATUSES.has(summary.status)) {
    throw new Error(`${operation} returned a terminal non-success chapter-local status`);
  }
  const localPageCap = requireCount(summary.localPageCap, `${operation} localPageCap`);
  if (localPageCap < 1 || localPageCap > 16) {
    throw new Error(`${operation} returned an invalid localPageCap`);
  }
  if (expected.localPageCap !== undefined && localPageCap !== expected.localPageCap) {
    throw new Error(`${operation} returned a mismatched localPageCap`);
  }
  const knownExtent = requireExtent(summary.knownExtent, `${operation} known extent`);
  if (knownExtent.localPageCount > localPageCap) {
    throw new Error(`${operation} exceeded its local page cap`);
  }
  requireStatusExtent(summary, knownExtent, operation);
  if (typeof summary.pageCapReached !== 'boolean') {
    throw new Error(`${operation} returned an invalid pageCapReached flag`);
  }
  if (summary.pageCapReached && knownExtent.localPageCount !== localPageCap) {
    throw new Error(`${operation} reported page-cap completion before reaching the cap`);
  }
  return summary;
}

function requireExpectedOwner(owner, expected, operation) {
  if (expected.revisionId !== undefined) {
    requireMatchingChapterLocalOwner(owner, expected, `${operation} revision`);
    return;
  }
  if (
    owner.revisionVersion !== expected.revisionVersion ||
    owner.coordinate.chapterIndex !== expected.chapterIndex
  ) {
    throw new Error(`${operation} returned a mismatched created chapter-local owner`);
  }
}

function requireStatusExtent(summary, known, operation) {
  if (summary.status === 'warming' && known.localSpreadCount !== 0) {
    throw new Error(`${operation} returned warming local spreads`);
  }
  if (summary.status === 'ready' && known.localSpreadCount === 0) {
    throw new Error(`${operation} returned ready without a local spread`);
  }
  if (summary.status === 'complete') {
    const finalExtent = requireExtent(summary.finalExtent, `${operation} final extent`);
    if (!sameExtent(finalExtent, known)) {
      throw new Error(`${operation} returned a mismatched final local extent`);
    }
  } else if (summary.finalExtent !== undefined) {
    throw new Error(`${operation} returned final local extent before completion`);
  }
}

function requireTarget(value, owner, extent, expectedLocator, operation) {
  const target = requireRecord(value, `${operation} target`);
  requireMatchingChapterLocalOwner(target.owner, owner, `${operation} target`);
  const locator = requireSourceLocatorRequest(target.locator, `${operation} target`);
  if (locator.href !== owner.coordinate.href) {
    throw new Error(`${operation} target locator does not match its owner coordinate`);
  }
  requireMatchingSourceLocatorRequest(
    locator,
    { ...expectedLocator, href: owner.coordinate.href },
    `${operation} target`,
  );
  requireNonEmptyString(target.spineIdref, `${operation} target spineIdref`);
  if (!MATCH_KINDS.has(target.matchedBy)) {
    throw new Error(`${operation} returned an invalid target match kind`);
  }
  if (target.status === 'resolved') {
    const page = requireCount(target.localPageIndex, `${operation} target localPageIndex`);
    const spread = requireCount(target.localSpreadIndex, `${operation} target localSpreadIndex`);
    if (page >= extent.localPageCount || spread >= extent.localSpreadCount) {
      throw new Error(`${operation} resolved target lies outside its known local extent`);
    }
    if (target.reason !== undefined) {
      throw new Error(`${operation} resolved target included a pending reason`);
    }
    return;
  }
  if (target.status !== 'pending') {
    throw new Error(`${operation} returned an invalid target status`);
  }
  if (target.reason !== 'notPaginated' && target.reason !== 'noPageProjection') {
    throw new Error(`${operation} returned an invalid pending target reason`);
  }
  if (target.localPageIndex !== undefined || target.localSpreadIndex !== undefined) {
    throw new Error(`${operation} pending target included local page geometry`);
  }
}

function requireContinuation(value, owner, revision, targetLocator, operation) {
  const terminal = revision.status === 'complete' || revision.pageCapReached;
  if (value === undefined) {
    if (!terminal) throw new Error(`${operation} omitted an active local continuation`);
    return;
  }
  if (terminal) throw new Error(`${operation} returned a continuation after local completion`);
  requireChapterLocalCursor(value, operation, owner, {
    ...targetLocator,
    href: owner.coordinate.href,
  });
}

function requireExtent(value, operation) {
  const extent = requireRecord(value, operation);
  const localPageCount = requireCount(extent.localPageCount, `${operation} localPageCount`);
  const localSpreadCount = requireCount(extent.localSpreadCount, `${operation} localSpreadCount`);
  if (localSpreadCount > localPageCount) {
    throw new Error(`${operation} returned more local spreads than pages`);
  }
  return { localPageCount, localSpreadCount };
}

function requirePageRange(value, operation) {
  const range = requireRecord(value, `${operation} newly known pages`);
  const startLocalPage = requireCount(range.startLocalPage, `${operation} startLocalPage`);
  const endLocalPageExclusive = requireCount(
    range.endLocalPageExclusive,
    `${operation} endLocalPageExclusive`,
  );
  if (endLocalPageExclusive < startLocalPage) {
    throw new Error(`${operation} returned a reversed local page range`);
  }
  return { startLocalPage, endLocalPageExclusive };
}

function requireAdvanceExtents(previous, range, known, operation) {
  if (
    known.localPageCount < previous.localPageCount ||
    known.localSpreadCount < previous.localSpreadCount
  ) {
    throw new Error(`${operation} returned a shrinking local extent`);
  }
  if (
    range.startLocalPage !== previous.localPageCount ||
    range.endLocalPageExclusive !== known.localPageCount
  ) {
    throw new Error(`${operation} returned a local range inconsistent with its extents`);
  }
}

function sameExtent(left, right) {
  return (
    left.localPageCount === right.localPageCount && left.localSpreadCount === right.localSpreadCount
  );
}

function ownerFromSummary(summary) {
  return {
    revisionId: summary.revisionId,
    revisionVersion: summary.revisionVersion,
    coordinate: summary.coordinate,
  };
}
