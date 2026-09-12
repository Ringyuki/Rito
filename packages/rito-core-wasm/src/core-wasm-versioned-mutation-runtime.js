import {
  encodeJson,
  parseObject,
  requireRevisionAdvance,
  requireRevisionHandle,
  requireRevisionSummary,
} from './core-wasm-versioned-validation-runtime.js';

export function runBoundedMutation(document, rawMethod, operation, input) {
  return runCommittedMutation(document, rawMethod, operation, input, undefined, (result) => {
    const revision = requireRevisionSummary(result.revision, operation, undefined, 0);
    return requireRevisionAdvance(result, revision, operation);
  });
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
    const handle = fallbackHandle ?? recoverRevisionHandle(result?.revision);
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
