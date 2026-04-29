import type { Logger } from '../../utils/logger';
import type { EpubDocument } from '../types';
import { assertReaderRevisionReady, assertReaderSessionOpen } from './lifecycle';
import type { ReaderRevisionRecord } from './revision';
import {
  readReaderResource,
  type ReleaseReaderResourceTransfers,
  type StoreReaderResourceTransfer,
} from './resource';
import { releaseReaderResourceTransfersBestEffort } from './resource-lifecycle';
import type {
  ReaderResourcePayload,
  ReaderResourceRef,
  ReaderRevisionId,
  ReaderSessionId,
} from './types';

export interface GetReaderSessionResourceInput {
  readonly sessionId: ReaderSessionId;
  readonly isDisposed: () => boolean;
  readonly revisions: ReadonlyMap<ReaderRevisionId, ReaderRevisionRecord>;
  readonly revisionId: ReaderRevisionId;
  readonly document: EpubDocument;
  readonly resource: ReaderResourceRef;
  readonly storeResourceTransfer?: StoreReaderResourceTransfer;
}

export interface ReleaseSessionResourceTransfersInput {
  readonly sessionId: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
  readonly releaseResourceTransfers?: ReleaseReaderResourceTransfers;
  readonly logger?: Logger;
}

export function getReaderSessionResource(
  input: GetReaderSessionResourceInput,
): Promise<ReaderResourcePayload> {
  return Promise.resolve().then(() => {
    assertReaderSessionOpen(input.isDisposed(), input.sessionId, input.revisionId);
    const record = input.revisions.get(input.revisionId);
    assertReaderRevisionReady(record, input.sessionId, input.revisionId);
    return readReaderResource({
      sessionId: input.sessionId,
      revisionId: record.revision.id,
      document: input.document,
      resource: input.resource,
      ...(input.storeResourceTransfer !== undefined
        ? { storeTransfer: input.storeResourceTransfer }
        : {}),
    });
  });
}

export function releaseSessionResourceTransfers(input: ReleaseSessionResourceTransfersInput): void {
  releaseReaderResourceTransfersBestEffort({
    releaseResourceTransfers: input.releaseResourceTransfers,
    sessionId: input.sessionId,
    ...(input.revisionId !== undefined ? { revisionId: input.revisionId } : {}),
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  });
}
