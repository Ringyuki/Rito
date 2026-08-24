import {
  requireChapterLocalRelease,
  requireContinuedChapterLocalAdvance,
  requireCreatedChapterLocalAdvance,
} from './chapter-local-advance-validation-runtime.js';
import { requireReaderChapterLocalFrame } from './chapter-local-frame-validation-runtime.js';
import { RitoCoreWasmError } from './core-wasm-error-runtime.js';
import {
  nextChapterLocalOwner,
  requireBoundedChapterLocalRequest,
  requireChapterLocalOwner,
  requireContinueChapterLocalRequest,
  requireRecord,
} from './chapter-local-owner-validation-runtime.js';

export function createChapterLocalReaderClientMethods(send, disposeInvalid) {
  return {
    createBoundedChapterLocalRevision: (request) => {
      const operation = 'createBoundedChapterLocalRevision';
      const normalized = requireBoundedChapterLocalRequest(request, operation);
      return mutationResult(
        send,
        disposeInvalid,
        operation,
        { kind: operation, request: normalized.request },
        undefined,
        (value, bindOwner) =>
          requireCreatedChapterLocalAdvance(
            value,
            normalized.request,
            normalized.maximum,
            `${operation} response`,
            bindOwner,
          ),
      );
    },
    continueChapterLocalRevision: (request) => {
      const operation = 'continueChapterLocalRevision';
      const normalized = requireContinueChapterLocalRequest(request, operation);
      const rollbackOwner = nextChapterLocalOwner(normalized.request.continuation.owner, operation);
      return mutationResult(
        send,
        disposeInvalid,
        operation,
        { kind: operation, request: normalized.request },
        rollbackOwner,
        (value, bindOwner) =>
          requireContinuedChapterLocalAdvance(
            value,
            normalized.request,
            normalized.maximum,
            `${operation} response`,
            bindOwner,
          ),
      );
    },
    releaseChapterLocalRevision: async (owner) => {
      const operation = 'releaseChapterLocalRevision';
      const exactOwner = requireChapterLocalOwner(owner, operation);
      try {
        const payload = await send({ kind: operation, owner: exactOwner });
        if (payload?.kind !== operation) {
          throw new Error(`Rito reader worker returned ${String(payload?.kind)} for ${operation}`);
        }
        const release = requireChapterLocalRelease(payload.result, exactOwner, operation);
        if (!release.releasedRevision) {
          throw new Error(`${operation} did not confirm its exact owner release`);
        }
        return release;
      } catch (error) {
        bestEffortDispose(disposeInvalid);
        throw error;
      }
    },
  };
}

async function mutationResult(
  send,
  disposeInvalid,
  kind,
  request,
  fallbackRollbackOwner,
  validateAdvance,
) {
  let boundOwner;
  try {
    const payload = await send(request);
    if (payload?.kind !== kind) {
      throw new Error(`Rito reader worker returned ${String(payload?.kind)} for ${kind}`);
    }
    const result = requireRecord(payload.result, `${kind} response result`);
    if (!Object.hasOwn(result, 'advance')) {
      throw new Error(`${kind} response omitted its committed advance`);
    }
    const advance = validateAdvance(result.advance, (owner) => {
      boundOwner = owner;
    });
    const frame = requireMutationFrame(result.frame, advance, boundOwner, kind);
    return { advance, ...(frame === undefined ? {} : { frame }) };
  } catch (error) {
    // A typed worker error proves the worker answered in protocol: its payload
    // runtime already rolled back (or fail-closed) the mutation's own owner.
    // Disposing the shared session here would let an optional chapter-local
    // failure kill the reader that the main navigation still needs.
    if (error instanceof RitoCoreWasmError) throw error;
    const rollbackOwner = fallbackRollbackOwner ?? boundOwner;
    if (
      rollbackOwner === undefined ||
      !(await rollbackCommittedChapterLocalOwner(send, rollbackOwner))
    ) {
      bestEffortDispose(disposeInvalid);
    }
    throw error;
  }
}

function requireMutationFrame(value, advance, owner, operation) {
  if (owner === undefined) throw new Error(`${operation} response did not bind an exact owner`);
  if (advance.target.status === 'resolved') {
    if (value === undefined) {
      throw new Error(`${operation} response omitted its resolved packed frame`);
    }
    return requireReaderChapterLocalFrame(
      value,
      owner,
      advance.target.localSpreadIndex,
      `${operation} response`,
    );
  }
  if (value !== undefined) {
    throw new Error(`${operation} response attached a frame to a pending target`);
  }
  return undefined;
}

async function rollbackCommittedChapterLocalOwner(send, owner) {
  try {
    const payload = await send({ kind: 'releaseChapterLocalRevision', owner });
    if (payload?.kind !== 'releaseChapterLocalRevision') return false;
    const release = requireChapterLocalRelease(
      payload.result,
      owner,
      'committed chapter-local rollback',
    );
    return release.releasedRevision === true;
  } catch {
    return false;
  }
}

function bestEffortDispose(disposeInvalid) {
  try {
    disposeInvalid?.();
  } catch {
    // Preserve the malformed response after best-effort session containment.
  }
}
