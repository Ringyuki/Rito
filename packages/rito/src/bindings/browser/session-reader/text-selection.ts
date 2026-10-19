import type {
  ReaderExactSourceRangeRequest,
  ReaderExactTextRangeRect,
  ReaderTextCaret,
  ReaderTextCaretResolution,
  ReaderTextInteractionUnavailableReason,
  ReaderTextPoint,
  ReaderTextRange,
  ReaderTextRangeFromPointsResolution,
  ReaderTextRangeResolution,
  ReaderTextSelectionInteractions,
  ReaderTextSelectionMovement,
  ReaderTextSelectionMovementResolution,
} from '../../../reader';
import type {
  BrowserReaderTextInteractionQuery,
  BrowserReaderTextInteractionResponse,
} from '../reader-session';
import {
  askSessionReaderLayout,
  readerSourcePoint,
  requireSessionReaderPageIndex,
  sessionReaderPagePlace,
  sessionReaderPageRect,
  type SessionReaderCapture,
} from './page-space';
import { copySourceRange, sessionSourceRange } from './source-range';
import type { SessionReaderState } from './state';

type InteractionResult = BrowserReaderTextInteractionResponse['result'];
type SelectionResult = Extract<InteractionResult, { readonly kind: 'selection' }>;
type SessionCaret = Extract<InteractionResult, { readonly kind: 'caret' }>['caret'];
type CaretAddress = SessionCaret['address'];
type SessionMovement = Extract<
  BrowserReaderTextInteractionQuery,
  { readonly kind: 'movement' }
>['movement'];

/** The layout a caret was resolved in and its address there. */
interface CaretBinding {
  readonly generation: number;
  readonly address: CaretAddress;
}
type CaretBindings = WeakMap<ReaderTextCaret, CaretBinding>;

const UNAVAILABLE = {
  'shape-unavailable': 'shapeUnavailable',
  'source-unavailable': 'sourceUnavailable',
  'unsupported-transform': 'unsupportedTransform',
  'visual-geometry-unavailable': 'visualGeometryUnavailable',
  'invalid-caret': 'invalidCaret',
  'different-chapter': 'differentChapter',
} as const satisfies Record<string, ReaderTextInteractionUnavailableReason>;

const MOVEMENTS = {
  characterLeft: 'character-left',
  characterRight: 'character-right',
  wordLeft: 'word-left',
  wordRight: 'word-right',
  wordStartRight: 'word-start-right',
  lineUp: 'line-up',
  lineDown: 'line-down',
  lineStart: 'line-start',
  lineEnd: 'line-end',
  pageUp: 'page-up',
  pageDown: 'page-down',
  paragraphBackward: 'paragraph-backward',
  paragraphForward: 'paragraph-forward',
  paragraphPreviousStart: 'paragraph-previous-start',
  paragraphNextStart: 'paragraph-next-start',
  chapterStart: 'chapter-start',
  chapterEnd: 'chapter-end',
  documentStart: 'document-start',
  documentEnd: 'document-end',
} as const satisfies Record<ReaderTextSelectionMovement, SessionMovement>;

/**
 * Text selection answered by the session. A caret belongs to the layout it
 * was resolved in: once that layout is replaced its questions resolve
 * undefined, the answer a superseded request gets.
 */
