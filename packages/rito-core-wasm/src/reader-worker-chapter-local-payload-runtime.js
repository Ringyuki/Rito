import { requireReaderChapterLocalFrame } from './chapter-local-frame-validation-runtime.js';
import { requireChapterLocalRelease } from './chapter-local-creation-validation-runtime.js';
import { requireChapterLocalOwner } from './chapter-local-owner-validation-runtime.js';

const MUTATION_KINDS = new Set(['createBoundedChapterLocalRevision']);

export function chapterLocalReaderWorkerPayload(document, request) {
  switch (request.kind) {
    case 'createBoundedChapterLocalRevision':
      return mutationResponse(
        document,
        request.kind,
        document.createBoundedChapterLocalRevision(request.request),
      );
    case 'releaseChapterLocalRevision':
      return {
        kind: request.kind,
        result: document.releaseChapterLocalRevision(request.owner),
      };
    default:
      return undefined;
  }
}

export function chapterLocalResponseTransfers(payload) {
  if (!MUTATION_KINDS.has(payload?.kind)) return [];
  const frame = payload.result?.frame;
  if (!(frame?.bytes instanceof Uint8Array) || !Array.isArray(frame.resources)) return [];
  return Array.from(
    new Set([
      frame.bytes.buffer,
      ...frame.resources
        .map((resource) => resource?.bytes)
        .filter((bytes) => bytes instanceof Uint8Array)
        .map((bytes) => bytes.buffer),
    ]),
  );
}

function mutationResponse(document, kind, created) {
  let owner;
  try {
    owner = requireChapterLocalOwner(created.revision, `${kind} result`);
  } catch (error) {
    // A committed revision without a valid owner identity can never be
    // released; free the document so its ownership cannot leak silently.
    // Clients treat every typed mutation error as already contained here.
    try {
      document.free();
    } catch {
      // Preserve the identity failure after best-effort containment.
    }
    throw error;
  }
  try {
    const frame = resolvedFrame(document, created, owner, kind);
    return { kind, result: { created, ...(frame === undefined ? {} : { frame }) } };
  } catch (error) {
    containCommittedOwner(document, owner);
    throw error;
  }
}

function resolvedFrame(document, created, owner, operation) {
  if (created.target.status !== 'resolved') return undefined;
  const localSpreadIndex = created.target.localSpreadIndex;
  const buffer = document.readChapterLocalFrame(owner, localSpreadIndex);
  const resources = document.prefetchChapterLocalFrameResources(owner, localSpreadIndex);
  return requireReaderChapterLocalFrame(
    { ...buffer, ...resources },
    owner,
    localSpreadIndex,
    `${operation} aggregate`,
  );
}

function containCommittedOwner(document, owner) {
  try {
    const release = requireChapterLocalRelease(
      document.releaseChapterLocalRevision(owner),
      owner,
      'chapter-local aggregate rollback',
    );
    if (release.releasedRevision === true) return;
  } catch {
    // Fall through to document disposal when exact rollback is unconfirmed.
  }
  try {
    document.free();
  } catch {
    // Preserve the aggregate construction failure after best-effort containment.
  }
}
