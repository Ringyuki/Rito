import type { SpineItem } from '../../parser/epub/types';
import { assertReaderRevisionReady, assertReaderSessionOpen } from './lifecycle';
import type { ReaderRevisionRecord } from './revision';
import { searchReaderRevision } from './search';
import type { ReaderRevisionId, ReaderSessionId, SearchBatch, SearchRequest } from './types';

export interface ReaderSessionSearchRequest extends SearchRequest {
  readonly revisionId: ReaderRevisionId;
}

export interface SearchReaderSessionTextInput {
  readonly sessionId: ReaderSessionId;
  readonly isDisposed: () => boolean;
  readonly revisions: ReadonlyMap<ReaderRevisionId, ReaderRevisionRecord>;
  readonly request: ReaderSessionSearchRequest;
  readonly spine: readonly SpineItem[];
  readonly manifestHrefs: ReadonlyMap<string, string>;
  readonly manifestMediaTypes: ReadonlyMap<string, string>;
}

export function searchReaderSessionText(input: SearchReaderSessionTextInput): Promise<SearchBatch> {
  return Promise.resolve().then(() => {
    assertReaderSessionOpen(input.isDisposed(), input.sessionId, input.request.revisionId);
    const record = input.revisions.get(input.request.revisionId);
    assertReaderRevisionReady(record, input.sessionId, input.request.revisionId);
    return searchReaderRevision({
      sessionId: input.sessionId,
      record,
      request: input.request,
      spine: input.spine,
      manifestHrefs: input.manifestHrefs,
      manifestMediaTypes: input.manifestMediaTypes,
    });
  });
}

export function buildManifestMediaTypeMap(
  manifest: ReadonlyArray<{ readonly id: string; readonly mediaType: string }>,
): ReadonlyMap<string, string> {
  const mediaTypes = new Map<string, string>();
  for (const item of manifest) {
    mediaTypes.set(item.id, item.mediaType);
  }
  return mediaTypes;
}
