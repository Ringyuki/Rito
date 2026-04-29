import type { ReaderProtocolErrorCode, ReaderRuntimeCommand } from './protocol';
import type { ReaderRevisionId, ReaderRuntimeRequestId, ReaderSessionId } from './types';

export type ReaderRuntimeOperation = ReaderRuntimeCommand['kind'];

export interface ReaderRuntimeOperationEvent {
  readonly kind: 'operation';
  readonly phase: 'start' | 'finish';
  readonly operation: ReaderRuntimeOperation;
  readonly requestId: ReaderRuntimeRequestId;
  readonly sessionId?: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
  readonly timestamp: number;
  readonly ok?: boolean;
  readonly errorCode?: ReaderProtocolErrorCode;
  readonly durationMs?: number;
}

export type ReaderRuntimeEvent = ReaderRuntimeOperationEvent;

export type ReaderRuntimeEventSink = (event: ReaderRuntimeEvent) => void;
