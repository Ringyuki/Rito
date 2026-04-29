import { readReaderFootnote } from './footnote';
import { assertReaderRevisionReady, assertReaderSessionOpen } from './lifecycle';
import type { ReaderRevisionRecord } from './revision';
import type { ReaderFootnotePayload, ReaderRevisionId, ReaderSessionId } from './types';
import type { ReaderSessionFootnoteRequest } from './session';

export interface GetReaderSessionFootnoteInput {
  readonly sessionId: ReaderSessionId;
  readonly isDisposed: () => boolean;
  readonly revisions: ReadonlyMap<ReaderRevisionId, ReaderRevisionRecord>;
  readonly request: ReaderSessionFootnoteRequest;
}

export function getReaderSessionFootnote(
  input: GetReaderSessionFootnoteInput,
): Promise<ReaderFootnotePayload> {
  return Promise.resolve().then(() => {
    assertReaderSessionOpen(input.isDisposed(), input.sessionId, input.request.revisionId);
    const record = input.revisions.get(input.request.revisionId);
    assertReaderRevisionReady(record, input.sessionId, input.request.revisionId);
    return readReaderFootnote({
      sessionId: input.sessionId,
      revisionId: input.request.revisionId,
      record,
      ref: input.request.ref,
    });
  });
}
