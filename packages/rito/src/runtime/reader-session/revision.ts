import { createLayoutConfig } from '../../layout/core/config';
import type { ImageDimensions, LayoutConfig, Spread } from '../../layout/core/types';
import { buildSpreads } from '../../layout/spread';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { Logger } from '../../utils/logger';
import { PaginationSession } from '../pagination-session';
import type { ChapterRange, EpubDocument, PaginationResult } from '../types';
import type {
  ReaderLayoutRequest,
  ReaderRevision,
  ReaderRevisionId,
  ReaderSessionId,
} from './types';
import type { ReaderProtocolError } from './protocol';
import { createProtocolError } from './protocol-helpers';
import { createReaderSpreadFrameCache, type ReaderSpreadFrameCache } from './frame-cache';

export interface PaginateReaderRevisionInput {
  readonly document: EpubDocument;
  readonly layout: LayoutConfig;
  readonly measurer: TextMeasurer;
  readonly images?: ReadonlyMap<string, ImageDimensions>;
  readonly lineBreaking?: ReaderLayoutRequest['lineBreaking'];
  readonly logger?: Logger;
}

export type PaginateReaderRevision = (
  input: PaginateReaderRevisionInput,
) => PaginationResult | Promise<PaginationResult>;

export interface ReaderRevisionRecord {
  readonly revision: ReaderRevision;
  readonly layout: LayoutConfig;
  readonly pagination?: PaginationResult;
  readonly spreads: readonly Spread[];
  readonly frameCache: ReaderSpreadFrameCache;
  readonly error?: ReaderProtocolError;
}

export interface CreateReaderRevisionRecordInput {
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly request: ReaderLayoutRequest;
  readonly document: EpubDocument;
  readonly measurer: TextMeasurer;
  readonly images?: ReadonlyMap<string, ImageDimensions>;
  readonly logger?: Logger;
  readonly createdAt: number;
  readonly paginateRevision?: PaginateReaderRevision;
}

export function createReaderRevisionRecord(
  input: CreateReaderRevisionRecordInput,
): ReaderRevisionRecord {
  const layoutKey = createReaderLayoutKey(input.request);
  const layout = createReaderLayoutConfig(input.request);

  try {
    const pagination = paginateRevision(input, layout);
    if (isPromiseLike(pagination)) {
      throw new Error('Async reader revision pagination requires createReaderRevisionRecordAsync');
    }
    return readyRevisionRecord(input, layout, layoutKey, pagination);
  } catch (error) {
    return failedRevisionRecord(input, layout, layoutKey, error);
  }
}

export function createWarmingReaderRevisionRecord(
  input: CreateReaderRevisionRecordInput,
): ReaderRevisionRecord {
  const layoutKey = createReaderLayoutKey(input.request);
  const layout = createReaderLayoutConfig(input.request);
  return {
    revision: {
      id: input.revisionId,
      sessionId: input.sessionId,
      layoutKey,
      status: 'warming',
      knownSpreadCount: 0,
      createdAt: input.createdAt,
    },
    layout,
    spreads: [],
    frameCache: createReaderSpreadFrameCache(),
  };
}

export async function createReaderRevisionRecordAsync(
  input: CreateReaderRevisionRecordInput,
): Promise<ReaderRevisionRecord> {
  const layoutKey = createReaderLayoutKey(input.request);
  const layout = createReaderLayoutConfig(input.request);
  try {
    const pagination = await paginateRevision(input, layout);
    return readyRevisionRecord(input, layout, layoutKey, pagination);
  } catch (error) {
    return failedRevisionRecord(input, layout, layoutKey, error);
  }
}

export function createFailedReaderRevisionRecord(
  input: CreateReaderRevisionRecordInput,
  error: unknown,
): ReaderRevisionRecord {
  const layoutKey = createReaderLayoutKey(input.request);
  const layout = createReaderLayoutConfig(input.request);
  return failedRevisionRecord(input, layout, layoutKey, error);
}

