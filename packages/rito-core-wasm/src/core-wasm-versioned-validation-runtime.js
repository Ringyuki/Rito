import { RitoCoreWasmError } from './core-wasm-error-runtime.js';
import { requireRequiredFontFaces } from './required-font-faces-validation-runtime.js';

export function requireObjectInput(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RitoCoreWasmError('bad-request', `${operation} input must be an object`);
  }
  return value;
}

export function requireFlatRevisionHandle(value, operation) {
  return requireRevisionHandle(
    { revisionId: value.revisionId, revisionVersion: value.revisionVersion },
    operation,
  );
}

export function requireRevisionHandle(value, operation = 'revision') {
  const handle = requireObjectInput(value, `${operation} revision`);
  if (typeof handle.revisionId !== 'string' || handle.revisionId.length === 0) {
    throw new RitoCoreWasmError(
      'bad-request',
      `${operation} revisionId must be a non-empty string`,
    );
  }
  if (
    !Number.isSafeInteger(handle.revisionVersion) ||
    handle.revisionVersion < 0 ||
    handle.revisionVersion > 0xffff_ffff
  ) {
    throw new RitoCoreWasmError(
      'bad-request',
      `${operation} revisionVersion must be an unsigned 32-bit integer`,
    );
  }
  return { revisionId: handle.revisionId, revisionVersion: handle.revisionVersion };
}

export function requireMatchingHandle(value, expected, operation) {
  const actual = requireRevisionHandle(value, operation);
  if (
    actual.revisionId !== expected.revisionId ||
    actual.revisionVersion !== expected.revisionVersion
  ) {
    throw new Error(`${operation} returned a mismatched revision handle`);
  }
  return actual;
}

export function requireMatchingRevisionSummary(value, expected, operation) {
  const handle = requireRevisionHandle(expected, `${operation} expected`);
  return requireRevisionSummary(value, operation, handle.revisionId, handle.revisionVersion);
}

export function requireRevisionTransferCount(value, operation) {
  if (!isSafeCount(value)) {
    throw new Error(`${operation} returned an invalid released transfer count`);
  }
  return value;
}

export function requireVersionedValueIdentity(value, revision, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  if (Object.prototype.hasOwnProperty.call(value, 'revision')) {
    requireMatchingHandle(value.revision, revision, `${operation} value revision`);
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'revisionId')) return;
  requireMatchingRevisionId(value, revision, `${operation} value`);
  if (Object.prototype.hasOwnProperty.call(value, 'revisionVersion')) {
    requireMatchingHandle(value, revision, `${operation} value`);
  }
}

export function requireRevisionBundle(value, revision, operation) {
  const bundle = requireObjectInput(value, `${operation} value`);
  requireMatchingRevisionSummary(bundle.revision, revision, `${operation} bundle`);
  for (const field of ['navigation', 'tocTargets', 'footnotes']) {
    requireMatchingRevisionId(bundle[field], revision, `${operation} ${field}`);
  }
  requireRequiredFontFaces(bundle.requiredFontFaces, revision.revisionId, operation);
  return bundle;
}

/**
 * A revision summary: identity, layout key and the page and spread counts
 * of its page table.
 */
export function requireRevisionSummary(
  value,
  operation,
  expectedRevisionId,
  expectedRevisionVersion,
) {
  const summary = requireObjectInput(value, `${operation} result revision`);
  const handle = requireRevisionHandle(summary, `${operation} result`);
  if (expectedRevisionId !== undefined && handle.revisionId !== expectedRevisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
  if (expectedRevisionVersion !== undefined && handle.revisionVersion !== expectedRevisionVersion) {
    throw new Error(`${operation} returned a non-sequential revisionVersion`);
  }
  if (typeof summary.layoutKey !== 'string' || summary.layoutKey.length === 0) {
    throw new Error(`${operation} returned an invalid revision layoutKey`);
  }
  for (const field of ['pageCount', 'spreadCount']) {
    if (!isSafeCount(summary[field])) {
      throw new Error(`${operation} returned an invalid revision ${field}`);
    }
  }
  if (summary.spreadCount > summary.pageCount) {
    throw new Error(`${operation} returned more spreads than pages`);
  }
  return summary;
}

export function parseObject(payload, operation) {
  let value;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `${operation} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} returned a non-object JSON payload`);
  }
  return value;
}

export function encodeJson(value, operation) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new RitoCoreWasmError(
      'bad-request',
      `${operation} input is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function requireMatchingRevisionId(value, revision, operation) {
  const record = requireObjectInput(value, operation);
  if (record.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
