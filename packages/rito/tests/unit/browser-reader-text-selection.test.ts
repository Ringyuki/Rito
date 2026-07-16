import { describe, expect, it } from 'vitest';
import type {
  CoreTextRangeResponse,
  CoreTextCaretAddress,
  CoreTextCaretResponse,
  CoreTextRangeFromPointsResponse,
  CoreVersioned,
} from '../../src/bindings/browser/core-contracts';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type { ReaderTextCaret, ReaderTextCaretResolution } from '../../src/reader';
import {
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader exact text selection', () => {
  it('maps point resolutions without exposing the revision-local caret address', async () => {
    const fixture = readyFixture();
    const address = caretAddress(0, 4, 'downstream');
    fixture.resolveTextCaretAtRevision.mockResolvedValue(versionedCaret(address));
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));

    const result = await textSelection.resolveCaret({ pageIndex: 0, x: 24, y: 30 });

    expect(fixture.resolveTextCaretAtRevision).toHaveBeenCalledWith(handle(), {
      pageIndex: 0,
      x: 24,
      y: 30,
    });
    expect(result).toEqual({
      status: 'resolved',
      pageIndex: 0,
      spreadIndex: 0,
      caret: {
        pageIndex: 0,
        geometry: { x: 20, y: 12, height: 18 },
        sourceLocator: {
          href: 'chapter.xhtml',
          sourcePoint: { nodePath: [0, 1], textOffset: 4 },
        },
      },
    });
    expect(resolvedCaret(result)).not.toHaveProperty('address');
  });

  it('preserves miss and unavailable point outcomes', async () => {
    const fixture = readyFixture();
    fixture.resolveTextCaretAtRevision
      .mockResolvedValueOnce(
        versionedCaretResolution({ status: 'unavailable', reason: 'shapeUnavailable' }),
      )
      .mockResolvedValueOnce(versionedCaretResolution({ status: 'miss' }));
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));

    await expect(textSelection.resolveCaret({ pageIndex: 0, x: 1, y: 2 })).resolves.toEqual({
      status: 'unavailable',
      pageIndex: 0,
      spreadIndex: 0,
      reason: 'shapeUnavailable',
    });
    await expect(textSelection.resolveCaret({ pageIndex: 0, x: 3, y: 4 })).resolves.toEqual({
      status: 'miss',
      pageIndex: 0,
      spreadIndex: 0,
    });
  });

  it('uses privately bound addresses and maps normalized range endpoints to their carets', async () => {
    const fixture = readyFixture();
    const anchorAddress = caretAddress(0, 8, 'upstream');
    const focusAddress = caretAddress(0, 2, 'downstream');
    fixture.resolveTextCaretAtRevision
      .mockResolvedValueOnce(versionedCaret(anchorAddress))
      .mockResolvedValueOnce(versionedCaret(focusAddress));
    fixture.resolveTextRangeAtRevision.mockResolvedValue({
      revision: handle(),
      value: resolvedRange(focusAddress, anchorAddress, anchorAddress, focusAddress),
    });
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const anchor = resolvedCaret(await textSelection.resolveCaret({ pageIndex: 0, x: 40, y: 10 }));
    const focus = resolvedCaret(await textSelection.resolveCaret({ pageIndex: 0, x: 10, y: 10 }));

    const result = await textSelection.resolveTextRange(anchor, focus);

    expect(fixture.resolveTextRangeAtRevision).toHaveBeenCalledWith(handle(), {
      anchor: anchorAddress,
      focus: focusAddress,
    });
    expect(result?.status).toBe('resolved');
    if (!result || result.status !== 'resolved') throw new Error('Expected a resolved range');
    expect(result.range.anchor).toBe(anchor);
    expect(result.range.focus).toBe(focus);
    expect(result.range.start).toBe(focus);
    expect(result.range.end).toBe(anchor);
    expect(result.range).toMatchObject({
      selectedText: 'selected',
      sourceLocator: {
        href: 'chapter.xhtml',
        sourceRange: {
          start: { nodePath: [0, 1], textOffset: 2 },
          end: { nodePath: [0, 1], textOffset: 8 },
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
        },
      ],
    });
    expect(result.range.rects[0]).not.toHaveProperty('blockIndex');
  });

  it('maps an unavailable text-range range without publishing geometry', async () => {
    const fixture = readyFixture();
    const anchorAddress = caretAddress(0, 1, 'downstream');
    const focusAddress = caretAddress(0, 3, 'upstream');
    fixture.resolveTextCaretAtRevision
      .mockResolvedValueOnce(versionedCaret(anchorAddress))
      .mockResolvedValueOnce(versionedCaret(focusAddress));
    fixture.resolveTextRangeAtRevision.mockResolvedValue({
      revision: handle(),
      value: {
        revisionId: 'rev',
        resolution: { status: 'unavailable', reason: 'differentChapter' },
      },
    });
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const anchor = resolvedCaret(await textSelection.resolveCaret({ pageIndex: 0, x: 1, y: 1 }));
    const focus = resolvedCaret(await textSelection.resolveCaret({ pageIndex: 0, x: 3, y: 1 }));

    await expect(textSelection.resolveTextRange(anchor, focus)).resolves.toEqual({
      status: 'unavailable',
      reason: 'differentChapter',
    });
  });

  it('atomically rebinds a stable-prefix caret in a later bounded revision', async () => {
    const fixture = readyFixture();
    const anchorAddress = caretAddress(0, 1, 'downstream');
    const focusAddress = caretAddress(0, 4, 'upstream');
    fixture.resolveTextCaretAtRevision.mockResolvedValue(versionedCaret(anchorAddress));
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const anchor = resolvedCaret(await textSelection.resolveCaret({ pageIndex: 0, x: 1, y: 1 }));
    setRevisionState(fixture.state, {
      ...revisionSummary('rev', 4, 4),
      revisionVersion: 1,
    });
    fixture.resolveTextRangeToPointAtRevision.mockResolvedValue(
      versionedRangeToPoint(anchorAddress, focusAddress, 1),
    );

    const result = await textSelection.resolveTextRangeToPoint(anchor, {
      pageIndex: 0,
      x: 40,
      y: 10,
    });

    expect(fixture.resolveTextRangeToPointAtRevision).toHaveBeenCalledWith(
      { revisionId: 'rev', revisionVersion: 1 },
      {
        anchor: anchorAddress,
        focus: { pageIndex: 0, x: 40, y: 10 },
      },
    );
    expect(result?.status).toBe('resolved');
    if (!result || result.status !== 'resolved') throw new Error('Expected a resolved range');
    expect(result.range.anchor).not.toBe(anchor);
    expect(result.range.anchor.pageIndex).toBe(0);
    expect(result.range.focus.pageIndex).toBe(0);
    expect(result.range.selectedText).toBe('selected');
  });

  it('validates point coordinates before dispatch', async () => {
    const fixture = readyFixture();
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));

    await expect(textSelection.resolveCaret({ pageIndex: -1, x: 0, y: 0 })).rejects.toThrow(
      'pageIndex',
    );
    await expect(textSelection.resolveCaret({ pageIndex: 0, x: Number.NaN, y: 0 })).rejects.toThrow(
      'finite',
    );
    expect(fixture.resolveTextCaretAtRevision).not.toHaveBeenCalled();
  });
});