export function createSessionReaderTextSelection(
  state: SessionReaderState,
): ReaderTextSelectionInteractions {
  const bindings: CaretBindings = new WeakMap();
  const ask = (
    query: (capture: SessionReaderCapture) => BrowserReaderTextInteractionQuery | undefined,
  ): Promise<{ capture: SessionReaderCapture; result: InteractionResult } | undefined> =>
    askSessionReaderLayout(state, async (capture) => {
      const question = query(capture);
      if (!question) return undefined;
      // One artifact answers for every page: a range may run across spreads.
      const response = await state.session.textInteraction(capture.artifactId, question, {
        everyPage: true,
      });
      return { capture, result: response.result };
    });
  return {
    async resolveCaret(point) {
      requireTextPoint(point);
      const answer = await ask((capture) => {
        const at = displayPoint(capture, point);
        return at && { kind: 'caret', point: at };
      });
      return answer && caretResolution(bindings, answer.capture, point, answer.result);
    },
    async resolveTextRange(anchor, focus) {
      const from = requireBinding(bindings, anchor);
      const to = requireBinding(bindings, focus);
      const answer = await ask((capture) =>
        bound(capture, from, to)
          ? { kind: 'range', anchor: from.address, focus: to.address }
          : undefined,
      );
      if (!answer) return undefined;
      return rangeResolution(answer.capture, answer.result, anchor, focus, from, to);
    },
    async resolveTextRangeToPoint(anchor, focus) {
      requireTextPoint(focus);
      const from = requireBinding(bindings, anchor);
      const answer = await ask((capture) => {
        const at = bound(capture, from) ? displayPoint(capture, focus) : undefined;
        return at && { kind: 'range-to-point', anchor: from.address, focus: at };
      });
      return answer && pointRangeResolution(bindings, answer.capture, answer.result);
    },
    async resolveTextRangeFromPoints(request) {
      requireTextPoint(request.anchor);
      requireTextPoint(request.focus);
      const granularity: unknown = request.granularity;
      if (granularity !== 'word' && granularity !== 'paragraph') {
        throw new TypeError('Reader text selection granularity must be word or paragraph');
      }
      const answer = await ask((capture) => {
        const anchor = displayPoint(capture, request.anchor);
        const focus = displayPoint(capture, request.focus);
        return anchor && focus && { kind: 'range-from-points', anchor, focus, granularity };
      });
      return answer && pointRangeResolution(bindings, answer.capture, answer.result);
    },
    resolveTextRangeFromSource: (request) => rangeFromSource(state, bindings, request),
    async resolveTextSelectionMovement(request) {
      const from = requireBinding(bindings, request.anchor);
      const to = requireBinding(bindings, request.focus);
      const answer = await ask((capture) =>
        bound(capture, from, to)
          ? {
              kind: 'movement',
              anchor: from.address,
              focus: to.address,
              movement: MOVEMENTS[request.movement],
              preferredInlinePosition: request.preferredInlinePosition,
              preferredBlockPosition: request.preferredBlockPosition,
            }
          : undefined,
      );
      return answer && movementResolution(bindings, answer.capture, answer.result);
    },
  };
}

function caretResolution(
  bindings: CaretBindings,
  capture: SessionReaderCapture,
  point: ReaderTextPoint,
  result: InteractionResult,
): ReaderTextCaretResolution | undefined {
  const place = sessionReaderPagePlace(capture, point.pageIndex);
  if (!place) return undefined;
  const projection = { pageIndex: point.pageIndex, spreadIndex: place.spreadIndex };
  switch (result.kind) {
    case 'caret':
      return { status: 'resolved', ...projection, caret: bind(bindings, capture, result.caret) };
    case 'miss':
      return { status: 'miss', ...projection };
    case 'unavailable':
      return { status: 'unavailable', ...projection, reason: UNAVAILABLE[result.reason] };
    case 'selection':
    case 'boundary':
    case 'pending':
      throw new Error('Reader session answered a caret question wrongly');
  }
}

/**
 * The range a durable source range spans in the committed layout. The
 * engine places the source range first; its first rectangle starts where
 * the range starts and its last ends where it ends, which are the caret
 * addresses the engine then answers a range between, carets included.
 */
