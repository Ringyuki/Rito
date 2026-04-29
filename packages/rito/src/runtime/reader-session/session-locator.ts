import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { SpineItem } from '../../parser/epub/types';
import { assertReaderRevisionReady, assertReaderSessionOpen } from './lifecycle';
import { resolveReaderLocator } from './locator';
import { resolveReaderLocatorGeometry } from './locator-geometry';
import type { ReaderRevisionRecord } from './revision';
import type {
  ReaderRevisionId,
  ReaderSessionId,
  ResolvedLocator,
  ResolvedLocatorGeometry,
} from './types';
import type {
  ReaderSessionResolveLocatorGeometryRequest,
  ReaderSessionResolveLocatorRequest,
} from './session';

export interface ResolveReaderSessionLocatorInput {
  readonly sessionId: ReaderSessionId;
  readonly isDisposed: () => boolean;
  readonly revisions: ReadonlyMap<ReaderRevisionId, ReaderRevisionRecord>;
  readonly request: ReaderSessionResolveLocatorRequest;
  readonly spine: readonly SpineItem[];
  readonly manifestHrefs: ReadonlyMap<string, string>;
}

export interface ResolveReaderSessionLocatorGeometryInput {
  readonly sessionId: ReaderSessionId;
  readonly isDisposed: () => boolean;
  readonly revisions: ReadonlyMap<ReaderRevisionId, ReaderRevisionRecord>;
  readonly request: ReaderSessionResolveLocatorGeometryRequest;
  readonly spine: readonly SpineItem[];
  readonly manifestHrefs: ReadonlyMap<string, string>;
  readonly measurer: TextMeasurer;
}

export function resolveReaderSessionLocator(
  input: ResolveReaderSessionLocatorInput,
): Promise<ResolvedLocator> {
  return Promise.resolve().then(() => {
    const record = requireLocatorRevision(input);
    return resolveReaderLocator({
      sessionId: input.sessionId,
      record,
      locator: input.request.locator,
      spine: input.spine,
      manifestHrefs: input.manifestHrefs,
    });
  });
}

export function resolveReaderSessionLocatorGeometry(
  input: ResolveReaderSessionLocatorGeometryInput,
): Promise<ResolvedLocatorGeometry> {
  return Promise.resolve().then(() => {
    const record = requireLocatorRevision(input);
    return resolveReaderLocatorGeometry({
      sessionId: input.sessionId,
      record,
      locator: input.request.locator,
      spine: input.spine,
      manifestHrefs: input.manifestHrefs,
      measurer: input.measurer,
    });
  });
}

function requireLocatorRevision(
  input: ResolveReaderSessionLocatorInput | ResolveReaderSessionLocatorGeometryInput,
): ReaderRevisionRecord {
  assertReaderSessionOpen(input.isDisposed(), input.sessionId, input.request.revisionId);
  const record = input.revisions.get(input.request.revisionId);
  assertReaderRevisionReady(record, input.sessionId, input.request.revisionId);
  return record;
}
