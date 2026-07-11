export function requirePageIndex(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${operation} pageIndex must be a non-negative safe integer`);
  }
  return value;
}

export function requireFootnoteKey(value, operation) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${operation} key must be a non-empty string`);
  }
  return value;
}

export function requireLocatorRequest(value, operation) {
  const request = requireRecord(value, `${operation} locator`);
  if (typeof request.href !== 'string' || request.href.length === 0) {
    throw new TypeError(`${operation} locator href must be a non-empty string`);
  }
  return { href: request.href };
}

export function requireSourceLocatorRequest(value, operation) {
  return requireSourceLocator(value, operation);
}

export function requirePageTargets(value, revision, pageIndex, operation) {
  const targets = requireRecord(value, `${operation} result`);
  requireRevisionId(targets, revision, operation);
  if (targets.pageIndex !== pageIndex) {
    throw new Error(`${operation} returned a mismatched pageIndex`);
  }
  requireCount(targets.spreadIndex, `${operation} spreadIndex`);
  if (!Array.isArray(targets.entries)) {
    throw new Error(`${operation} returned malformed page target entries`);
  }
  for (const entry of targets.entries) requirePageTarget(entry, operation);
  requireCount(targets.entryCount, `${operation} entryCount`);
  if (targets.entryCount !== targets.entries.length) {
    throw new Error(`${operation} returned an inconsistent entryCount`);
  }
  if (typeof targets.textHash !== 'string' || targets.textHash.length === 0) {
    throw new Error(`${operation} returned an invalid textHash`);
  }
  return targets;
}

function requirePageTarget(value, operation) {
  const target = requireRecord(value, `${operation} page target`);
  if (!['text', 'link', 'image', 'footnote'].includes(target.kind)) {
    throw new Error(`${operation} returned an invalid page target kind`);
  }
  requireBounds(target.bounds, `${operation} page target bounds`);
  for (const field of ['blockIndex', 'lineIndex', 'runIndex']) {
    requireCount(target[field], `${operation} page target ${field}`);
  }
  if (typeof target.label !== 'string') {
    throw new Error(`${operation} returned an invalid page target label`);
  }
  requireTextSummary(target.text, operation);
  requireOptionalString(target, 'href', operation, false);
  requireOptionalString(target, 'imageSrc', operation, true);
  requireOptionalString(target, 'imageAlt', operation, false);
  requireOptionalString(target, 'footnoteKey', operation, true);
  if (target.sourceLocator !== undefined) requireSourceLocator(target.sourceLocator, operation);
  if (target.targetLocator !== undefined) requireSourceLocator(target.targetLocator, operation);
  requireTargetSemantics(target, operation);
}

function requireBounds(value, operation) {
  const bounds = requireRecord(value, operation);
  for (const field of ['x', 'y']) {
    if (!Number.isFinite(bounds[field])) {
      throw new Error(`${operation} returned an invalid ${field}`);
    }
  }
  for (const field of ['width', 'height']) {
    if (!Number.isFinite(bounds[field]) || bounds[field] < 0) {
      throw new Error(`${operation} returned an invalid ${field}`);
    }
  }
}

function requireTextSummary(value, operation) {
  const text = requireRecord(value, `${operation} page target text`);
  if (typeof text.hash !== 'string' || text.hash.length === 0) {
    throw new Error(`${operation} returned an invalid page target text hash`);
  }
  requireCount(text.length, `${operation} page target text length`);
}

function requireOptionalString(record, field, operation, nonEmpty) {
  const value = record[field];
  if (value === undefined) return;
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
    throw new Error(`${operation} returned an invalid page target ${field}`);
  }
}

function requireTargetSemantics(target, operation) {
  if (target.kind === 'footnote') {
    if (target.href === undefined || target.footnoteKey === undefined) {
      throw new Error(`${operation} returned an incomplete footnote target`);
    }
    if (target.targetLocator === undefined) {
      throw new Error(`${operation} returned a footnote target without a destination`);
    }
    return;
  }
  if (target.footnoteKey !== undefined) {
    throw new Error(`${operation} returned a footnote key for a non-footnote target`);
  }
  if (target.kind === 'link' && target.href === undefined) {
    throw new Error(`${operation} returned a link target without href`);
  }
  if (target.kind === 'image' && target.imageSrc === undefined) {
    throw new Error(`${operation} returned an image target without imageSrc`);
  }
  if (
    target.kind === 'image' &&
    (target.href !== undefined || target.targetLocator !== undefined)
  ) {
    throw new Error(`${operation} returned link fields on a standalone image target`);
  }
  if (
    target.kind === 'text' &&
    (target.href !== undefined ||
      target.targetLocator !== undefined ||
      target.imageSrc !== undefined)
  ) {
    throw new Error(`${operation} returned interactive fields on a text target`);
  }
}

