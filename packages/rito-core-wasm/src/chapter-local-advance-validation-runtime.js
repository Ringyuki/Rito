import {
  requireMatchingSourceLocatorRequest,
  requireSourceLocatorRequest,
} from './reader-worker-interaction-validation-runtime.js';
import {
  canonicalChapterLocalTarget,
  requireChapterLocalOwner,
  requireChapterLocalTransferCount,
  requireCount,
  requireMatchingChapterLocalOwner,
  requireNonEmptyString,
  requireRecord,
} from './chapter-local-owner-validation-runtime.js';

const MATCH_KINDS = new Set(['sourceRange', 'sourcePoint', 'anchor', 'progression', 'href']);

/**
 * A chapter-local advance: the chapter paginated whole in one pass, so the
 * revision is complete and its page range covers the entire chapter.
 */
export function requireCreatedChapterLocalAdvance(value, request, operation, bindOwner) {
  const advance = requireRecord(value, `${operation} advance`);
  const targetLocator = canonicalChapterLocalTarget(request.targetLocator, operation);
  const revision = requireChapterLocalSummary(
    advance.revision,
    { revisionVersion: 0, chapterIndex: request.targetChapterIndex },
    operation,
  );
  const owner = ownerFromSummary(revision);
  bindOwner?.(owner);
  const range = requirePageRange(advance.newlyKnownLocalPages, operation);
  if (
    range.startLocalPage !== 0 ||
    range.endLocalPageExclusive !== revision.knownExtent.localPageCount
  ) {
    throw new Error(`${operation} returned a local range inconsistent with its extent`);
  }
  requireTarget(advance.target, owner, revision.knownExtent, targetLocator, operation);
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

function requireChapterLocalSummary(value, expected, operation) {
  const summary = requireRecord(value, `${operation} revision`);
  const owner = requireChapterLocalOwner(summary, `${operation} revision`);
  requireExpectedOwner(owner, expected, operation);
  requireNonEmptyString(summary.layoutKey, `${operation} layoutKey`);
  if (summary.status !== 'complete') {
    throw new Error(`${operation} returned an incomplete chapter-local revision`);
  }
  const knownExtent = requireExtent(summary.knownExtent, `${operation} known extent`);
  const finalExtent = requireExtent(summary.finalExtent, `${operation} final extent`);
  if (!sameExtent(finalExtent, knownExtent)) {
    throw new Error(`${operation} returned a mismatched final local extent`);
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
