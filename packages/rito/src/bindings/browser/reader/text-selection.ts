import type {
  ReaderExactTextRangeRect,
  ReaderSameFlowTextRangeResolution,
  ReaderTextCaret,
  ReaderTextCaretResolution,
  ReaderTextPoint,
  ReaderTextSelectionInteractions,
} from '../../../reader';
import type {
  CoreSameFlowTextRangeResponse,
  CoreTextCaretAddress,
  CoreTextCaretResponse,
} from '../core-contracts';
import {
  captureInteraction,
  readCapturedInteraction,
  sameRevision,
  type BrowserReaderInteractionCapture,
} from './interaction-capture';
import { copyReaderLocator } from './interaction-capture';
import type { BrowserReaderRevisionHandle, BrowserReaderState } from './types';

interface BoundCaret {
  readonly revision: BrowserReaderRevisionHandle;
  readonly address: CoreTextCaretAddress;
}

type CaretBindings = WeakMap<ReaderTextCaret, BoundCaret>;
type CoreResolvedCaret = Extract<
  CoreTextCaretResponse['resolution'],
  { readonly status: 'resolved' }
>['caret'];
type CoreResolvedRange = Extract<
  CoreSameFlowTextRangeResponse['resolution'],
  { readonly status: 'resolved' }
>['range'];

export function createBrowserReaderTextSelection(
  state: BrowserReaderState,
): ReaderTextSelectionInteractions {
  const bindings: CaretBindings = new WeakMap();
  return {
    resolveCaret: (point) => resolveCaret(state, bindings, point),
    resolveSameFlowRange: (anchor, focus) => resolveSameFlowRange(state, bindings, anchor, focus),
  };
}

async function resolveCaret(
  state: BrowserReaderState,
  bindings: CaretBindings,
  point: ReaderTextPoint,
): Promise<ReaderTextCaretResolution | undefined> {
  requireTextPoint(point);
  const capture = captureInteraction(state);
  if (!capture) return undefined;
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.resolveTextCaretAtRevision(revision, { ...point }),
  );
  if (!value) return undefined;
  requireMatchingTextResponse(state, capture, point.pageIndex, value);
  return mapCaretResolution(bindings, capture, value);
}

function mapCaretResolution(
  bindings: CaretBindings,
  capture: BrowserReaderInteractionCapture,
  value: CoreTextCaretResponse,
): ReaderTextCaretResolution {
  const common = { pageIndex: value.pageIndex, spreadIndex: value.spreadIndex };
  switch (value.resolution.status) {
    case 'resolved': {
      if (value.resolution.caret.address.pageIndex !== value.pageIndex) {
        throw new Error('Reader text caret address does not match its page response');
      }
      const caret = toReaderCaret(value.resolution.caret);
      bindings.set(caret, {
        revision: copyRevision(capture.revision),
        address: copyCoreAddress(value.resolution.caret.address),
      });
      return { status: 'resolved', ...common, caret };
    }
    case 'unavailable':
      return { status: 'unavailable', ...common, reason: value.resolution.reason };
    case 'miss':
      return { status: 'miss', ...common };
  }
}

async function resolveSameFlowRange(
  state: BrowserReaderState,
  bindings: CaretBindings,
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
): Promise<ReaderSameFlowTextRangeResolution | undefined> {
  const anchorBinding = requireBoundCaret(bindings, anchor);
  const focusBinding = requireBoundCaret(bindings, focus);
  if (!sameRevision(anchorBinding.revision, focusBinding.revision)) return undefined;
  const capture = captureInteraction(state);
  if (!capture || !sameRevision(capture.revision, anchorBinding.revision)) return undefined;

  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.resolveSameFlowTextRangeAtRevision(revision, {
      anchor: copyCoreAddress(anchorBinding.address),
      focus: copyCoreAddress(focusBinding.address),
    }),
  );
  if (!value) return undefined;
  requireMatchingRevision(value.revisionId, capture);
  return mapRangeResolution(state, value, anchor, focus, anchorBinding, focusBinding);
}

function mapRangeResolution(
  state: BrowserReaderState,
  value: CoreSameFlowTextRangeResponse,
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
  anchorBinding: BoundCaret,
  focusBinding: BoundCaret,
): ReaderSameFlowTextRangeResolution {
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
  return {
    status: 'resolved',
    range: {
      anchor,
      focus,
      ...endpoints,
      selectedText: range.selectedText,
      sourceLocator: copyReaderLocator(range.sourceLocator),
      rects,
    },
  };
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

function requireMatchingTextResponse(
  state: BrowserReaderState,
  capture: BrowserReaderInteractionCapture,
  pageIndex: number,
  value: CoreTextCaretResponse,
): void {
  requireMatchingRevision(value.revisionId, capture);
  if (value.pageIndex !== pageIndex) {
    throw new Error('Reader text caret response does not match its page request');
  }
  requireMatchingPageProjection(state, value.pageIndex, value.spreadIndex, 'text caret');
}

function requireMatchingRevision(
  revisionId: string,
  capture: BrowserReaderInteractionCapture,
): void {
  if (revisionId !== capture.coreRevision.revisionId) {
    throw new Error('Reader text interaction value does not match its revision request');
  }
}

function requireMatchingPageProjection(
  state: BrowserReaderState,
  pageIndex: number,
  spreadIndex: number,
  subject: string,
): void {
  const spread = state.revisionBundle.navigation.spreads.find((candidate) =>
    candidate.pageIndexes.includes(pageIndex),
  );
  if (!spread || spread.spreadIndex !== spreadIndex) {
    throw new Error(`Reader ${subject} does not match committed navigation`);
  }
}

function requireTextPoint(point: ReaderTextPoint): void {
  if (!Number.isSafeInteger(point.pageIndex) || point.pageIndex < 0) {
    throw new TypeError('Reader text point pageIndex must be a non-negative safe integer');
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError('Reader text point coordinates must be finite');
  }
}

function requireBoundCaret(bindings: CaretBindings, caret: ReaderTextCaret): BoundCaret {
  const binding = bindings.get(caret);
  if (!binding) {
    throw new TypeError('Reader text caret does not belong to this text selection capability');
  }
  return binding;
}

function requireAddressMatch(
  actual: CoreTextCaretAddress,
  expected: CoreTextCaretAddress,
  endpoint: 'anchor' | 'focus',
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

function toReaderCaret(value: CoreResolvedCaret): ReaderTextCaret {
  return {
    geometry: { ...value.geometry },
    sourceLocator: copyReaderLocator(value.sourceLocator),
  } as ReaderTextCaret;
}

function copyCoreAddress(address: CoreTextCaretAddress): CoreTextCaretAddress {
  return { ...address };
}

function copyRevision(revision: BrowserReaderRevisionHandle): BrowserReaderRevisionHandle {
  return { ...revision };
}

function toReaderRangeRect(rect: CoreResolvedRange['rects'][number]): ReaderExactTextRangeRect {
  return {
    pageIndex: rect.pageIndex,
    spreadIndex: rect.spreadIndex,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}