export function createReaderLayoutKey(request: ReaderLayoutRequest): string {
  return JSON.stringify({
    viewport: {
      width: request.viewport.width,
      height: request.viewport.height,
    },
    spreadMode: request.spreadMode,
    margin: request.margin,
    lineBreaking: request.lineBreaking ?? null,
    typography: {
      fontSize: request.typography?.fontSize ?? null,
      lineHeight: request.typography?.lineHeight ?? null,
      lineHeightForce: request.typography?.lineHeightForce ?? null,
      fontFamily: request.typography?.fontFamily ?? null,
      fontFamilyForce: request.typography?.fontFamilyForce ?? null,
    },
  });
}

export function createReaderLayoutConfig(request: ReaderLayoutRequest): LayoutConfig {
  return createLayoutConfig({
    width: request.viewport.width,
    height: request.viewport.height,
    margin: request.margin,
    spread: request.spreadMode,
    ...(request.typography?.fontSize !== undefined
      ? { rootFontSize: request.typography.fontSize }
      : {}),
    ...(request.typography?.lineHeight !== undefined
      ? { lineHeightOverride: request.typography.lineHeight }
      : {}),
    ...(request.typography?.lineHeightForce !== undefined
      ? { lineHeightForce: request.typography.lineHeightForce }
      : {}),
    ...(request.typography?.fontFamily !== undefined
      ? { fontFamilyOverride: request.typography.fontFamily }
      : {}),
    ...(request.typography?.fontFamilyForce !== undefined
      ? { fontFamilyForce: request.typography.fontFamilyForce }
      : {}),
  });
}

export function cancelReaderRevisionRecord(record: ReaderRevisionRecord): ReaderRevisionRecord {
  return {
    ...record,
    revision: {
      ...record.revision,
      status: 'cancelled',
    },
  };
}

function paginateRevision(
  input: CreateReaderRevisionRecordInput,
  layout: LayoutConfig,
): PaginationResult | Promise<PaginationResult> {
  const paginate = input.paginateRevision ?? defaultPaginateRevision;
  return paginate({
    document: input.document,
    layout,
    measurer: input.measurer,
    ...(input.images !== undefined ? { images: input.images } : {}),
    ...(input.request.lineBreaking !== undefined
      ? { lineBreaking: input.request.lineBreaking }
      : {}),
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  });
}

function defaultPaginateRevision(input: PaginateReaderRevisionInput): PaginationResult {
  const session = new PaginationSession(
    input.document,
    input.layout,
    input.measurer,
    input.images,
    input.lineBreaking,
    input.logger,
  );
  session.paginateAll();
  return session.getResult();
}

function chapterStartPages(chapterMap: ReadonlyMap<string, ChapterRange>): ReadonlySet<number> {
  const starts = new Set<number>();
  for (const range of chapterMap.values()) {
    starts.add(range.startPage);
  }
  return starts;
}

function failedRevisionRecord(
  input: CreateReaderRevisionRecordInput,
  layout: LayoutConfig,
  layoutKey: string,
  error: unknown,
): ReaderRevisionRecord {
  return {
    revision: {
      id: input.revisionId,
      sessionId: input.sessionId,
      layoutKey,
      status: 'failed',
      knownSpreadCount: 0,
      finalSpreadCount: 0,
      createdAt: input.createdAt,
    },
    layout,
    spreads: [],
    frameCache: createReaderSpreadFrameCache(),
    error: createProtocolError('internal-error', 'Failed to create reader revision', {
      details: { cause: errorMessage(error) },
    }),
  };
}

function readyRevisionRecord(
  input: CreateReaderRevisionRecordInput,
  layout: LayoutConfig,
  layoutKey: string,
  pagination: PaginationResult,
): ReaderRevisionRecord {
  const spreads = buildSpreads(pagination.pages, layout, chapterStartPages(pagination.chapterMap));
  return {
    revision: {
      id: input.revisionId,
      sessionId: input.sessionId,
      layoutKey,
      status: 'ready',
      knownSpreadCount: spreads.length,
      finalSpreadCount: spreads.length,
      createdAt: input.createdAt,
    },
    layout,
    pagination,
    spreads,
    frameCache: createReaderSpreadFrameCache(),
  };
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { readonly then?: unknown }).then === 'function';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
