import {
  requireExactTextCount,
  requireExactTextRecord,
} from './reader-worker-exact-text-interaction-validation-runtime.js';
import { requireWellFormedExactTextUtf16 } from './reader-worker-exact-text-range-validation-runtime.js';

const ANNOTATION_TARGET_VERSION = 1;
const RESOLVED_LEVELS = new Set(['exact', 'quote', 'position', 'progression']);
const ORPHAN_REASONS = new Set(['hrefNotFound', 'emptyChapter']);

export function requireAnnotationTargetRequest(value, operation) {
  const request = requireExactKeys(value, ['href', 'sourceRange'], `${operation} request`);
  return {
    href: requireHref(request.href, operation),
    sourceRange: requireSourceRange(request.sourceRange, `${operation} sourceRange`),
  };
}

/** Rebuilds a target in the engine's field order, rejecting any other shape. */
export function requireAnnotationTarget(value, operation) {
  const target = requireExactKeys(
    value,
    ['version', 'href', 'sourceRange', 'quote', 'position'],
    `${operation} target`,
  );
  if (target.version !== ANNOTATION_TARGET_VERSION) {
    throw new Error(`${operation} target version must be ${String(ANNOTATION_TARGET_VERSION)}`);
  }
  const quote = requireExactKeys(target.quote, ['exact', 'prefix', 'suffix'], `${operation} quote`);
  const position = requireExactKeys(
    target.position,
    ['start', 'end', 'chapterLength'],
    `${operation} position`,
  );
  return {
    version: ANNOTATION_TARGET_VERSION,
    href: requireHref(target.href, operation),
    sourceRange: requireSourceRange(target.sourceRange, `${operation} sourceRange`),
    quote: {
      exact: requireText(quote.exact, `${operation} quote exact`),
      prefix: requireText(quote.prefix, `${operation} quote prefix`),
      suffix: requireText(quote.suffix, `${operation} quote suffix`),
    },
    position: {
      start: requireExactTextCount(position.start, `${operation} position start`),
      end: requireExactTextCount(position.end, `${operation} position end`),
      chapterLength: requireExactTextCount(
        position.chapterLength,
        `${operation} position chapterLength`,
      ),
    },
  };
}

export function requireAnnotationTargetResolution(value, operation) {
  const resolution = requireExactTextRecord(value, `${operation} resolution`);
  if (RESOLVED_LEVELS.has(resolution.level)) {
    requireExactKeys(resolution, ['level', 'target'], `${operation} resolution`);
    return {
      level: resolution.level,
      target: requireAnnotationTarget(resolution.target, operation),
    };
  }
  if (resolution.level === 'orphaned') {
    requireExactKeys(resolution, ['level', 'reason'], `${operation} resolution`);
    if (!ORPHAN_REASONS.has(resolution.reason)) {
      throw new Error(`${operation} returned an invalid orphan reason`);
    }
    return { level: 'orphaned', reason: resolution.reason };
  }
  throw new Error(`${operation} returned an invalid annotation resolution level`);
}

/** The engine canonicalizes the href, so only the target's own shape is checked. */
export function requireCreatedAnnotationTarget(value, operation) {
  const target = requireAnnotationTarget(value, operation);
  if (target.position.start >= target.position.end) {
    throw new Error(`${operation} returned an empty annotation target`);
  }
  return target;
}

export function requireAnnotationTargetTransport(value, expectedRequest, operation) {
  const transport = requireExactKeys(value, ['request', 'response'], `${operation} transport`);
  const request = requireAnnotationTargetRequest(transport.request, operation);
  if (JSON.stringify(request) !== JSON.stringify(expectedRequest)) {
    throw new Error(`${operation} returned a target for a mismatched request`);
  }
  return requireCreatedAnnotationTarget(transport.response, operation);
}

export function requireAnnotationResolutionTransport(value, expectedTarget, operation) {
  const transport = requireExactKeys(value, ['target', 'response'], `${operation} transport`);
  const target = requireAnnotationTarget(transport.target, operation);
  if (JSON.stringify(target) !== JSON.stringify(expectedTarget)) {
    throw new Error(`${operation} returned a resolution for a mismatched target`);
  }
  return requireAnnotationTargetResolution(transport.response, operation);
}

function requireExactKeys(value, keys, operation) {
  const record = requireExactTextRecord(value, operation);
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new Error(`${operation} has an unknown field ${key}`);
  }
  for (const key of keys) {
    if (record[key] === undefined) throw new Error(`${operation} is missing ${key}`);
  }
  return record;
}

function requireHref(value, operation) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${operation} href must be a non-empty string`);
  }
  return value;
}

function requireText(value, operation) {
  if (typeof value !== 'string') throw new TypeError(`${operation} must be a string`);
  requireWellFormedExactTextUtf16(value, operation);
  return value;
}

function requireSourceRange(value, operation) {
  const range = requireExactKeys(value, ['start', 'end'], operation);
  return {
    start: requireSourcePoint(range.start, `${operation} start`),
    end: requireSourcePoint(range.end, `${operation} end`),
  };
}

function requireSourcePoint(value, operation) {
  const point = requireExactKeys(value, ['nodePath', 'textOffset'], operation);
  if (!Array.isArray(point.nodePath)) {
    throw new TypeError(`${operation} nodePath must be an array`);
  }
  return {
    nodePath: point.nodePath.map((part) => requireExactTextCount(part, `${operation} nodePath`)),
    textOffset: requireExactTextCount(point.textOffset, `${operation} textOffset`),
  };
}
