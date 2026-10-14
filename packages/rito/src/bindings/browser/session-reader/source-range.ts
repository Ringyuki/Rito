import type {
  ReaderAnnotationTarget,
  ReaderAnnotationTargetResolution,
  ReaderExactSourceRangeRequest,
  ReaderExactSourceRangeResolution,
  ReaderInteractions,
  ReaderSourcePoint,
  ReaderSourceRange,
} from '../../../reader';
import type { BrowserReaderAnnotationResponse, BrowserReaderSourceRange } from '../reader-session';
import { askSessionReaderLayout, readerSourcePoint, sessionSourcePoint } from './page-space';
import { sessionReaderClosed, type SessionReaderState } from './state';
import { rangeRect } from './text-selection';

type SessionAnnotationTarget = NonNullable<BrowserReaderAnnotationResponse['target']>;

/** The source questions of a reader: ranges, annotation targets and reading order. */
export function sessionReaderSourceInteractions(
  state: SessionReaderState,
): Required<
  Pick<
    ReaderInteractions,
    | 'resolveExactSourceRange'
    | 'createAnnotationTarget'
    | 'resolveAnnotationTarget'
    | 'tocEntryAtPosition'
    | 'compareSourcePositions'
  >
> {
  return {
    resolveExactSourceRange: (request) => resolveExactSourceRange(state, request),
    async createAnnotationTarget(request) {
      if (state.disposed) return undefined;
      const response = await state.session.annotation({
        kind: 'create',
        href: request.href,
        range: sessionSourceRange(request.sourceRange),
      });
      if (sessionReaderClosed(state)) return undefined;
      if (response.level !== 'created' || !response.target) {
        throw new Error('Reader session answered an annotation target request wrongly');
      }
      return annotationTarget(response.target);
    },
    async resolveAnnotationTarget(target) {
      if (state.disposed) return undefined;
      const response = await state.session.annotation({
        kind: 'resolve',
        targetJson: JSON.stringify(canonicalTarget(target)),
      });
      return sessionReaderClosed(state) ? undefined : annotationResolution(response);
    },
    async tocEntryAtPosition(position) {
      if (state.disposed) return undefined;
      const answer = await state.session.navigation({
        kind: 'toc-entry-at-position',
        href: position.href,
        point: sessionSourcePoint(position.point),
      });
      if (sessionReaderClosed(state)) return undefined;
      if (answer.kind !== 'toc-entry') {
        throw new Error('Reader session answered a TOC question wrongly');
      }
      if (answer.tocId === undefined) return null;
      return state.publication.tocEntry(answer.tocId) ?? null;
    },
    async compareSourcePositions(first, second) {
      if (state.disposed) return undefined;
      const answer = await state.session.navigation({
        kind: 'compare',
        firstHref: first.href,
        first: sessionSourcePoint(first.point),
        secondHref: second.href,
        second: sessionSourcePoint(second.point),
      });
      if (sessionReaderClosed(state)) return undefined;
      if (answer.kind !== 'order') {
        throw new Error('Reader session answered an order question wrongly');
      }
      return answer.order;
    },
  };
}

/**
 * Where a durable source range lands in the committed layout, on every
 * page it covers. A range whose chapter the committed layout does not
 * cover is pending: the whole book lays it out.
 */
async function resolveExactSourceRange(
  state: SessionReaderState,
  request: ReaderExactSourceRangeRequest,
): Promise<ReaderExactSourceRangeResolution | undefined> {
  const sourceRange = copySourceRange(request.sourceRange);
  const answer = await askSessionReaderLayout(state, async (capture) => ({
    capture,
    resolution: await state.session.exactSourceRange(
      capture.artifactId,
      request.href,
      sessionSourceRange(sourceRange),
      { everyPage: true },
    ),
  }));
  if (!answer) return undefined;
  const { capture, resolution } = answer;
  if (resolution.status === 'pending') return { status: 'pending', reason: 'notPaginated' };
  if (resolution.status === 'unavailable') {
    return { status: 'unavailable', reason: 'sourceUnavailable' };
  }
  return {
    status: 'resolved',
    range: {
      selectedText: resolution.selectedText,
      sourceLocator: { href: request.href, sourceRange },
      rects: resolution.rects.map((rect) => rangeRect(capture, rect.pageIndex, rect.bounds)),
    },
  };
}

function annotationResolution(
  response: BrowserReaderAnnotationResponse,
): ReaderAnnotationTargetResolution {
  switch (response.level) {
    case 'orphaned-href-not-found':
      return { level: 'orphaned', reason: 'hrefNotFound' };
    case 'orphaned-empty-chapter':
      return { level: 'orphaned', reason: 'emptyChapter' };
    case 'exact':
    case 'quote':
    case 'position':
    case 'progression':
      if (response.target) {
        return { level: response.level, target: annotationTarget(response.target) };
      }
      break;
    case 'created':
      break;
  }
  throw new Error('Reader session answered an annotation question wrongly');
}

function annotationTarget(target: SessionAnnotationTarget): ReaderAnnotationTarget {
  return canonicalTarget({
    version: 1,
    href: target.href,
    sourceRange: {
      start: readerSourcePoint(target.sourceRange.start),
      end: readerSourcePoint(target.sourceRange.end),
    },
    quote: { exact: target.exact, prefix: target.prefix, suffix: target.suffix },
    position: {
      start: Number(target.start),
      end: Number(target.end),
      chapterLength: Number(target.chapterLength),
    },
  });
}

/** Rebuilt field by field in the engine's order, so serialized bytes match it. */
function canonicalTarget(target: ReaderAnnotationTarget): ReaderAnnotationTarget {
  return {
    version: target.version,
    href: target.href,
    sourceRange: copySourceRange(target.sourceRange),
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

function copySourceRange(range: ReaderSourceRange): ReaderSourceRange {
  const copy = (point: ReaderSourcePoint): ReaderSourcePoint => ({
    nodePath: [...point.nodePath],
    textOffset: point.textOffset,
  });
  return { start: copy(range.start), end: copy(range.end) };
}

function sessionSourceRange(range: ReaderSourceRange): BrowserReaderSourceRange {
  return { start: sessionSourcePoint(range.start), end: sessionSourcePoint(range.end) };
}
