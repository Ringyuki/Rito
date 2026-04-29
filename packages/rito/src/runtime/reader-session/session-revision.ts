import type { ImageDimensions } from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { Logger } from '../../utils/logger';
import type { EpubDocument } from '../types';
import { assertReaderSessionOpen } from './lifecycle';
import {
  createFailedReaderRevisionRecord,
  createReaderRevisionRecordAsync,
  createWarmingReaderRevisionRecord,
  type CreateReaderRevisionRecordInput,
  type PaginateReaderRevision,
  type ReaderRevisionRecord,
} from './revision';
import type { CreateReaderRevisionId, RegisterReaderSessionFonts } from './session-types';
import type {
  ReaderLayoutRequest,
  ReaderRevision,
  ReaderRevisionId,
  ReaderSessionId,
} from './types';

export interface CreateReaderSessionRevisionInput {
  readonly sessionId: ReaderSessionId;
  readonly document: EpubDocument;
  readonly measurer: TextMeasurer;
  readonly revisions: Map<ReaderRevisionId, ReaderRevisionRecord>;
  readonly now: () => number;
  readonly createRevisionId: CreateReaderRevisionId;
  readonly isDisposed: () => boolean;
  readonly getFontRegistration: () => Promise<void> | undefined;
  readonly setFontRegistration: (registration: Promise<void>) => void;
  readonly images?: ReadonlyMap<string, ImageDimensions>;
  readonly logger?: Logger;
  readonly paginateRevision?: PaginateReaderRevision;
  readonly registerFonts?: RegisterReaderSessionFonts;
}

export function createReaderSessionRevision(
  input: CreateReaderSessionRevisionInput,
  request: ReaderLayoutRequest,
): Promise<ReaderRevision> {
  return Promise.resolve().then(async () => {
    assertReaderSessionOpen(input.isDisposed(), input.sessionId);
    const revisionId = input.createRevisionId();
    const recordInput = createRevisionRecordInput(input, revisionId, request);
    input.revisions.set(revisionId, createWarmingReaderRevisionRecord(recordInput));

    const record = await createReadyOrFailedRevisionRecord(input, recordInput);
    assertReaderSessionOpen(input.isDisposed(), input.sessionId, revisionId);
    const current = input.revisions.get(revisionId);
    if (current?.revision.status === 'cancelled') return current.revision;
    input.revisions.set(revisionId, record);
    return record.revision;
  });
}

function createRevisionRecordInput(
  input: CreateReaderSessionRevisionInput,
  revisionId: ReaderRevisionId,
  request: ReaderLayoutRequest,
): CreateReaderRevisionRecordInput {
  return {
    sessionId: input.sessionId,
    revisionId,
    request,
    document: input.document,
    measurer: input.measurer,
    createdAt: input.now(),
    ...(input.images !== undefined ? { images: input.images } : {}),
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
    ...(input.paginateRevision !== undefined ? { paginateRevision: input.paginateRevision } : {}),
  };
}

async function createReadyOrFailedRevisionRecord(
  input: CreateReaderSessionRevisionInput,
  recordInput: CreateReaderRevisionRecordInput,
): Promise<ReaderRevisionRecord> {
  try {
    await ensureFontsRegistered(input);
  } catch (error) {
    assertReaderSessionOpen(input.isDisposed(), input.sessionId, recordInput.revisionId);
    return createFailedReaderRevisionRecord(recordInput, error);
  }
  assertReaderSessionOpen(input.isDisposed(), input.sessionId, recordInput.revisionId);
  const current = input.revisions.get(recordInput.revisionId);
  if (current?.revision.status === 'cancelled') return current;
  const record = await createReaderRevisionRecordAsync(recordInput);
  assertReaderSessionOpen(input.isDisposed(), input.sessionId, recordInput.revisionId);
  return record;
}

function ensureFontsRegistered(input: CreateReaderSessionRevisionInput): Promise<void> {
  const existing = input.getFontRegistration();
  if (existing !== undefined) return existing;
  const registration = Promise.resolve().then(() =>
    input.registerFonts?.({
      sessionId: input.sessionId,
      document: input.document,
    }),
  );
  input.setFontRegistration(registration);
  return registration;
}
