import type {
  ReaderTextRangeFromPointsRequest,
  ReaderTextRangeFromPointsResolution,
} from '../../../reader';
import type { CoreTextRangeFromPointsResponse, CoreTextRangeResponse } from '../core-contracts';
import {
  captureInteraction,
  readCapturedInteraction,
  type BrowserReaderInteractionCapture,
} from './interaction-capture';
import {
  bindReaderCaret,
  mapRangeResolution,
  requireBoundCaret,
  requireMatchingRevision,
  requirePageInCommittedNavigation,
  requireTextPoint,
  type CaretBindings,
} from './text-selection-support';
import type { BrowserReaderState } from './types';

export async function resolveTextRangeFromPoints(
  state: BrowserReaderState,
  bindings: CaretBindings,
  request: ReaderTextRangeFromPointsRequest,
): Promise<ReaderTextRangeFromPointsResolution | undefined> {
  requireRequest(request);
  const capture = captureInteraction(state);
  if (!capture) return undefined;
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.resolveTextRangeFromPointsAtRevision(revision, {
      anchor: { ...request.anchor },
      focus: { ...request.focus },
      granularity: request.granularity,
    }),
  );
  if (!value) return undefined;
  return mapTextRangeFromPointResponse(state, bindings, capture, value);
}

export function mapTextRangeFromPointResponse(
  state: BrowserReaderState,
  bindings: CaretBindings,
  capture: BrowserReaderInteractionCapture,
  value: CoreTextRangeFromPointsResponse,
): ReaderTextRangeFromPointsResolution {
  requireMatchingRevision(value.revisionId, capture);
  if (value.resolution.status === 'miss') return { status: 'miss' };
  if (value.resolution.status === 'unavailable') {
    return { status: 'unavailable', reason: value.resolution.reason };
  }
  requirePageInCommittedNavigation(
    state,
    value.resolution.anchorCaret.address.pageIndex,
    'granular anchor caret',
  );
  requirePageInCommittedNavigation(
    state,
    value.resolution.focusCaret.address.pageIndex,
    'granular focus caret',
  );
  const anchor = bindReaderCaret(bindings, capture, value.resolution.anchorCaret);
  const focus = bindReaderCaret(bindings, capture, value.resolution.focusCaret);
  const mapped = mapRangeResolution(
    state,
    asRangeResponse(value),
    anchor,
    focus,
    requireBoundCaret(bindings, anchor),
    requireBoundCaret(bindings, focus),
  );
  if (mapped.status !== 'resolved') {
    throw new Error('Reader point range lost its resolved range');
  }
  return mapped;
}

function requireRequest(request: ReaderTextRangeFromPointsRequest): void {
  requireTextPoint(request.anchor);
  requireTextPoint(request.focus);
  const granularity: unknown = request.granularity;
  if (granularity !== 'word' && granularity !== 'paragraph') {
    throw new TypeError('Reader text selection granularity must be word or paragraph');
  }
}

function asRangeResponse(value: CoreTextRangeFromPointsResponse): CoreTextRangeResponse {
  if (value.resolution.status !== 'resolved') {
    throw new Error('Reader granular text range is not resolved');
  }
  return {
    revisionId: value.revisionId,
    resolution: { status: 'resolved', range: value.resolution.range },
  };
}
