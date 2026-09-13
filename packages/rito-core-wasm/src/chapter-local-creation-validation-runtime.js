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
 * A created chapter-local revision: the summary of the chapter's page table
 * and the requested locator resolved against it.
 */
export function requireCreatedChapterLocalRevision(value, request, operation, bindOwner) {
  const created = requireRecord(value, `${operation} created revision`);
  const targetLocator = canonicalChapterLocalTarget(request.targetLocator, operation);
  const revision = requireChapterLocalSummary(
    created.revision,
    { revisionVersion: 0, chapterIndex: request.targetChapterIndex },
    operation,
  );
  const owner = ownerFromSummary(revision);
  bindOwner?.(owner);
  requireTarget(created.target, owner, revision, targetLocator, operation);
  return created;
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

function requireChapterLocalSummary(value, expected, operation) {
  const summary = requireRecord(value, `${operation} revision`);
  const owner = requireChapterLocalOwner(summary, `${operation} revision`);
  requireExpectedOwner(owner, expected, operation);
  requireNonEmptyString(summary.layoutKey, `${operation} layoutKey`);
  const localPageCount = requireCount(summary.localPageCount, `${operation} localPageCount`);
  const localSpreadCount = requireCount(summary.localSpreadCount, `${operation} localSpreadCount`);
  if (localSpreadCount > localPageCount) {
    throw new Error(`${operation} returned more local spreads than pages`);
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

function requireTarget(value, owner, summary, expectedLocator, operation) {
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
    if (page >= summary.localPageCount || spread >= summary.localSpreadCount) {
      throw new Error(`${operation} resolved target lies outside its local extent`);
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

function ownerFromSummary(summary) {
  return {
    revisionId: summary.revisionId,
    revisionVersion: summary.revisionVersion,
    coordinate: summary.coordinate,
  };
}
