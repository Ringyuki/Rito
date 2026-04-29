import type { Logger } from '../../utils/logger';
import type { ReleaseReaderResourceTransfers } from './resource';
import type { ReaderRevisionId, ReaderSessionId } from './types';

export interface ReleaseReaderResourceTransfersBestEffortInput {
  readonly releaseResourceTransfers?: ReleaseReaderResourceTransfers | undefined;
  readonly sessionId: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
  readonly logger?: Logger | undefined;
}

export function releaseReaderResourceTransfersBestEffort(
  input: ReleaseReaderResourceTransfersBestEffortInput,
): void {
  if (input.releaseResourceTransfers === undefined) return;
  try {
    input.releaseResourceTransfers({
      sessionId: input.sessionId,
      ...(input.revisionId !== undefined ? { revisionId: input.revisionId } : {}),
    });
  } catch (error) {
    input.logger?.warn('Reader resource transfer release failed', error);
  }
}
