import { createReaderSessionError, createReaderSessionProtocolError } from './errors';
import type { ReaderRevisionRecord } from './revision';
import type { ReaderRevisionId, ReaderSessionId } from './types';

export function assertReaderSessionOpen(
  disposed: boolean,
  sessionId: ReaderSessionId,
  revisionId?: ReaderRevisionId,
): void {
  if (!disposed) return;
  throw createReaderSessionError(
    sessionId,
    revisionId,
    'bad-request',
    'Reader session is disposed',
  );
}

export function assertReaderRevisionReady(
  record: ReaderRevisionRecord | undefined,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
): asserts record is ReaderRevisionRecord {
  if (!record) {
    throw createReaderSessionError(
      sessionId,
      revisionId,
      'not-found',
      `Revision ${revisionId} is not known`,
    );
  }
  if (record.revision.status === 'cancelled') {
    throw createReaderSessionError(
      sessionId,
      revisionId,
      'cancelled',
      `Revision ${revisionId} was cancelled`,
    );
  }
  if (record.revision.status === 'failed') {
    throw createReaderSessionProtocolError(
      sessionId,
      revisionId,
      record.error ?? {
        code: 'internal-error',
        message: `Revision ${revisionId} failed`,
      },
    );
  }
  if (record.revision.status !== 'ready' && record.revision.status !== 'complete') {
    throw createReaderSessionError(
      sessionId,
      revisionId,
      'bad-request',
      `Revision ${revisionId} is not ready`,
    );
  }
}
