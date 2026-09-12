import {
  encodeJson,
  parseObject,
  requireInitialRevisionAdvance,
  requireRevisionAdvance,
  requireRevisionHandle,
  requireRevisionSummary,
} from './core-wasm-versioned-validation-runtime.js';

export function runBoundedMutation(
  document,
  rawMethod,
  operation,
  input,
  maximum,
  expectedRevisionId,
  expectedRevisionVersion,
) {
  const fallback =
    expectedRevisionId === undefined
      ? undefined
      : { revisionId: expectedRevisionId, revisionVersion: expectedRevisionVersion };
  return runCommittedMutation(document, rawMethod, operation, input, fallback, (result) => {
    const revision = requireRevisionSummary(
      result.revision,
      operation,
      fallback?.revisionId,
      fallback?.revisionVersion ?? 0,
    );
    return operation === 'createBoundedRevision'
      ? requireInitialRevisionAdvance(result, revision, operation, maximum)
      : requireRevisionAdvance(result, revision, operation, maximum);
  });
}

export function runCancelMutation(document, input, handle) {
  const next = { revisionId: handle.revisionId, revisionVersion: handle.revisionVersion + 1 };
  return runCommittedMutation(
    document,
    'cancelRevisionJson',
    'cancelRevision',
    input,
    next,
    (result) =>
      requireRevisionSummary(
        result,
        'cancelRevision',
        next.revisionId,
        next.revisionVersion,
        'cancelled',
      ),
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
