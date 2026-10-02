export class RitoCoreWasmError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'RitoCoreWasmError';
    this.code = code;
    // The content shards to supply before retrying; present exactly for
    // `resource-pending`.
    if (code === 'resource-pending') {
      this.pendingShards = requirePendingShards(options.pendingShards);
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Shard ids are positive 32-bit integers; a pending failure names at least one. */
export function requirePendingShards(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((id) => Number.isInteger(id) && id > 0 && id <= 0xffff_ffff)
  ) {
    throw new TypeError('a resource-pending failure must name its shards');
  }
  return Object.freeze([...value]);
}

export function normalizeRitoCoreWasmError(error, operation = 'RitoCoreWasm') {
  if (error instanceof RitoCoreWasmError) {
    return error;
  }
  const payload = parseRitoCoreWasmErrorPayload(error);
  if (payload !== undefined) {
    return new RitoCoreWasmError(payload.code, payload.message, {
      cause: error,
      pendingShards: payload.pendingShards,
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
  if (value.code === 'resource-pending') {
    return { code: value.code, message: value.message, pendingShards: value.pendingShards };
  }
  return { code: value.code, message: value.message };
}

function isRitoCoreWasmErrorCode(value) {
  return (
    value === 'bad-request' ||
    value === 'engine-error' ||
    value === 'internal-error' ||
    value === 'unknown-revision' ||
    value === 'stale-revision-version' ||
    value === 'resource-pending'
  );
}
