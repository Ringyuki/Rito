export class RitoCoreWasmError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'RitoCoreWasmError';
    this.code = code;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    if (
      code === 'engine-error' &&
      options.revision?.status === 'failed' &&
      isRitoCoreWasmRevisionSummary(options.revision)
    ) {
      this.revision = options.revision;
    }
  }
}

export function normalizeRitoCoreWasmError(error, operation = 'RitoCoreWasm') {
  if (error instanceof RitoCoreWasmError) {
    return error;
  }
  const payload = parseRitoCoreWasmErrorPayload(error);
  if (payload !== undefined) {
    return new RitoCoreWasmError(payload.code, payload.message, {
      cause: error,
      revision: payload.revision,
    });
  }
  if (error instanceof Error) {
    return new RitoCoreWasmError('internal-error', `${operation} failed: ${error.message}`, {
      cause: error,
    });
  }
  return new RitoCoreWasmError('internal-error', `${operation} failed: ${String(error)}`, {
    cause: error,
  });
}

export function callRitoCoreWasm(operation, callback) {
  try {
    return callback();
  } catch (error) {
    throw normalizeRitoCoreWasmError(error, operation);
  }
}

function parseRitoCoreWasmErrorPayload(error) {
  const text =
    typeof error === 'string' ? error : error instanceof Error ? error.message : undefined;
  if (text === undefined) {
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  if (!isRitoCoreWasmErrorCode(value.code) || typeof value.message !== 'string') {
    return undefined;
  }
  return {
    code: value.code,
    message: value.message,
    revision:
      value.code === 'engine-error' &&
      value.revision?.status === 'failed' &&
      isRitoCoreWasmRevisionSummary(value.revision)
        ? value.revision
        : undefined,
  };
}

function isRitoCoreWasmErrorCode(value) {
  return (
    value === 'bad-request' ||
    value === 'engine-error' ||
    value === 'internal-error' ||
    value === 'unknown-revision' ||
    value === 'stale-revision-version'
  );
}

export function isRitoCoreWasmRevisionSummary(value) {
  return (
    isRecord(value) &&
    isNonemptyString(value.revisionId) &&
    isRevisionVersion(value.revisionVersion) &&
    isNonemptyString(value.layoutKey) &&
    isRitoCoreWasmRevisionStatus(value.status) &&
    isRitoCoreWasmRevisionExtent(value.knownExtent) &&
    (value.finalExtent === undefined || isRitoCoreWasmRevisionExtent(value.finalExtent)) &&
    isSafeCount(value.pageCount) &&
    isSafeCount(value.spreadCount) &&
    value.pageCount === value.knownExtent.pageCount &&
    value.spreadCount === value.knownExtent.spreadCount &&
    hasValidFinalRevisionExtent(value.status, value.knownExtent, value.finalExtent)
  );
}

function hasValidFinalRevisionExtent(status, knownExtent, finalExtent) {
  if (status !== 'complete') {
    return finalExtent === undefined;
  }
  return (
    isRitoCoreWasmRevisionExtent(finalExtent) &&
    finalExtent.pageCount === knownExtent.pageCount &&
    finalExtent.spreadCount === knownExtent.spreadCount
  );
}

function isRitoCoreWasmRevisionExtent(value) {
  return (
    isRecord(value) &&
    isSafeCount(value.pageCount) &&
    isSafeCount(value.spreadCount) &&
    value.spreadCount <= value.pageCount
  );
}

function isRitoCoreWasmRevisionStatus(value) {
  return (
    value === 'warming' ||
    value === 'ready' ||
    value === 'complete' ||
    value === 'cancelled' ||
    value === 'failed'
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRevisionVersion(value) {
  return isSafeCount(value) && value <= 0xffff_ffff;
}
