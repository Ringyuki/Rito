import type { ImageDimensions } from '../../layout/core/types';
import { createProtocolError } from './protocol-helpers';
import type { ReaderRuntimeCommand, ReaderRuntimeResponse } from './protocol';
import {
  errorMessage,
  failure,
  openSessionSuccess,
  publicationFromDocument,
} from './dispatcher-response';
import type { DispatcherState } from './dispatcher';
import { createReaderSession } from './session';
import type { ReaderSessionId } from './types';
import type { EpubDocument } from '../types';

type OpenSessionRuntimeCommand = Extract<ReaderRuntimeCommand, { readonly kind: 'openSession' }>;

export async function openSessionCommand(
  state: DispatcherState,
  command: OpenSessionRuntimeCommand,
): Promise<ReaderRuntimeResponse> {
  const sessionId = state.createSessionId();
  const reservation = state.registry.reserve(sessionId);
  if (!reservation.ok) {
    return reservation.reason === 'disposed'
      ? dispatcherDisposedFailure(command)
      : sessionIdCollisionFailure(command, sessionId);
  }

  let document: EpubDocument;
  try {
    document = await state.deps.openPublication(command.payload.publicationRef);
  } catch (error) {
    state.registry.releasePending(sessionId);
    if (isDispatcherDisposed(state)) {
      return dispatcherDisposedFailure(command);
    }
    return openPublicationFailure(command, error);
  }

  if (isDispatcherDisposed(state)) {
    return closeDocumentAfterDispatcherDisposed(state, command, sessionId, document);
  }

  return createAndRegisterSession(state, command, sessionId, document);
}

async function createAndRegisterSession(
  state: DispatcherState,
  command: OpenSessionRuntimeCommand,
  sessionId: ReaderSessionId,
  document: EpubDocument,
): Promise<ReaderRuntimeResponse> {
  try {
    const images = await state.deps.loadImageDimensions?.(document);
    if (isDispatcherDisposed(state)) {
      return closeDocumentAfterDispatcherDisposed(state, command, sessionId, document);
    }
    const session = createOpenedSession(state, sessionId, document, images);
    const commit = state.registry.commit(sessionId, session);
    if (!commit.ok) {
      return commit.reason === 'disposed'
        ? dispatcherDisposedFailure(command)
        : sessionIdCollisionFailure(command, sessionId);
    }
    return openSessionSuccess(command, sessionId, publicationFromDocument(document));
  } catch (error) {
    state.registry.releasePending(sessionId);
    tryCloseDocument(document);
    if (isDispatcherDisposed(state)) {
      return dispatcherDisposedFailure(command);
    }
    return createSessionFailure(command, error);
  }
}

function createOpenedSession(
  state: DispatcherState,
  sessionId: ReaderSessionId,
  document: EpubDocument,
  images: ReadonlyMap<string, ImageDimensions> | undefined,
): ReturnType<typeof createReaderSession> {
  return createReaderSession({
    sessionId,
    document,
    measurer: state.deps.createTextMeasurer(document),
    storeResourceTransfer: state.deps.storeResourceTransfer,
    releaseResourceTransfers: state.deps.releaseResourceTransfers,
    ...(images !== undefined ? { images } : {}),
    ...(state.deps.createRevisionId !== undefined
      ? { createRevisionId: state.deps.createRevisionId }
      : {}),
    ...(state.deps.paginateRevision !== undefined
      ? { paginateRevision: state.deps.paginateRevision }
      : {}),
    ...(state.deps.buildFrame !== undefined ? { buildFrame: state.deps.buildFrame } : {}),
    ...(state.deps.registerFonts !== undefined ? { registerFonts: state.deps.registerFonts } : {}),
    ...(state.deps.logger !== undefined ? { logger: state.deps.logger } : {}),
  });
}

function isDispatcherDisposed(state: DispatcherState): boolean {
  return state.registry.isDisposed();
}

function closeDocumentAfterDispatcherDisposed(
  state: DispatcherState,
  command: OpenSessionRuntimeCommand,
  sessionId: ReaderSessionId,
  document: EpubDocument,
): ReaderRuntimeResponse {
  state.registry.releasePending(sessionId);
  tryCloseDocument(document);
  return dispatcherDisposedFailure(command);
}

function dispatcherDisposedFailure(command: OpenSessionRuntimeCommand): ReaderRuntimeResponse {
  return failure(
    command,
    createProtocolError('bad-request', 'Reader runtime dispatcher is disposed'),
  );
}

function sessionIdCollisionFailure(
  command: OpenSessionRuntimeCommand,
  sessionId: ReaderSessionId,
): ReaderRuntimeResponse {
  return failure(command, createProtocolError('internal-error', `Session id ${sessionId} exists`), {
    sessionId,
  });
}

function tryCloseDocument(document: EpubDocument): void {
  try {
    document.close();
  } catch {
    // Best-effort cleanup. The dispatcher returns the original command error.
  }
}

function openPublicationFailure(
  command: OpenSessionRuntimeCommand,
  error: unknown,
): ReaderRuntimeResponse {
  return failure(
    command,
    createProtocolError('internal-error', 'Failed to open publication', {
      details: { cause: errorMessage(error) },
    }),
  );
}

function createSessionFailure(
  command: OpenSessionRuntimeCommand,
  error: unknown,
): ReaderRuntimeResponse {
  return failure(
    command,
    createProtocolError('internal-error', 'Failed to create reader session', {
      details: { cause: errorMessage(error) },
    }),
  );
}

export function createSequentialSessionId(): () => ReaderSessionId {
  let next = 1;
  return () => `session-${String(next++)}`;
}
