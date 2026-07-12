import type {
  ReaderExactSourceRangeRequest,
  ReaderExactSourceRangeResolution,
  ReaderExactTextRangeRect,
} from '../../../reader';
import type { CoreExactSourceRangeRequest, CoreExactSourceRangeResponse } from '../core-contracts';
import {
  captureInteraction,
  readCapturedInteraction,
  type BrowserReaderInteractionCapture,
} from './interaction-capture';
import { copyReaderLocator, copyReaderSourcePoint } from './source-locator';
import type { BrowserReaderState } from './types';

type CoreResolvedRange = Extract<
  CoreExactSourceRangeResponse['resolution'],
  { readonly status: 'resolved' }
>['range'];

export async function resolveExactSourceRange(
  state: BrowserReaderState,
  request: ReaderExactSourceRangeRequest,
): Promise<ReaderExactSourceRangeResolution | undefined> {
  const capture = captureInteraction(state);
  if (!capture) return undefined;
  const expectedRequest = copyRequest(request);
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.resolveExactSourceRangeAtRevision(revision, expectedRequest),
  );
  if (!value) return undefined;
  requireMatchingRevision(value, capture);
  return mapResolution(state, value);
}

function mapResolution(
  state: BrowserReaderState,
  value: CoreExactSourceRangeResponse,
): ReaderExactSourceRangeResolution {
  switch (value.resolution.status) {
    case 'resolved':
      return { status: 'resolved', range: mapResolvedRange(state, value.resolution.range) };
    case 'pending':
      return { status: 'pending', reason: value.resolution.reason };
    case 'unavailable':
      return { status: 'unavailable', reason: value.resolution.reason };
  }
}

function mapResolvedRange(
  state: BrowserReaderState,
  range: CoreResolvedRange,
): Extract<ReaderExactSourceRangeResolution, { readonly status: 'resolved' }>['range'] {
  return {
    selectedText: range.selectedText,
    sourceLocator: copyReaderLocator(range.sourceLocator),
    rects: range.rects.map((rect) => {
      requireMatchingPageProjection(state, rect.pageIndex, rect.spreadIndex);
      return copyRangeRect(rect);
    }),
  };
}

function requireMatchingRevision(
  value: CoreExactSourceRangeResponse,
  capture: BrowserReaderInteractionCapture,
): void {
  if (value.revisionId !== capture.coreRevision.revisionId) {
    throw new Error('Reader exact source range value does not match its revision request');
  }
}

function requireMatchingPageProjection(
  state: BrowserReaderState,
  pageIndex: number,
  spreadIndex: number,
): void {
  const spread = state.revisionBundle.navigation.spreads.find((candidate) =>
    candidate.pageIndexes.includes(pageIndex),
  );
  if (!spread || spread.spreadIndex !== spreadIndex) {
    throw new Error('Reader exact source range rectangle does not match committed navigation');
  }
}

function copyRequest(request: ReaderExactSourceRangeRequest): CoreExactSourceRangeRequest {
  return {
    href: request.href,
    sourceRange: {
      start: copyReaderSourcePoint(request.sourceRange.start),
      end: copyReaderSourcePoint(request.sourceRange.end),
    },
  };
}

function copyRangeRect(rect: CoreResolvedRange['rects'][number]): ReaderExactTextRangeRect {
  return {
    pageIndex: rect.pageIndex,
    spreadIndex: rect.spreadIndex,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}
