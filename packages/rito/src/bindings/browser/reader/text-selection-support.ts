import type {
  ReaderExactTextRangeRect,
  ReaderTextCaret,
  ReaderTextPoint,
  ReaderTextRangeResolution,
} from '../../../reader';
import type { CoreTextCaret, CoreTextCaretAddress, CoreTextRangeResponse } from '../core-contracts';
import { copyAndValidateTextSourceSpan } from '../exact-text-source';
import type { BrowserReaderInteractionCapture } from './interaction-capture';
import { copyReaderLocator, sameRevision } from './interaction-capture';
import type { BrowserReaderRevisionHandle, BrowserReaderState } from './types';

export interface BoundCaret {
  readonly revision: BrowserReaderRevisionHandle;
  readonly address: CoreTextCaretAddress;
}

export type CaretBindings = WeakMap<ReaderTextCaret, BoundCaret>;

export function bindReaderCaret(
  bindings: CaretBindings,
  capture: BrowserReaderInteractionCapture,
  value: CoreTextCaret,
): ReaderTextCaret {
  const caret = {
    pageIndex: value.address.pageIndex,
    geometry: { ...value.geometry },
    sourceLocator: copyReaderLocator(value.sourceLocator),
  } as ReaderTextCaret;
  bindings.set(caret, {
    revision: { ...capture.revision },
    address: copyCoreAddress(value.address),
  });
  return caret;
}

export function mapRangeResolution(
  state: BrowserReaderState,
  value: CoreTextRangeResponse,
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
  anchorBinding: BoundCaret,
  focusBinding: BoundCaret,
): ReaderTextRangeResolution {
  if (value.resolution.status === 'unavailable') {
    return { status: 'unavailable', reason: value.resolution.reason };
  }
  const range = value.resolution.range;
  requireAddressMatch(range.anchor, anchorBinding.address, 'anchor');
  requireAddressMatch(range.focus, focusBinding.address, 'focus');
  const endpoints = resolveNormalizedEndpoints(
    range.start,
    range.end,
    anchor,
    focus,
    anchorBinding.address,
    focusBinding.address,
  );
  const rects = range.rects.map((rect) => {
    requireMatchingPageProjection(state, rect.pageIndex, rect.spreadIndex, 'text range rectangle');
    return toReaderRangeRect(rect);
  });
  const sourceSpan = copyAndValidateTextSourceSpan(
    range.sourceSpan,
    range.sourceLocator,
    endpoints.start.sourceLocator,
    endpoints.end.sourceLocator,
  );
  return {
    status: 'resolved',
    range: {
      anchor,
      focus,
      ...endpoints,
      selectedText: range.selectedText,
      sourceSpan,
      ...(range.sourceLocator === undefined
        ? {}
        : { sourceLocator: copyReaderLocator(range.sourceLocator) }),
      rects,
    },
  };
}

export function requireBoundCaret(bindings: CaretBindings, caret: ReaderTextCaret): BoundCaret {
  const binding = bindings.get(caret);
  if (!binding) {
    throw new TypeError('Reader text caret does not belong to this text selection capability');
  }
  return binding;
}

export function requireMatchingRevision(
  revisionId: string,
  capture: BrowserReaderInteractionCapture,
): void {
  if (revisionId !== capture.coreRevision.revisionId) {
    throw new Error('Reader text interaction value does not match its revision request');
  }
}

export function requireMatchingPageProjection(
  state: BrowserReaderState,
  pageIndex: number,
  spreadIndex: number,
  subject: string,
): void {
  const spread = requirePageInCommittedNavigation(state, pageIndex, subject);
  if (spread.spreadIndex !== spreadIndex) {
    throw new Error(`Reader ${subject} does not match committed navigation`);
  }
}

export function requirePageInCommittedNavigation(
  state: BrowserReaderState,
  pageIndex: number,
  subject: string,
): BrowserReaderState['revisionBundle']['navigation']['spreads'][number] {
  const spread = state.revisionBundle.navigation.spreads.find((candidate) =>
    candidate.pageIndexes.includes(pageIndex),
  );
  if (!spread) throw new Error(`Reader ${subject} does not match committed navigation`);
  return spread;
}

export function requireTextPoint(point: ReaderTextPoint): void {
  if (!Number.isSafeInteger(point.pageIndex) || point.pageIndex < 0) {
    throw new TypeError('Reader text point pageIndex must be a non-negative safe integer');
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError('Reader text point coordinates must be finite');
  }
}

export function copyCoreAddress(address: CoreTextCaretAddress): CoreTextCaretAddress {
  return { ...address };
}

export function sameBoundRevision(left: BoundCaret, right: BoundCaret): boolean {
  return sameRevision(left.revision, right.revision);
}

/**
 * A bounded continuation advance may reuse an exact stable-prefix address. A
 * no-op mutation may also close and restore the exact-read lease without
 * changing the published layout that owns the address.
 */
export function canRebindStablePrefixCaret(
  binding: BoundCaret,
  current: BrowserReaderRevisionHandle,
): boolean {
  const previous = binding.revision;
  if (
    previous.workerSessionId !== current.workerSessionId ||
    previous.revisionId !== current.revisionId ||
    previous.revisionVersion > current.revisionVersion
  ) {
    return false;
  }
  return (
    previous.revisionVersion < current.revisionVersion ||
    previous.publicationGeneration === current.publicationGeneration
  );
}

function resolveNormalizedEndpoints(
  startAddress: CoreTextCaretAddress,
  endAddress: CoreTextCaretAddress,
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
  anchorAddress: CoreTextCaretAddress,
  focusAddress: CoreTextCaretAddress,
): { readonly start: ReaderTextCaret; readonly end: ReaderTextCaret } {
  if (sameAddress(startAddress, anchorAddress) && sameAddress(endAddress, focusAddress)) {
    return { start: anchor, end: focus };
  }
  if (sameAddress(startAddress, focusAddress) && sameAddress(endAddress, anchorAddress)) {
    return { start: focus, end: anchor };
  }
  throw new Error('Reader text range normalized endpoints do not match its request');
}

export function requireAddressMatch(
  actual: CoreTextCaretAddress,
  expected: CoreTextCaretAddress,
  endpoint: string,
): void {
  if (!sameAddress(actual, expected)) {
    throw new Error(`Reader text range ${endpoint} does not match its request`);
  }
}

function sameAddress(left: CoreTextCaretAddress, right: CoreTextCaretAddress): boolean {
  return (
    left.pageIndex === right.pageIndex &&
    left.blockIndex === right.blockIndex &&
    left.lineIndex === right.lineIndex &&
    left.runIndex === right.runIndex &&
    left.charIndex === right.charIndex &&
    left.affinity === right.affinity
  );
}

function toReaderRangeRect(
  rect: Extract<
    CoreTextRangeResponse['resolution'],
    { readonly status: 'resolved' }
  >['range']['rects'][number],
): ReaderExactTextRangeRect {
  return {
    pageIndex: rect.pageIndex,
    spreadIndex: rect.spreadIndex,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}