async function rangeFromSource(
  state: SessionReaderState,
  bindings: CaretBindings,
  request: ReaderExactSourceRangeRequest,
): Promise<ReaderTextRangeResolution | undefined> {
  const sourceRange = sessionSourceRange(copySourceRange(request.sourceRange));
  const answer = await askSessionReaderLayout(state, async (capture) => {
    const placed = await state.session.exactSourceRange(
      capture.artifactId,
      request.href,
      sourceRange,
      { everyPage: true },
    );
    const first = placed.rects[0];
    const last = placed.rects.at(-1);
    if (placed.status !== 'resolved' || !first || !last) return { capture, result: undefined };
    const at = (rect: typeof first, charIndex: number, affinity: 'upstream' | 'downstream') => ({
      pageIndex: rect.pageIndex,
      position: {
        blockIndex: rect.blockIndex,
        lineIndex: rect.lineIndex,
        runIndex: rect.runIndex,
        charIndex,
      },
      affinity,
    });
    const response = await state.session.textInteraction(
      capture.artifactId,
      {
        kind: 'range',
        anchor: at(first, first.startCharIndex, 'downstream'),
        focus: at(last, last.endCharIndex, 'upstream'),
      },
      { everyPage: true },
    );
    return { capture, result: response.result };
  });
  if (!answer) return undefined;
  const { capture, result } = answer;
  if (result === undefined) return { status: 'unavailable', reason: 'sourceUnavailable' };
  if (result.kind === 'unavailable') {
    return { status: 'unavailable', reason: UNAVAILABLE[result.reason] };
  }
  if (result.kind !== 'selection') {
    throw new Error('Reader session answered a range question wrongly');
  }
  return { status: 'resolved', range: caretRange(bindings, capture, result) };
}

function rangeResolution(
  capture: SessionReaderCapture,
  result: InteractionResult,
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
  from: CaretBinding,
  to: CaretBinding,
): ReaderTextRangeResolution {
  if (result.kind === 'unavailable') {
    return { status: 'unavailable', reason: UNAVAILABLE[result.reason] };
  }
  if (result.kind !== 'selection') {
    throw new Error('Reader session answered a range question wrongly');
  }
  return { status: 'resolved', range: textRange(capture, result, anchor, focus, from, to) };
}

function pointRangeResolution(
  bindings: CaretBindings,
  capture: SessionReaderCapture,
  result: InteractionResult,
): ReaderTextRangeFromPointsResolution {
  if (result.kind === 'miss') return { status: 'miss' };
  if (result.kind === 'unavailable') {
    return { status: 'unavailable', reason: UNAVAILABLE[result.reason] };
  }
  if (result.kind !== 'selection') {
    throw new Error('Reader session answered a point range question wrongly');
  }
  return { status: 'resolved', range: caretRange(bindings, capture, result) };
}

function movementResolution(
  bindings: CaretBindings,
  capture: SessionReaderCapture,
  result: InteractionResult,
): ReaderTextSelectionMovementResolution {
  switch (result.kind) {
    case 'boundary':
    case 'pending':
      return { status: result.kind, boundary: result.boundary };
    case 'unavailable':
      return { status: 'unavailable', reason: UNAVAILABLE[result.reason] };
    case 'selection':
      return {
        status: 'resolved',
        range: caretRange(bindings, capture, result),
        ...(result.preferredInlinePosition === undefined
          ? {}
          : { preferredInlinePosition: result.preferredInlinePosition }),
        ...(result.preferredBlockPosition === undefined
          ? {}
          : { preferredBlockPosition: result.preferredBlockPosition }),
      };
    case 'caret':
    case 'miss':
      throw new Error('Reader session answered a movement question wrongly');
  }
}

/** A range whose two carets the session resolved along with it. */
function caretRange(
  bindings: CaretBindings,
  capture: SessionReaderCapture,
  result: SelectionResult,
): ReaderTextRange {
  if (!result.anchorCaret || !result.focusCaret) {
    throw new Error('Reader session resolved a range without its carets');
  }
  const anchor = bind(bindings, capture, result.anchorCaret);
  const focus = bind(bindings, capture, result.focusCaret);
  return textRange(
    capture,
    result,
    anchor,
    focus,
    { generation: capture.generation, address: result.anchorCaret.address },
    { generation: capture.generation, address: result.focusCaret.address },
  );
}

