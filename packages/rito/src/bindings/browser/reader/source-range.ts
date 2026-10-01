import type {
  ReaderAnnotationTarget,
  ReaderAnnotationTargetResolution,
  ReaderExactSourceRangeRequest,
  ReaderExactSourceRangeResolution,
  ReaderExactTextRangeRect,
  ReaderSourcePosition,
  TocEntry,
} from '../../../reader';
import type {
  CoreAnnotationTarget,
  CoreAnnotationTargetResolution,
  CoreExactSourceRangeRequest,
  CoreExactSourceRangeResponse,
} from '../core-contracts';
import {
  captureCommittedSourceRead,
  captureInteraction,
  readCapturedInteraction,
  readCapturedSource,
  type BrowserReaderInteractionCapture,
} from './interaction-capture';
import { copyReaderLocator, copyReaderSourcePoint } from './interaction-capture';
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

/**
 * Annotation targets depend only on the chapter source, so both reads run on
 * the committed revision's document like other durable source reads.
 */
export async function createAnnotationTarget(
  state: BrowserReaderState,
  request: ReaderExactSourceRangeRequest,
): Promise<ReaderAnnotationTarget | undefined> {
  const capture = captureCommittedSourceRead(state);
  if (!capture) return undefined;
  const target = await readCapturedSource(state, capture, (worker, revision) =>
    worker.createAnnotationTargetAtRevision(revision, {
      href: request.href,
      sourceRange: {
        start: copyReaderSourcePoint(request.sourceRange.start),
        end: copyReaderSourcePoint(request.sourceRange.end),
      },
    }),
  );
  return target ? copyTarget(target) : undefined;
}

export async function resolveAnnotationTarget(
  state: BrowserReaderState,
  target: ReaderAnnotationTarget,
): Promise<ReaderAnnotationTargetResolution | undefined> {
  const capture = captureCommittedSourceRead(state);
  if (!capture) return undefined;
  const resolution = await readCapturedSource(state, capture, (worker, revision) =>
    worker.resolveAnnotationTargetAtRevision(revision, copyTarget(target)),
  );
  return resolution ? copyResolution(resolution) : undefined;
}

function copyResolution(
  resolution: CoreAnnotationTargetResolution,
): ReaderAnnotationTargetResolution {
  return resolution.level === 'orphaned'
    ? { level: 'orphaned', reason: resolution.reason }
    : { level: resolution.level, target: copyTarget(resolution.target) };
}

/** Rebuilt field by field in the engine's order, so serialized bytes match it. */
function copyTarget(target: CoreAnnotationTarget | ReaderAnnotationTarget): CoreAnnotationTarget {
  return {
    version: target.version,
    href: target.href,
    sourceRange: {
      start: copyReaderSourcePoint(target.sourceRange.start),
      end: copyReaderSourcePoint(target.sourceRange.end),
    },
    quote: {
      exact: target.quote.exact,
      prefix: target.quote.prefix,
      suffix: target.quote.suffix,
    },
    position: {
      start: target.position.start,
      end: target.position.end,
      chapterLength: target.position.chapterLength,
    },
  };
}

/** The TOC entry a source position reads under; null when none precedes it. */
export async function tocEntryAtPosition(
  state: BrowserReaderState,
  position: ReaderSourcePosition,
): Promise<TocEntry | null | undefined> {
  const capture = captureCommittedSourceRead(state);
  if (!capture) return undefined;
  const answer = await readCapturedSource(state, capture, (worker, revision) =>
    worker.resolvePositionQueryAtRevision(revision, {
      kind: 'tocEntryAtPosition',
      href: position.href,
      point: copyReaderSourcePoint(position.point),
    }),
  );
  if (!answer) return undefined;
  if (answer.kind !== 'tocEntry')
    throw new Error('Reader position query answered the wrong question');
  return answer.tocIndex === null
    ? null
    : (flattenToc(state.publication.package.toc)[answer.tocIndex] ?? null);
}

export async function compareSourcePositions(
  state: BrowserReaderState,
  first: ReaderSourcePosition,
  second: ReaderSourcePosition,
): Promise<-1 | 0 | 1 | undefined> {
  const capture = captureCommittedSourceRead(state);
  if (!capture) return undefined;
  const answer = await readCapturedSource(state, capture, (worker, revision) =>
    worker.resolvePositionQueryAtRevision(revision, {
      kind: 'compare',
      first: { href: first.href, point: copyReaderSourcePoint(first.point) },
      second: { href: second.href, point: copyReaderSourcePoint(second.point) },
    }),
  );
  if (!answer) return undefined;
  if (answer.kind !== 'order') throw new Error('Reader position query answered the wrong question');
  return answer.order;
}

/** Preorder, the order the engine numbers entries in. */
function flattenToc(entries: readonly TocEntry[], flat: TocEntry[] = []): TocEntry[] {
  for (const entry of entries) {
    flat.push(entry);
    flattenToc(entry.children, flat);
  }
  return flat;
}
