import type { ImageDimensions } from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { Logger } from '../../utils/logger';
import type { EpubDocument } from '../types';
import { dispatchCommand } from './dispatcher-commands';
import { createProtocolError } from './protocol-helpers';
import type { ReaderRuntimeCommand, ReaderRuntimeResponse } from './protocol';
import { READER_RUNTIME_PROTOCOL_VERSION } from './protocol';
import { failure, toProtocolError } from './dispatcher-response';
import { createSequentialSessionId } from './dispatcher-open';
import { createReaderSessionRegistry, type ReaderSessionRegistry } from './dispatcher-registry';
import type { BuildReaderSessionFrame, CreateReaderRevisionId } from './session';
import type { RegisterReaderSessionFonts } from './session-types';
import type { PaginateReaderRevision } from './revision';
import type { ReleaseReaderResourceTransfers, StoreReaderResourceTransfer } from './resource';
import type { ReaderSessionId } from './types';
import type { ReaderRuntimeEventSink, ReaderRuntimeOperationEvent } from './telemetry';

export interface CreateReaderRuntimeDispatcherInput {
  readonly openPublication: (publicationRef: string) => Promise<EpubDocument>;
  readonly createTextMeasurer: (document: EpubDocument) => TextMeasurer;
  readonly storeResourceTransfer: StoreReaderResourceTransfer;
  readonly releaseResourceTransfers: ReleaseReaderResourceTransfers;
  readonly createSessionId?: () => ReaderSessionId;
  readonly createRevisionId?: CreateReaderRevisionId;
  readonly loadImageDimensions?: (
    document: EpubDocument,
  ) => Promise<ReadonlyMap<string, ImageDimensions>>;
  readonly paginateRevision?: PaginateReaderRevision;
  readonly buildFrame?: BuildReaderSessionFrame;
  readonly registerFonts?: RegisterReaderSessionFonts;
  readonly onRuntimeEvent?: ReaderRuntimeEventSink;
  readonly now?: () => number;
  readonly logger?: Logger;
}

export interface ReaderRuntimeDispatcher {
  handleCommand(command: ReaderRuntimeCommand): Promise<ReaderRuntimeResponse>;
  dispose(): void;
}

export interface DispatcherState {
  readonly deps: CreateReaderRuntimeDispatcherInput;
  readonly registry: ReaderSessionRegistry;
  readonly createSessionId: () => ReaderSessionId;
  readonly now: () => number;
}

export function createReaderRuntimeDispatcher(
  deps: CreateReaderRuntimeDispatcherInput,
): ReaderRuntimeDispatcher {
  const state: DispatcherState = {
    deps,
    registry: createReaderSessionRegistry(deps.logger),
    createSessionId: deps.createSessionId ?? createSequentialSessionId(),
    now: deps.now ?? Date.now,
  };

  return {
    handleCommand(command) {
      return handleCommand(state, command);
    },
    dispose() {
      disposeDispatcher(state);
    },
  };
}

function handleCommand(
  state: DispatcherState,
  command: ReaderRuntimeCommand,
): Promise<ReaderRuntimeResponse> {
  const startedAt = state.now();
  emitOperationEvent(state, createOperationStartEvent(command, startedAt));
  return Promise.resolve()
    .then(async () => {
      if (state.registry.isDisposed()) {
        return failure(
          command,
          createProtocolError('bad-request', 'Reader runtime dispatcher is disposed'),
        );
      }
      const runtimeCommand = command as { readonly protocolVersion: number };
      if (runtimeCommand.protocolVersion !== READER_RUNTIME_PROTOCOL_VERSION) {
        return failure(command, createProtocolError('bad-request', 'Unsupported protocol version'));
      }
      return dispatchCommand(state, command);
    })
    .catch((error: unknown) => {
      return failure(command, toProtocolError(error));
    })
    .then((response) => {
      emitOperationEvent(
        state,
        createOperationFinishEvent(command, response, startedAt, state.now()),
      );
      return response;
    });
}

function disposeDispatcher(state: DispatcherState): void {
  state.registry.dispose();
}

function createOperationStartEvent(
  command: ReaderRuntimeCommand,
  timestamp: number,
): ReaderRuntimeOperationEvent {
  return {
    kind: 'operation',
    phase: 'start',
    operation: command.kind,
    requestId: command.requestId,
    ...(command.sessionId !== undefined ? { sessionId: command.sessionId } : {}),
    ...(command.revisionId !== undefined ? { revisionId: command.revisionId } : {}),
    timestamp,
  };
}

function createOperationFinishEvent(
  command: ReaderRuntimeCommand,
  response: ReaderRuntimeResponse,
  startedAt: number,
  finishedAt: number,
): ReaderRuntimeOperationEvent {
  return {
    kind: 'operation',
    phase: 'finish',
    operation: command.kind,
    requestId: command.requestId,
    ...(response.sessionId !== undefined ? { sessionId: response.sessionId } : {}),
    ...(response.revisionId !== undefined ? { revisionId: response.revisionId } : {}),
    timestamp: finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    ok: response.ok,
    ...(!response.ok ? { errorCode: response.error.code } : {}),
  };
}

function emitOperationEvent(state: DispatcherState, event: ReaderRuntimeOperationEvent): void {
  try {
    state.deps.onRuntimeEvent?.(event);
  } catch (error) {
    state.deps.logger?.warn('Reader runtime event sink failed', error);
  }
}