function requireSourceLocator(value, operation) {
  const locator = requireRecord(value, `${operation} source locator`);
  if (typeof locator.href !== 'string' || locator.href.length === 0) {
    throw new Error(`${operation} returned an invalid source locator href`);
  }
  requireOptionalLocatorString(locator, 'anchorId', operation);
  if (locator.sourcePoint !== undefined) requireSourcePoint(locator.sourcePoint, operation);
  if (locator.sourceRange !== undefined) {
    const range = requireRecord(locator.sourceRange, `${operation} source range`);
    requireSourcePoint(range.start, operation);
    requireSourcePoint(range.end, operation);
  }
  if (
    locator.progression !== undefined &&
    (!Number.isFinite(locator.progression) || locator.progression < 0 || locator.progression > 1)
  ) {
    throw new Error(`${operation} returned an invalid source locator progression`);
  }
  return locator;
}

function requireOptionalLocatorString(locator, field, operation) {
  if (locator[field] !== undefined && typeof locator[field] !== 'string') {
    throw new Error(`${operation} returned an invalid source locator ${field}`);
  }
}

function requireSourcePoint(value, operation) {
  const point = requireRecord(value, `${operation} source point`);
  if (!Array.isArray(point.nodePath) || point.nodePath.some((part) => !isCount(part))) {
    throw new Error(`${operation} returned an invalid source node path`);
  }
  requireCount(point.textOffset, `${operation} source text offset`);
}

export function requireFootnote(value, revision, key, operation) {
  const footnote = requireRecord(value, `${operation} result`);
  requireRevisionId(footnote, revision, operation);
  if (footnote.key !== key) throw new Error(`${operation} returned a mismatched footnote key`);
  if (!['footnote', 'endnote', 'rearnote', 'note'].includes(footnote.kind)) {
    throw new Error(`${operation} returned an invalid footnote kind`);
  }
  if (typeof footnote.text !== 'string' || typeof footnote.html !== 'string') {
    throw new Error(`${operation} returned invalid footnote content`);
  }
  return footnote;
}

export function requireResolvedLocator(value, revision, request, operation) {
  const resolved = requireRecord(value, `${operation} result`);
  requireRevisionId(resolved, revision, operation);
  if (resolved.href !== request.href) {
    throw new Error(`${operation} returned a mismatched locator href`);
  }
  if (typeof resolved.spineIdref !== 'string' || resolved.spineIdref.length === 0) {
    throw new Error(`${operation} returned an invalid spineIdref`);
  }
  requireCount(resolved.pageIndex, `${operation} pageIndex`);
  requireCount(resolved.spreadIndex, `${operation} spreadIndex`);
  const hashIndex = request.href.indexOf('#');
  const expectedFragment = hashIndex < 0 ? undefined : request.href.slice(hashIndex + 1);
  if (resolved.fragment !== expectedFragment) {
    throw new Error(`${operation} returned a mismatched locator fragment`);
  }
  return resolved;
}

export function requireSourceLocatorResolution(value, revision, operation) {
  const resolution = requireRecord(value, `${operation} result`);
  requireRevisionId(resolution, revision, operation);
  if (resolution.status !== 'resolved' && resolution.status !== 'pending') {
    throw new Error(`${operation} returned an invalid source locator status`);
  }
  requireSourceLocator(resolution.locator, operation);
  if (typeof resolution.spineIdref !== 'string' || resolution.spineIdref.length === 0) {
    throw new Error(`${operation} returned an invalid source locator spineIdref`);
  }
  if (
    !['sourceRange', 'sourcePoint', 'anchor', 'progression', 'href'].includes(resolution.matchedBy)
  ) {
    throw new Error(`${operation} returned an invalid source locator match kind`);
  }
  if (resolution.status === 'resolved') {
    requireCount(resolution.pageIndex, `${operation} pageIndex`);
    requireCount(resolution.spreadIndex, `${operation} spreadIndex`);
    if (resolution.reason !== undefined) {
      throw new Error(`${operation} returned a pending reason for a resolved source locator`);
    }
  } else {
    if (!['notPaginated', 'noPageProjection'].includes(resolution.reason)) {
      throw new Error(`${operation} returned an invalid pending source locator reason`);
    }
    if (resolution.pageIndex !== undefined || resolution.spreadIndex !== undefined) {
      throw new Error(`${operation} returned page geometry for a pending source locator`);
    }
  }
  return resolution;
}

function requireRevisionId(value, revision, operation) {
  if (value.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
}

function requireCount(value, operation) {
  if (!isCount(value)) {
    throw new Error(`${operation} must be a non-negative safe integer`);
  }
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function requireRecord(value, operation) {
  if (!isRecord(value)) throw new TypeError(`${operation} must be an object`);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
