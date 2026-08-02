import { requireSourceLocatorRequest } from './reader-worker-interaction-validation-runtime.js';

const RESOLVED_FIELDS = new Set(['status', 'revisionId', 'pageIndex', 'spreadIndex', 'locator']);
const UNAVAILABLE_FIELDS = new Set(['status', 'revisionId', 'pageIndex', 'spreadIndex', 'reason']);
const UNAVAILABLE_REASONS = new Set(['noSourceContent', 'sourceUnavailable']);

export function requirePageReadingAnchor(value, revision, pageIndex, operation) {
  const anchor = requireRecord(value, `${operation} page reading anchor`);
  if (anchor.status === 'resolved') {
    requireExactFields(anchor, RESOLVED_FIELDS, operation);
  } else if (anchor.status === 'unavailable') {
    requireExactFields(anchor, UNAVAILABLE_FIELDS, operation);
  } else {
    throw new Error(`${operation} returned an invalid page reading anchor status`);
  }
  if (anchor.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
  if (anchor.pageIndex !== pageIndex) {
    throw new Error(`${operation} returned a mismatched pageIndex`);
  }
  requireCount(anchor.spreadIndex, `${operation} spreadIndex`);
  if (anchor.status === 'resolved') {
    const locator = requireSourceLocatorRequest(anchor.locator, operation);
    // Text-free pages (cover plates, illustration spreads) resolve
    // through the engine's degradation ladder: a paint-target locator or
    // the page's chapter progression instead of an exact source point
    // (see rito-core runtime/source_locator.rs). The anchor must still
    // point somewhere.
    if (locator.sourcePoint === undefined && locator.progression === undefined) {
      throw new Error(
        `${operation} returned a reading anchor with neither a source point nor a progression`,
      );
    }
    if (locator.sourceRange !== undefined) {
      throw new Error(`${operation} returned a reading anchor with a source range`);
    }
  } else if (!UNAVAILABLE_REASONS.has(anchor.reason)) {
    throw new Error(`${operation} returned an invalid page reading anchor reason`);
  }
  return anchor;
}

function requireRecord(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${operation} must be an object`);
  }
  return value;
}

function requireExactFields(value, allowedFields, operation) {
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== 'string' || !allowedFields.has(field)) {
      throw new Error(`${operation} returned unknown field ${String(field)}`);
    }
  }
}

function requireCount(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${operation} must be a non-negative safe integer`);
  }
}
