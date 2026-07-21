import {
  requireObjectInput,
  requireRevisionTransferCount,
  requireRevisionWorkBudget,
} from './core-wasm-versioned-validation-runtime.js';
import {
  requireMatchingSourceLocatorRequest,
  requireSourceLocatorRequest,
} from './reader-worker-interaction-validation-runtime.js';

const MAX_LOCAL_PAGE_CAP = 16;
const MAX_LOCAL_QUANTA = 16;

export function requireChapterLocalOwner(value, operation) {
  const owner = requireRecord(value, `${operation} owner`);
  const revisionId = requireNonEmptyString(owner.revisionId, `${operation} revisionId`);
  const revisionVersion = requireU32(owner.revisionVersion, `${operation} revisionVersion`);
  const coordinate = requireChapterLocalCoordinate(owner.coordinate, operation);
  return { revisionId, revisionVersion, coordinate };
}

export function requireMatchingChapterLocalOwner(value, expected, operation) {
  const owner = requireChapterLocalOwner(value, operation);
  if (!sameChapterLocalOwner(owner, expected)) {
    throw new Error(`${operation} returned a mismatched chapter-local owner`);
  }
  return owner;
}

export function sameChapterLocalOwner(left, right) {
  return (
    left.revisionId === right.revisionId &&
    left.revisionVersion === right.revisionVersion &&
    left.coordinate.kind === right.coordinate.kind &&
    left.coordinate.chapterIndex === right.coordinate.chapterIndex &&
    left.coordinate.href === right.coordinate.href
  );
}

export function nextChapterLocalOwner(owner, operation) {
  const current = requireChapterLocalOwner(owner, operation);
  if (current.revisionVersion === 0xffff_ffff) {
    throw new Error(`${operation} cannot advance revisionVersion beyond u32`);
  }
  return { ...current, revisionVersion: current.revisionVersion + 1 };
}

export function requireBoundedChapterLocalRequest(value, operation) {
  const request = requireObjectInput(value, operation);
  requireRecord(request.layoutConfig, `${operation} layoutConfig`);
  const targetChapterIndex = requireCount(
    request.targetChapterIndex,
    `${operation} targetChapterIndex`,
  );
  const targetLocator = canonicalChapterLocalTarget(
    requireSourceLocatorRequest(request.targetLocator, operation),
    operation,
  );
  const localPageCap = requireLocalPageCap(request.localPageCap, request.layoutConfig, operation);
  const nodesPerQuantum = requireRevisionWorkBudget(request.budget, operation);
  const maxQuanta = requireLocalQuanta(request.maxQuanta, operation);
  const lineBreaking = requireLineBreaking(request.lineBreaking, operation);
  return {
    request: {
      layoutConfig: request.layoutConfig,
      ...(lineBreaking === undefined ? {} : { lineBreaking }),
      targetChapterIndex,
      targetLocator,
      localPageCap,
      budget: { maxTopLevelNodes: nodesPerQuantum },
      ...(maxQuanta === undefined ? {} : { maxQuanta }),
    },
    maximum: nodesPerQuantum * (maxQuanta ?? 1),
  };
}

export function requireContinueChapterLocalRequest(value, operation) {
  const request = requireObjectInput(value, operation);
  const continuation = requireChapterLocalCursor(request.continuation, operation);
  const nodesPerQuantum = requireRevisionWorkBudget(request.budget, operation);
  const maxQuanta = requireLocalQuanta(request.maxQuanta, operation);
  return {
    request: {
      continuation,
      budget: { maxTopLevelNodes: nodesPerQuantum },
      ...(maxQuanta === undefined ? {} : { maxQuanta }),
    },
    maximum: nodesPerQuantum * (maxQuanta ?? 1),
  };
}

export function requireChapterLocalCursor(value, operation, expectedOwner, expectedLocator) {
  const cursor = requireRecord(value, `${operation} continuation`);
  const owner =
    expectedOwner === undefined
      ? requireChapterLocalOwner(cursor.owner, `${operation} continuation`)
      : requireMatchingChapterLocalOwner(cursor.owner, expectedOwner, `${operation} continuation`);
  const token = requireNonEmptyString(cursor.cursor, `${operation} continuation cursor`);
  const targetLocator = requireSourceLocatorRequest(
    cursor.targetLocator,
    `${operation} continuation`,
  );
  if (expectedLocator !== undefined) {
    requireMatchingSourceLocatorRequest(
      targetLocator,
      expectedLocator,
      `${operation} continuation`,
    );
  }
  return { owner, cursor: token, targetLocator };
}

export function canonicalChapterLocalTarget(locator, operation = 'chapter-local target') {
  const fragmentAt = locator.href.indexOf('#');
  const href = fragmentAt < 0 ? locator.href : locator.href.slice(0, fragmentAt);
  const encodedFragment = fragmentAt < 0 ? undefined : locator.href.slice(fragmentAt + 1);
  const fragment = encodedFragment ? decodeFragment(encodedFragment) : undefined;
  if (fragment !== undefined && locator.anchorId !== undefined && locator.anchorId !== fragment) {
    throw new Error(`${operation} anchorId does not match its legacy href fragment`);
  }
  if (locator.sourcePoint !== undefined && locator.sourceRange !== undefined) {
    throw new Error(`${operation} sourcePoint and sourceRange are mutually exclusive`);
  }
  return {
    ...locator,
    href,
    ...(locator.anchorId === undefined && fragment ? { anchorId: fragment } : {}),
  };
}

function decodeFragment(fragment) {
  if (!fragment.includes('%')) return fragment;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function requireChapterLocalIndex(value, operation) {
  return requireCount(value, operation);
}

export function requireChapterLocalTransferCount(value, operation) {
  return requireRevisionTransferCount(value, operation);
}

export function requireRecord(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} must be an object`);
  }
  return value;
}

export function requireCount(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${operation} must be a non-negative safe integer`);
  }
  return value;
}

export function requireNonEmptyString(value, operation) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${operation} must be a non-empty string`);
  }
  return value;
}

function requireChapterLocalCoordinate(value, operation) {
  const coordinate = requireRecord(value, `${operation} coordinate`);
  if (coordinate.kind !== 'chapterLocal') {
    throw new Error(`${operation} owner is not in chapter-local coordinate space`);
  }
  const chapterIndex = requireCount(coordinate.chapterIndex, `${operation} chapterIndex`);
  const href = requireNonEmptyString(coordinate.href, `${operation} chapter href`);
  if (href.includes('#')) {
    throw new Error(`${operation} chapter-local coordinate href must be canonical`);
  }
  return { kind: 'chapterLocal', chapterIndex, href };
}

function requireU32(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${operation} must be an unsigned 32-bit integer`);
  }
  return value;
}

function requireLocalPageCap(value, layoutConfig, operation) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LOCAL_PAGE_CAP) {
    throw new Error(`${operation} localPageCap must be within 1..=${MAX_LOCAL_PAGE_CAP}`);
  }
  if (layoutConfig.spreadMode === 'double' && (value < 2 || value % 2 !== 0)) {
    throw new Error(`${operation} localPageCap must cover complete double spreads`);
  }
  return value;
}

function requireLineBreaking(value, operation) {
  if (value === undefined || value === 'greedy' || value === 'optimal') return value;
  throw new Error(`${operation} lineBreaking must be greedy or optimal`);
}

function requireLocalQuanta(value, operation) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LOCAL_QUANTA) {
    throw new Error(`${operation} maxQuanta must be within 1..=${MAX_LOCAL_QUANTA}`);
  }
  return value;
}