function textRange(
  capture: SessionReaderCapture,
  result: SelectionResult,
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
  from: CaretBinding,
  to: CaretBinding,
): ReaderTextRange {
  const { selection } = result;
  const forward =
    sameAddress(selection.start, from.address) && sameAddress(selection.end, to.address);
  const backward =
    sameAddress(selection.start, to.address) && sameAddress(selection.end, from.address);
  if (!forward && !backward) {
    throw new Error('Reader text range ends do not match the carets it was asked for');
  }
  const start = {
    href: selection.sourceStartHref,
    sourcePoint: readerSourcePoint(selection.sourceStart),
  };
  const end = {
    href: selection.sourceEndHref,
    sourcePoint: readerSourcePoint(selection.sourceEnd),
  };
  return {
    anchor,
    focus,
    start: forward ? anchor : focus,
    end: forward ? focus : anchor,
    selectedText: selection.selectedText,
    sourceSpan: { start, end },
    ...(start.href === end.href
      ? {
          sourceLocator: {
            href: start.href,
            sourceRange: { start: start.sourcePoint, end: end.sourcePoint },
          },
        }
      : {}),
    rects: selection.rects.map((rect) => rangeRect(capture, rect.pageIndex, rect.bounds)),
  };
}

export function rangeRect(
  capture: SessionReaderCapture,
  pageIndex: number,
  bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): ReaderExactTextRangeRect {
  const place = sessionReaderPagePlace(capture, pageIndex);
  if (!place) throw new Error('Reader text rectangle lies outside the committed layout');
  return { pageIndex, spreadIndex: place.spreadIndex, ...sessionReaderPageRect(place, bounds) };
}

function bind(
  bindings: CaretBindings,
  capture: SessionReaderCapture,
  caret: SessionCaret,
): ReaderTextCaret {
  const { pageIndex } = caret.address;
  const place = sessionReaderPagePlace(capture, pageIndex);
  if (!place || !caret.geometry) {
    throw new Error('Reader text caret lies outside the committed layout');
  }
  const bound = {
    pageIndex,
    geometry: {
      x: caret.geometry.x - place.originX,
      y: caret.geometry.y - place.originY,
      height: caret.geometry.height,
    },
    sourceLocator: { href: caret.href, sourcePoint: readerSourcePoint(caret.sourcePoint) },
  } as ReaderTextCaret;
  bindings.set(bound, { generation: capture.generation, address: caret.address });
  return bound;
}

function requireBinding(bindings: CaretBindings, caret: ReaderTextCaret): CaretBinding {
  const binding = bindings.get(caret);
  if (!binding) {
    throw new TypeError('Reader text caret does not belong to this text selection capability');
  }
  return binding;
}

/** Whether every caret was resolved in the layout the question is asked of. */
function bound(capture: SessionReaderCapture, ...carets: readonly CaretBinding[]): boolean {
  return carets.every((caret) => caret.generation === capture.generation);
}

/** A page-content point in the display-list space of the spread that draws its page. */
function displayPoint(
  capture: SessionReaderCapture,
  point: ReaderTextPoint,
): ReaderTextPoint | undefined {
  const place = sessionReaderPagePlace(capture, point.pageIndex);
  return (
    place && {
      pageIndex: point.pageIndex,
      x: point.x + place.originX,
      y: point.y + place.originY,
    }
  );
}

function requireTextPoint(point: ReaderTextPoint): void {
  requireSessionReaderPageIndex(point.pageIndex);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError('Reader text point coordinates must be finite');
  }
}

function sameAddress(left: CaretAddress, right: CaretAddress): boolean {
  return (
    left.pageIndex === right.pageIndex &&
    left.position.blockIndex === right.position.blockIndex &&
    left.position.lineIndex === right.position.lineIndex &&
    left.position.runIndex === right.position.runIndex &&
    left.position.charIndex === right.position.charIndex &&
    left.affinity === right.affinity
  );
}
