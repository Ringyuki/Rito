import type {
  ReaderTextCaret,
  ReaderTextCaretResolution,
  ReaderTextPoint,
  ReaderTextRangeResolution,
  ReaderTextSelectionInteractions,
} from '../../../reader';
import type { CoreTextCaretResponse } from '../core-contracts';
import {
  captureInteraction,
  readCapturedInteraction,
  sameRevision,
  type BrowserReaderInteractionCapture,
} from './interaction-capture';
import { resolveTextRangeFromPoints } from './text-selection-from-points';
import {
  bindReaderCaret,
  copyCoreAddress,
  mapRangeResolution,
  requireBoundCaret,
  requireMatchingPageProjection,
  requireMatchingRevision,
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
    resolveTextRangeFromPoints: (request) => resolveTextRangeFromPoints(state, bindings, request),
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
