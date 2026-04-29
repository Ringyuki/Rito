import type { Logger } from '../../utils/logger';
import type { EpubDocument } from '../types';
import { createReaderSessionError } from './errors';
import { getOrSetCachedReaderSpreadFrame } from './frame-cache';
import type { BuildReaderSpreadFrameInput } from './frame';
import { resolveReaderFootnoteRef } from './footnote';
import { assertReaderRevisionReady, assertReaderSessionOpen } from './lifecycle';
import { readReaderResource, type StoreReaderResourceTransfer } from './resource';
import type { ReaderRevisionRecord } from './revision';
import type {
  ReaderResourceRef,
  ReaderRevisionId,
  ReaderSessionId,
  ReaderSpreadFrame,
} from './types';
import type { ReaderSessionPrefetchRequest, ReaderSessionSpreadFrameRequest } from './session';

interface ReaderSessionFrameInputSource {
  readonly sessionId: ReaderSessionId;
  readonly manifestHrefs?: ReadonlyMap<string, string>;
  readonly createResourceRef?: (href: string) => ReaderResourceRef;
  readonly createLocator?: BuildReaderSpreadFrameInput['createLocator'];
}

type BuildReaderSessionFrame = (input: BuildReaderSpreadFrameInput) => ReaderSpreadFrame;

export interface GetReaderSessionSpreadFrameInput {
  readonly sessionId: ReaderSessionId;
  readonly isDisposed: () => boolean;
  readonly revisions: ReadonlyMap<ReaderRevisionId, ReaderRevisionRecord>;
  readonly frameSource: ReaderSessionFrameInputSource;
  readonly buildFrame: BuildReaderSessionFrame;
  readonly request: ReaderSessionSpreadFrameRequest;
}

export interface PrefetchReaderSessionSpreadsInput {
  readonly sessionId: ReaderSessionId;
  readonly isDisposed: () => boolean;
  readonly revisions: ReadonlyMap<ReaderRevisionId, ReaderRevisionRecord>;
  readonly document: EpubDocument;
  readonly frameSource: ReaderSessionFrameInputSource;
  readonly buildFrame: BuildReaderSessionFrame;
  readonly storeResourceTransfer?: StoreReaderResourceTransfer;
  readonly logger?: Logger;
  readonly request: ReaderSessionPrefetchRequest;
}

export function getReaderSessionSpreadFrame(
  input: GetReaderSessionSpreadFrameInput,
): Promise<ReaderSpreadFrame> {
  return Promise.resolve().then(() => {
    const record = requireFrameRevision(input);
    const spread = record.spreads[input.request.spreadIndex];
    if (!spread) {
      throw createReaderSessionError(
        input.sessionId,
        input.request.revisionId,
        'not-found',
        `Spread ${String(input.request.spreadIndex)} is not available`,
      );
    }
    return getOrSetCachedReaderSpreadFrame(record.frameCache, input.request, () =>
      input.buildFrame(
        createReaderSessionFrameInput(input.frameSource, record, spread, input.request),
      ),
    );
  });
}

export function prefetchReaderSessionSpreads(
  input: PrefetchReaderSessionSpreadsInput,
): Promise<readonly number[]> {
  return Promise.resolve().then(() => {
    const record = requireFrameRevision(input);
    const warmed: number[] = [];
    const seen = new Set<number>();
    for (const spreadIndex of input.request.spreadIndexes) {
      if (seen.has(spreadIndex)) continue;
      seen.add(spreadIndex);
      const spread = record.spreads[spreadIndex];
      if (!spread) continue;
      const frameRequest = { ...input.request, spreadIndex };
      const frame = getOrSetCachedReaderSpreadFrame(record.frameCache, frameRequest, () =>
        input.buildFrame(
          createReaderSessionFrameInput(input.frameSource, record, spread, frameRequest),
        ),
      );
      prefetchFrameImageResources(input, record, frame);
      warmed.push(spreadIndex);
    }
    return warmed;
  });
}

function prefetchFrameImageResources(
  input: PrefetchReaderSessionSpreadsInput,
  record: ReaderRevisionRecord,
  frame: ReaderSpreadFrame,
): void {
  const storeTransfer = input.storeResourceTransfer;
  if (!storeTransfer) return;
  for (const resource of frame.resourceRefs) {
    if (resource.kind !== 'image') continue;
    try {
      readReaderResource({
        sessionId: input.sessionId,
        revisionId: record.revision.id,
        document: input.document,
        resource,
        storeTransfer,
      });
    } catch (error) {
      input.logger?.warn('Reader resource prefetch failed', error);
    }
  }
}

export function createReaderSessionFrameInput(
  input: ReaderSessionFrameInputSource,
  record: ReaderRevisionRecord,
  spread: BuildReaderSpreadFrameInput['spread'],
  request: ReaderSessionSpreadFrameRequest,
): BuildReaderSpreadFrameInput {
  const pagination = record.pagination;
  const manifestHrefs = input.manifestHrefs ?? new Map<string, string>();
  return {
    sessionId: input.sessionId,
    revisionId: record.revision.id,
    spread,
    layout: record.layout,
    ...(request.displayListOptions !== undefined
      ? { displayListOptions: request.displayListOptions }
      : {}),
    ...(input.createResourceRef !== undefined
      ? { createResourceRef: input.createResourceRef }
      : {}),
    ...(input.createLocator !== undefined ? { createLocator: input.createLocator } : {}),
    ...(pagination !== undefined
      ? {
          resolveFootnoteRef: (target) =>
            resolveReaderFootnoteRef({
              ...target,
              pagination,
              manifestHrefs,
            }),
        }
      : {}),
  };
}

function requireFrameRevision(
  input: GetReaderSessionSpreadFrameInput | PrefetchReaderSessionSpreadsInput,
): ReaderRevisionRecord {
  assertReaderSessionOpen(input.isDisposed(), input.sessionId, input.request.revisionId);
  const record = input.revisions.get(input.request.revisionId);
  assertReaderRevisionReady(record, input.sessionId, input.request.revisionId);
  return record;
}
