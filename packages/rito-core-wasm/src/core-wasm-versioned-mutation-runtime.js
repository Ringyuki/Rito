import {
  encodeJson,
  parseObject,
  requireRevisionHandle,
  requireRevisionSummary,
} from './core-wasm-versioned-validation-runtime.js';

/** Creates a revision; the result is its summary at version zero. */
export function runRevisionMutation(document, rawMethod, operation, input) {
  return runCommittedMutation(document, rawMethod, operation, input, undefined, (result) =>
    requireRevisionSummary(result, operation, undefined, 0),
  );
}

function runCommittedMutation(document, rawMethod, operation, input, fallbackHandle, validate) {
  const rawPayload = document._inner[rawMethod](encodeJson(input, operation));
  return validateCommittedMutation(
    rawPayload,
    operation,
    fallbackHandle,
    (revision) =>
      document._inner.releaseRevisionAtRevision(revision.revisionId, revision.revisionVersion),
    validate,
  );
}

function validateCommittedMutation(rawPayload, operation, fallbackHandle, release, validate) {
  let result;
  try {
    result = parseObject(rawPayload, operation);
    return validate(result);
  } catch (error) {
    const handle = fallbackHandle ?? recoverRevisionHandle(result);
    if (handle !== undefined) bestEffortRelease(handle, release);
    throw error;
  }
}

function recoverRevisionHandle(value) {
  try {
    return requireRevisionHandle(value, 'committed revision rollback');
  } catch {
    return undefined;
  }
}

function bestEffortRelease(handle, release) {
  try {
    release(handle);
  } catch {
    // Preserve the schema failure; exact rollback is best effort.
  }
}
