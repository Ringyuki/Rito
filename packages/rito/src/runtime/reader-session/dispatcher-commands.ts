import type { DispatcherState } from './dispatcher';
import { openSessionCommand } from './dispatcher-open';
import {
  failure,
  revisionEnvelope,
  sessionEnvelope,
  toProtocolError,
  unknownSession,
} from './dispatcher-response';
import type {
  CancelRevisionResponse,
  CloseSessionResponse,
  CreateRevisionResponse,
  GetFootnoteResponse,
  GetResourceResponse,
  GetSpreadFrameResponse,
  PrefetchResponse,
  ReaderRuntimeCommand,
  ReaderRuntimeResponse,
  ResolveLocatorGeometryResponse,
  ResolveLocatorResponse,
  SearchResponse,
} from './protocol';
import type { ReaderSession } from './session';
import type { ReaderSessionId } from './types';

export async function dispatchCommand(
  state: DispatcherState,
  command: ReaderRuntimeCommand,
): Promise<ReaderRuntimeResponse> {
  switch (command.kind) {
    case 'openSession':
      return openSessionCommand(state, command);
    case 'createRevision':
      return createRevision(state, command);
    case 'cancelRevision':
      return cancelRevision(state, command);
    case 'resolveLocator':
      return resolveLocator(state, command);
    case 'resolveLocatorGeometry':
      return resolveLocatorGeometry(state, command);
    case 'getSpreadFrame':
      return getSpreadFrame(state, command);
    case 'getResource':
      return getResource(state, command);
    case 'prefetch':
      return prefetch(state, command);
    case 'search':
      return search(state, command);
    case 'getFootnote':
      return getFootnote(state, command);
    case 'closeSession':
      return closeSession(state, command);
  }
}

async function createRevision(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'createRevision' }>,
): Promise<ReaderRuntimeResponse> {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    const revision = await session.createRevision(command.payload);
    return {
      ...sessionEnvelope(command),
      revisionId: revision.id,
      kind: 'createRevision',
      ok: true,
      payload: { revision },
    } satisfies CreateRevisionResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

function cancelRevision(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'cancelRevision' }>,
): ReaderRuntimeResponse {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    session.cancelRevision(command.revisionId);
    return {
      ...revisionEnvelope(command),
      kind: 'cancelRevision',
      ok: true,
      payload: { cancelled: true },
    } satisfies CancelRevisionResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

async function resolveLocator(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'resolveLocator' }>,
): Promise<ReaderRuntimeResponse> {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    const resolved = await session.resolveLocator({
      revisionId: command.revisionId,
      locator: command.payload.locator,
    });
    return {
      ...revisionEnvelope(command),
      kind: 'resolveLocator',
      ok: true,
      payload: resolved,
    } satisfies ResolveLocatorResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

async function resolveLocatorGeometry(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'resolveLocatorGeometry' }>,
): Promise<ReaderRuntimeResponse> {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    const payload = await session.resolveLocatorGeometry({
      revisionId: command.revisionId,
      locator: command.payload.locator,
    });
    return {
      ...revisionEnvelope(command),
      kind: 'resolveLocatorGeometry',
      ok: true,
      payload,
    } satisfies ResolveLocatorGeometryResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

async function getSpreadFrame(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'getSpreadFrame' }>,
): Promise<ReaderRuntimeResponse> {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    const frame = await session.getSpreadFrame({
      revisionId: command.revisionId,
      spreadIndex: command.payload.spreadIndex,
    });
    return {
      ...revisionEnvelope(command),
      kind: 'getSpreadFrame',
      ok: true,
      payload: { frame },
    } satisfies GetSpreadFrameResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

async function getResource(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'getResource' }>,
): Promise<ReaderRuntimeResponse> {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    const payload = await session.getResource({
      revisionId: command.revisionId,
      resource: command.payload.resource,
    });
    return {
      ...revisionEnvelope(command),
      kind: 'getResource',
      ok: true,
      payload,
    } satisfies GetResourceResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

async function getFootnote(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'getFootnote' }>,
): Promise<ReaderRuntimeResponse> {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    const payload = await session.getFootnote({
      revisionId: command.revisionId,
      ref: command.payload.ref,
    });
    return {
      ...revisionEnvelope(command),
      kind: 'getFootnote',
      ok: true,
      payload,
    } satisfies GetFootnoteResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

async function prefetch(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'prefetch' }>,
): Promise<ReaderRuntimeResponse> {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    const spreadIndexes = await session.prefetch({
      revisionId: command.revisionId,
      spreadIndexes: command.payload.spreadIndexes,
    });
    return {
      ...revisionEnvelope(command),
      kind: 'prefetch',
      ok: true,
      payload: { spreadIndexes },
    } satisfies PrefetchResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

async function search(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'search' }>,
): Promise<ReaderRuntimeResponse> {
  const session = getSession(state, command);
  if (!session) return unknownSession(command);
  try {
    const payload = await session.search({
      ...command.payload,
      revisionId: command.revisionId,
    });
    return {
      ...revisionEnvelope(command),
      kind: 'search',
      ok: true,
      payload,
    } satisfies SearchResponse;
  } catch (error) {
    return failure(command, toProtocolError(error));
  }
}

function closeSession(
  state: DispatcherState,
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'closeSession' }>,
): ReaderRuntimeResponse {
  const result = state.registry.close(command.sessionId);
  if (!result.ok && result.reason === 'not-found') return unknownSession(command);
  if (!result.ok) throw result.error;
  return {
    ...sessionEnvelope(command),
    kind: 'closeSession',
    ok: true,
    payload: { closed: true },
  } satisfies CloseSessionResponse;
}

function getSession(
  state: DispatcherState,
  command: ReaderRuntimeCommand & { readonly sessionId: ReaderSessionId },
): ReaderSession | undefined {
  return state.registry.get(command.sessionId);
}
