import type {
  CoreTextCaret,
  CoreTextCaretAddress,
  CoreTextRangeFromPointsResponse,
  CoreVersioned,
} from '../../src/bindings/browser/core-contracts';
import type { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { createWorker } from './browser-reader-reflow-fixtures';

export function requireTextSelection(
  interactions: ReturnType<typeof createBrowserReaderInteractions>,
) {
  const capability = interactions.textSelection;
  if (!capability) throw new Error('Expected exact text selection capability');
  return capability;
}

export function request() {
  return {
    anchor: { pageIndex: 0, x: 12, y: 20 },
    focus: { pageIndex: 0, x: 48, y: 20 },
    granularity: 'word' as const,
  };
}

export function handle() {
  return { revisionId: 'rev', revisionVersion: 0 };
}

export function caretAddress(charIndex: number): CoreTextCaretAddress {
  return {
    pageIndex: 0,
    blockIndex: 0,
    lineIndex: 0,
    runIndex: 0,
    charIndex,
    affinity: 'downstream',
  };
}

export function versionedPointRange(
  anchor: CoreTextCaretAddress,
  focus: CoreTextCaretAddress,
): CoreVersioned<CoreTextRangeFromPointsResponse> {
  return versionedPointResolution({
    status: 'resolved',
    anchorCaret: coreCaret(anchor),
    focusCaret: coreCaret(focus),
    range: resolvedRange(anchor, focus),
  });
}

export function versionedPointResolution(
  resolution: CoreTextRangeFromPointsResponse['resolution'],
): CoreVersioned<CoreTextRangeFromPointsResponse> {
  return { revision: handle(), value: { revisionId: 'rev', resolution } };
}

export function resolvedRangeResponse(anchor: CoreTextCaretAddress, focus: CoreTextCaretAddress) {
  return {
    revisionId: 'rev',
    resolution: { status: 'resolved' as const, range: resolvedRange(anchor, focus) },
  };
}

export function changeIdentity(
  state: BrowserReaderState,
  change: 'worker' | 'generation' | 'version',
): void {
  const current = state.revisionHandle;
  if (!current) throw new Error('Test revision is missing');
  if (change === 'worker') {
    state.worker = createWorker(() => undefined, 'replacement-point-range-session').worker;
    return;
  }
  state.revisionHandle = {
    ...current,
    ...(change === 'generation'
      ? { commitGeneration: current.commitGeneration + 1 }
      : { revisionVersion: current.revisionVersion + 1 }),
  };
  if (change === 'generation') state.commitGeneration += 1;
}

function coreCaret(address: CoreTextCaretAddress): CoreTextCaret {
  return {
    address,
    geometry: { x: address.charIndex * 10, y: 12, height: 18 },
    sourceLocator: {
      href: 'chapter.xhtml',
      sourcePoint: { nodePath: [0], textOffset: address.charIndex },
    },
  };
}

function resolvedRange(anchor: CoreTextCaretAddress, focus: CoreTextCaretAddress) {
  return {
    anchor,
    focus,
    start: anchor,
    end: focus,
    selectedText: 'word',
    sourceLocator: {
      href: 'chapter.xhtml',
      sourceRange: {
        start: { nodePath: [0], textOffset: 1 },
        end: { nodePath: [0], textOffset: 4 },
      },
    },
    rects: [
      {
        pageIndex: 0,
        spreadIndex: 0,
        x: 10,
        y: 12,
        width: 30,
        height: 18,
        blockIndex: 0,
        lineIndex: 0,
        runIndex: 0,
        startCharIndex: 1,
        endCharIndex: 4,
      },
    ],
  };
}
