import type {
  ReaderTextCaret,
  ReaderTextCaretResolution,
  ReaderTextPoint,
  ReaderTextRangeFromPointsResolution,
  ReaderTextRangeResolution,
  ReaderTextSelectionInteractions,
  ReaderTextSelectionMovementRequest,
  ReaderTextSelectionMovementResolution,
} from '../../../reader';
import type {
  CoreTextCaretAddress,
  CoreTextCaretResponse,
  CoreTextSelectionMovementResponse,
} from '../core-contracts';
import {
  captureInteraction,
  readCapturedInteraction,
  sameRevision,
  type BrowserReaderInteractionCapture,
} from './interaction-capture';
import {
  mapTextRangeFromPointResponse,
  resolveTextRangeFromPoints,
} from './text-selection-from-points';
import {
  bindReaderCaret,
  canRebindStablePrefixCaret,
  copyCoreAddress,
  mapRangeResolution,
  requireAddressMatch,
  requireBoundCaret,
  requireMatchingPageProjection,
  requireMatchingRevision,
  requirePageInCommittedNavigation,
  requireTextPoint,
  sameBoundRevision,
  type CaretBindings,
} from './text-selection-support';
import type { BrowserReaderState } from './types';

export function createBrowserReaderTextSelection(
  state: BrowserReaderState,
): ReaderTextSelectionInteractions {
  const bindings: CaretBindings = new WeakMap();
  return {
    resolveCaret: (point) => resolveCaret(state, bindings, point),
    resolveTextRange: (anchor, focus) => resolveTextRange(state, bindings, anchor, focus),
    resolveTextRangeToPoint: (anchor, focus) =>
      resolveTextRangeToPoint(state, bindings, anchor, focus),
    resolveTextRangeFromPoints: (request) => resolveTextRangeFromPoints(state, bindings, request),
    resolveTextSelectionMovement: (request) =>
      resolveTextSelectionMovement(state, bindings, request),
  };
}

async function resolveTextRangeToPoint(
  state: BrowserReaderState,
  bindings: CaretBindings,
  anchor: ReaderTextCaret,
  focus: ReaderTextPoint,
): Promise<ReaderTextRangeFromPointsResolution | undefined> {
  requireTextPoint(focus);
  const anchorBinding = requireBoundCaret(bindings, anchor);
  const capture = captureInteraction(state);
  if (!capture || !canRebindStablePrefixCaret(anchorBinding, capture.revision)) return undefined;
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.resolveTextRangeToPointAtRevision(revision, {
      anchor: copyCoreAddress(anchorBinding.address),
      focus: { ...focus },
    }),
  );
  if (!value) return undefined;
  return mapTextRangeFromPointResponse(state, bindings, capture, value);
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
      return {
        status: 'resolved',
        ...common,
        caret: bindReaderCaret(bindings, capture, value.resolution.caret),
      };
    }
    case 'unavailable':
      return { status: 'unavailable', ...common, reason: value.resolution.reason };
    case 'miss':
      return { status: 'miss', ...common };
  }
}

async function resolveTextRange(
  state: BrowserReaderState,
  bindings: CaretBindings,
  anchor: ReaderTextCaret,
  focus: ReaderTextCaret,
): Promise<ReaderTextRangeResolution | undefined> {
  const anchorBinding = requireBoundCaret(bindings, anchor);
  const focusBinding = requireBoundCaret(bindings, focus);
  if (!sameBoundRevision(anchorBinding, focusBinding)) return undefined;
  const capture = captureInteraction(state);
  if (!capture || !sameRevision(capture.revision, anchorBinding.revision)) return undefined;

  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.resolveTextRangeAtRevision(revision, {
      anchor: copyCoreAddress(anchorBinding.address),
      focus: copyCoreAddress(focusBinding.address),
    }),
  );
  if (!value) return undefined;
  requireMatchingRevision(value.revisionId, capture);
  return mapRangeResolution(state, value, anchor, focus, anchorBinding, focusBinding);
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

async function resolveTextSelectionMovement(
  state: BrowserReaderState,
  bindings: CaretBindings,
  request: ReaderTextSelectionMovementRequest,
): Promise<ReaderTextSelectionMovementResolution | undefined> {
  const anchorBinding = requireBoundCaret(bindings, request.anchor);
  const focusBinding = requireBoundCaret(bindings, request.focus);
  if (!sameBoundRevision(anchorBinding, focusBinding)) return undefined;
  const capture = captureInteraction(state);
  if (
    !capture ||
    !canRebindStablePrefixCaret(anchorBinding, capture.revision) ||
    !canRebindStablePrefixCaret(focusBinding, capture.revision)
  ) {
    return undefined;
  }
  const value = await readCapturedInteraction(state, capture, (worker, revision) =>
    worker.resolveTextSelectionMovementAtRevision(revision, {
      anchor: copyCoreAddress(anchorBinding.address),
      focus: copyCoreAddress(focusBinding.address),
      movement: request.movement,
      ...(request.preferredInlinePosition === undefined
        ? {}
        : { preferredInlinePosition: request.preferredInlinePosition }),
    }),
  );
  if (!value) return undefined;
  requireMatchingRevision(value.revisionId, capture);
  return mapMovementResolution(state, bindings, capture, anchorBinding.address, value);
}

function mapMovementResolution(
  state: BrowserReaderState,
  bindings: CaretBindings,
  capture: BrowserReaderInteractionCapture,
  requestedAnchor: CoreTextCaretAddress,
  value: CoreTextSelectionMovementResponse,
): ReaderTextSelectionMovementResolution {
  const resolution = value.resolution;
  if (resolution.status !== 'resolved') return { ...resolution };
  requireAddressMatch(resolution.anchorCaret.address, requestedAnchor, 'movement anchor');
  requireCaretProjection(state, resolution.anchorCaret.address.pageIndex, 'movement anchor caret');
  requireCaretProjection(state, resolution.focusCaret.address.pageIndex, 'movement focus caret');
  const anchor = bindReaderCaret(bindings, capture, resolution.anchorCaret);
  const focus = bindReaderCaret(bindings, capture, resolution.focusCaret);
  const mapped = mapRangeResolution(
    state,
    { revisionId: value.revisionId, resolution: { status: 'resolved', range: resolution.range } },
    anchor,
    focus,
    requireBoundCaret(bindings, anchor),
    requireBoundCaret(bindings, focus),
  );
  if (mapped.status !== 'resolved') {
    throw new Error('Reader text selection movement did not resolve its range');
  }
  return {
    status: 'resolved',
    range: mapped.range,
    ...(resolution.preferredInlinePosition === undefined
      ? {}
      : { preferredInlinePosition: resolution.preferredInlinePosition }),
  };
}

function requireCaretProjection(
  state: BrowserReaderState,
  pageIndex: number,
  subject: string,
): void {
  requirePageInCommittedNavigation(state, pageIndex, subject);
}