function readyFixture() {
  const fixture = createWorker(() => undefined, 'text-selection-session');
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 4, 4));
  return { ...fixture, state };
}

function requireTextSelection(interactions: ReturnType<typeof createBrowserReaderInteractions>) {
  const capability = interactions.textSelection;
  if (!capability) throw new Error('Expected exact text selection capability');
  return capability;
}

function resolvedCaret(result: ReaderTextCaretResolution | undefined): ReaderTextCaret {
  if (!result || result.status !== 'resolved') throw new Error('Expected a resolved caret');
  return result.caret;
}

function handle() {
  return { revisionId: 'rev', revisionVersion: 0 };
}

function caretAddress(
  pageIndex: number,
  charIndex: number,
  affinity: CoreTextCaretAddress['affinity'],
): CoreTextCaretAddress {
  return {
    pageIndex,
    blockIndex: 0,
    lineIndex: 0,
    runIndex: 0,
    charIndex,
    affinity,
  };
}

function versionedCaret(address: CoreTextCaretAddress): CoreVersioned<CoreTextCaretResponse> {
  return versionedCaretResolution({
    status: 'resolved',
    caret: {
      address,
      geometry: { x: 20, y: 12, height: 18 },
      sourceLocator: {
        href: 'chapter.xhtml',
        sourcePoint: { nodePath: [0, 1], textOffset: address.charIndex },
      },
    },
  });
}

function versionedCaretResolution(
  resolution: CoreTextCaretResponse['resolution'],
): CoreVersioned<CoreTextCaretResponse> {
  return {
    revision: handle(),
    value: { revisionId: 'rev', pageIndex: 0, spreadIndex: 0, resolution },
  };
}

function resolvedRange(
  start: CoreTextCaretAddress,
  end: CoreTextCaretAddress,
  anchor: CoreTextCaretAddress,
  focus: CoreTextCaretAddress,
): CoreTextRangeResponse {
  return {
    revisionId: 'rev',
    resolution: {
      status: 'resolved',
      range: {
        anchor,
        focus,
        start,
        end,
        selectedText: 'selected',
        sourceLocator: {
          href: 'chapter.xhtml',
          sourceRange: {
            start: { nodePath: [0, 1], textOffset: 2 },
            end: { nodePath: [0, 1], textOffset: 8 },
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
            startCharIndex: 2,
            endCharIndex: 8,
          },
        ],
      },
    },
  };
}

function versionedRangeToPoint(
  anchor: CoreTextCaretAddress,
  focus: CoreTextCaretAddress,
  revisionVersion: number,
): CoreVersioned<CoreTextRangeFromPointsResponse> {
  const range = resolvedRange(anchor, focus, anchor, focus);
  if (range.resolution.status !== 'resolved') throw new Error('Expected a resolved fixture range');
  return {
    revision: { revisionId: 'rev', revisionVersion },
    value: {
      revisionId: 'rev',
      resolution: {
        status: 'resolved',
        anchorCaret: coreCaret(anchor),
        focusCaret: coreCaret(focus),
        range: range.resolution.range,
      },
    },
  };
}

function coreCaret(address: CoreTextCaretAddress) {
  return {
    address,
    geometry: { x: address.charIndex * 10, y: 12, height: 18 },
    sourceLocator: {
      href: 'chapter.xhtml',
      sourcePoint: { nodePath: [0, 1], textOffset: address.charIndex },
    },
  };
}
