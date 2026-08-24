import {
  requireExactTextCount,
  requireExactTextRecord,
} from './reader-worker-exact-text-interaction-validation-runtime.js';
import { requireSourceLocatorRequest } from './reader-worker-interaction-validation-runtime.js';

export function requireExactTextRangeSource(range, operation) {
  const sourceSpan = requireTextSourceSpan(range.sourceSpan, operation);
  const sourceLocator =
    range.sourceLocator === undefined
      ? undefined
      : requireSourceLocatorRequest(range.sourceLocator, `${operation} range`);
  requireCompatibleSourceLocator(sourceSpan, sourceLocator, operation);
  return { sourceSpan, ...(sourceLocator === undefined ? {} : { sourceLocator }) };
}

function requireTextSourceSpan(value, operation) {
  const span = requireExactTextRecord(value, `${operation} source span`);
  requireSourceFields(span, new Set(['start', 'end']), `${operation} source span`);
  return {
    start: requireTextSourceSpanEndpoint(span.start, `${operation} source span start`),
    end: requireTextSourceSpanEndpoint(span.end, `${operation} source span end`),
  };
}

function requireTextSourceSpanEndpoint(value, operation) {
  const endpoint = requireExactTextRecord(value, operation);
  requireSourceFields(endpoint, new Set(['href', 'sourcePoint']), operation);
  if (typeof endpoint.href !== 'string' || endpoint.href.length === 0) {
    throw new Error(`${operation} returned an invalid href`);
  }
  return {
    href: endpoint.href,
    sourcePoint: requireTextSourcePoint(endpoint.sourcePoint, operation),
  };
}

function requireTextSourcePoint(value, operation) {
  const point = requireExactTextRecord(value, `${operation} source point`);
  requireSourceFields(point, new Set(['nodePath', 'textOffset']), `${operation} source point`);
  if (!Array.isArray(point.nodePath)) {
    throw new Error(`${operation} returned an invalid source node path`);
  }
  const nodePath = point.nodePath.map((part) =>
    requireExactTextCount(part, `${operation} source node path part`),
  );
  return {
    nodePath,
    textOffset: requireExactTextCount(point.textOffset, `${operation} source text offset`),
  };
}

function requireCompatibleSourceLocator(span, locator, operation) {
  const sameResource = span.start.href === span.end.href;
  if (!sameResource) {
    if (locator !== undefined) {
      throw new Error(`${operation} returned a source locator for a cross-resource source span`);
    }
    return;
  }
  const sourceRange = locator?.sourceRange;
  if (
    !locator ||
    locator.href !== span.start.href ||
    sourceRange === undefined ||
    locator.sourcePoint !== undefined ||
    locator.anchorId !== undefined ||
    locator.progression !== undefined ||
    !sameSourcePoint(sourceRange.start, span.start.sourcePoint) ||
    !sameSourcePoint(sourceRange.end, span.end.sourcePoint)
  ) {
    throw new Error(`${operation} returned an incompatible exact source locator`);
  }
}

function sameSourcePoint(left, right) {
  return (
    left.textOffset === right.textOffset &&
    left.nodePath.length === right.nodePath.length &&
    left.nodePath.every((part, index) => part === right.nodePath[index])
  );
}

function requireSourceFields(value, allowedFields, operation) {
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== 'string' || !allowedFields.has(field)) {
      throw new Error(`${operation} returned unknown field ${String(field)}`);
    }
  }
}
