import {
  copyRitoReaderWireBytes,
  decodeRitoReaderArtifactIdentity,
} from './reader-session-artifact-decoder-runtime.js';
import { encodeRitoReaderAdjacentRequest } from './reader-session-request-runtime.js';
import {
  decodeRitoReaderForegroundHandoffAck,
  encodeRitoReaderForegroundHandoff,
} from './reader-session-foreground-runtime.js';
import {
  encodeRitoReaderAnnotationRequest,
  encodeRitoReaderExactSourceRangeRequest,
  encodeRitoReaderNavigationRequest,
  encodeRitoReaderSearchRequest,
  encodeRitoReaderTextInteractionRequest,
  encodeRitoReaderTextRangeRequest,
} from './reader-session-query-request-runtime.js';

/**
 * The reader-session operations beyond pagination, in the worker. Queries
 * are read-only: the worker encodes the request, Core answers with one
 * owned message, and the client decodes it. A peek publishes an artifact
 * outside the foreground lane; committing it is a visible-artifact
 * compare-and-swap that supersedes any pending foreground candidate.
 *
 * Returns `undefined` for a message kind this module does not handle.
 */
export function handleRitoReaderSessionQuery(state, message, guards) {
  const { session } = state;
  switch (message.kind) {
    case 'peek-adjacent':
      guards.requireArtifactCapacity(state);
      guards.requireOwnedArtifact(state, message.request.fromArtifactId);
      return peekedArtifactResponse(
        state,
        guards,
        message.request,
        session.peekAdjacent(encodeRitoReaderAdjacentRequest(message.request)),
      );
    case 'commit-peeked-artifact':
      guards.requireOwnedArtifact(state, message.request.candidateArtifactId);
      return committedPeekResponse(
        state,
        guards,
        message.request,
        session.commitPeekedArtifact(encodeRitoReaderForegroundHandoff(message.request)),
      );
    case 'read-footnote':
      guards.requireOwnedArtifact(state, message.artifactId);
      return wireResponse('read-footnote', session.readFootnote(message.artifactId, message.key));
    case 'search':
      guards.requireOwnedArtifact(state, message.request.artifactId);
      return wireResponse('search', session.search(encodeRitoReaderSearchRequest(message.request)));
    case 'text-range-geometry':
      guards.requireOwnedArtifact(state, message.request.artifactId);
      return wireResponse(
        'text-range-geometry',
        session.textRangeGeometry(encodeRitoReaderTextRangeRequest(message.request)),
      );
    case 'exact-source-range':
      guards.requireOwnedArtifact(state, message.request.artifactId);
      return wireResponse(
        'exact-source-range',
        session.exactSourceRange(encodeRitoReaderExactSourceRangeRequest(message.request)),
      );
    case 'text-interaction':
      guards.requireOwnedArtifact(state, message.request.artifactId);
      return wireResponse(
        'text-interaction',
        session.textInteraction(encodeRitoReaderTextInteractionRequest(message.request)),
      );
    case 'annotation':
      return wireResponse(
        'annotation',
        session.annotation(encodeRitoReaderAnnotationRequest(message.request)),
      );
    case 'navigation': {
      const { query } = message.request;
      if (query.kind === 'toc-entry-at-page' || query.kind === 'locate') {
        guards.requireOwnedArtifact(state, query.artifactId);
      }
      return wireResponse(
        'navigation',
        session.navigation(encodeRitoReaderNavigationRequest(message.request)),
      );
    }
    default:
      return undefined;
  }
}

function wireResponse(kind, raw) {
  const wire = copyRitoReaderWireBytes(raw).buffer;
  return { payload: { kind, wire }, transfer: [wire] };
}

function peekedArtifactResponse(state, guards, request, raw) {
  const wireBytes = copyRitoReaderWireBytes(raw);
  const identity = decodeRitoReaderArtifactIdentity(wireBytes);
  if (identity.sessionId !== state.sessionId || identity.requestId !== request.requestId) {
    try {
      state.session.releaseArtifact(identity.artifactId);
    } catch {
      // Preserve the identity error; session disposal releases the remainder.
    }
    throw guards.workerError('invalid-wire', 'Peeked artifact identity does not match its request');
  }
  state.liveArtifacts.add(identity.artifactId);
  state.peekedArtifacts.set(identity.artifactId, identity.requestId);
  const wire = wireBytes.buffer;
  return { payload: { kind: 'artifact', identity, wire }, transfer: [wire] };
}

// Core has already swapped the visible artifact when its acknowledgement is
// read, so an unreadable or contradictory one leaves the worker's view of
// the session unknowable and the session fails closed.
function committedPeekResponse(state, guards, request, raw) {
  let wireBytes;
  let ack;
  try {
    wireBytes = copyRitoReaderWireBytes(raw);
    ack = decodeRitoReaderForegroundHandoffAck(wireBytes);
  } catch {
    guards.disposeTerminalSession(state);
    throw guards.workerError('engine-failure', 'Peek commit acknowledgement is unreadable');
  }
  const peekRequestId = state.peekedArtifacts.get(request.candidateArtifactId);
  if (
    peekRequestId === undefined ||
    state.visibleArtifactId !== request.expectedVisibleArtifactId ||
    ack.intentRequestId !== peekRequestId ||
    ack.replacedArtifactId !== request.expectedVisibleArtifactId ||
    ack.visibleArtifactId !== request.candidateArtifactId
  ) {
    guards.disposeTerminalSession(state);
    throw guards.workerError('invalid-wire', 'Peek commit acknowledgement is invalid');
  }
  state.visibleArtifactId = request.candidateArtifactId;
  state.peekedArtifacts.delete(request.candidateArtifactId);
  state.foregroundArtifactRequests.clear();
  const wire = wireBytes.buffer;
  return { payload: { kind: 'foreground-handoff', wire }, transfer: [wire] };
}
