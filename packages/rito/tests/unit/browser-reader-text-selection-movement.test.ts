import { describe, expect, it } from 'vitest';
import type {
  CoreTextCaretAddress,
  CoreTextCaretResponse,
  CoreTextSelectionMovementResponse,
  CoreVersioned,
} from '../../src/bindings/browser/core-contracts';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type {
  ReaderTextCaret,
  ReaderTextCaretResolution,
  ReaderTextSelectionInteractions,
} from '../../src/reader';
import {
  createDeferred,
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader exact text selection movement', () => {
  it('atomically moves two privately bound carets and publishes new branded endpoints', async () => {
    const fixture = readyFixture();
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, focus, anchorAddress, focusAddress] = await bindCaretPair(fixture, selection);
    const movedFocus = caretAddress(0, 4);
    fixture.resolveTextSelectionMovementAtRevision.mockResolvedValue(
      versionedMovement(anchorAddress, movedFocus, 0, 24),
    );

    const result = await selection.resolveTextSelectionMovement({
      anchor,
      focus,
      movement: 'lineDown',
      preferredInlinePosition: 19.5,
    });

    expect(fixture.resolveTextSelectionMovementAtRevision).toHaveBeenCalledWith(handle(), {
      anchor: anchorAddress,
      focus: focusAddress,
      movement: 'lineDown',
      preferredInlinePosition: 19.5,
    });
    expect(result?.status).toBe('resolved');
    if (!result || result.status !== 'resolved') throw new Error('Expected resolved movement');
    expect(result.preferredInlinePosition).toBe(24);
    expect(result.range.anchor).not.toBe(anchor);
    expect(result.range.focus).not.toBe(focus);
    expect(result.range.anchor).not.toHaveProperty('address');
    expect(result.range.focus).not.toHaveProperty('address');
    expect(result.range).toMatchObject({ selectedText: 'text', rects: [{ spreadIndex: 0 }] });
  });

  it.each([
    { status: 'boundary', boundary: 'start' } as const,
    { status: 'pending', boundary: 'end' } as const,
    { status: 'unavailable', reason: 'shapeUnavailable' } as const,
  ])('preserves the $status movement outcome', async (resolution) => {
    const fixture = readyFixture();
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, focus] = await bindCaretPair(fixture, selection);
    fixture.resolveTextSelectionMovementAtRevision.mockResolvedValue({
      revision: handle(),
      value: { revisionId: 'rev', resolution },
    });

    await expect(
      selection.resolveTextSelectionMovement({
        anchor,
        focus,
        movement: 'characterRight',
      }),
    ).resolves.toEqual(resolution);
  });

  it('forwards the Windows word-start-right movement without aliasing it to word-end', async () => {
    const fixture = readyFixture();
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, focus, anchorAddress, focusAddress] = await bindCaretPair(fixture, selection);
    fixture.resolveTextSelectionMovementAtRevision.mockResolvedValue({
      revision: handle(),
      value: {
        revisionId: 'rev',
        resolution: { status: 'boundary', boundary: 'end' },
      },
    });

    await expect(
      selection.resolveTextSelectionMovement({
        anchor,
        focus,
        movement: 'wordStartRight',
      }),
    ).resolves.toEqual({ status: 'boundary', boundary: 'end' });
    expect(fixture.resolveTextSelectionMovementAtRevision).toHaveBeenCalledWith(handle(), {
      anchor: anchorAddress,
      focus: focusAddress,
      movement: 'wordStartRight',
    });
  });

  it.each(['paragraphPreviousStart', 'paragraphNextStart'] as const)(
    'forwards the %s movement without aliasing it to a directional paragraph movement',
    async (movement) => {
      const fixture = readyFixture();
      const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
      const [anchor, focus, anchorAddress, focusAddress] = await bindCaretPair(fixture, selection);
      fixture.resolveTextSelectionMovementAtRevision.mockResolvedValue({
        revision: handle(),
        value: {
          revisionId: 'rev',
          resolution: { status: 'boundary', boundary: 'end' },
        },
      });

      await expect(
        selection.resolveTextSelectionMovement({ anchor, focus, movement }),
      ).resolves.toEqual({ status: 'boundary', boundary: 'end' });
      expect(fixture.resolveTextSelectionMovementAtRevision).toHaveBeenCalledWith(handle(), {
        anchor: anchorAddress,
        focus: focusAddress,
        movement,
      });
    },
  );

  it('rebinds both old endpoints across one stable-prefix continuation advance', async () => {
    const fixture = readyFixture();
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, focus, anchorAddress] = await bindCaretPair(fixture, selection);
    setRevisionState(fixture.state, { ...revisionSummary('rev', 4, 4), revisionVersion: 1 });
    fixture.resolveTextSelectionMovementAtRevision.mockResolvedValue(
      versionedMovement(anchorAddress, caretAddress(0, 4), 1),
    );

    await expect(
      selection.resolveTextSelectionMovement({
        anchor,
        focus,
        movement: 'characterRight',
      }),
    ).resolves.toMatchObject({ status: 'resolved' });
    expect(fixture.resolveTextSelectionMovementAtRevision).toHaveBeenCalledOnce();
  });

  it('requires both endpoints to share the same old revision before dispatch', async () => {
    const fixture = readyFixture();
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    fixture.resolveTextCaretAtRevision.mockResolvedValueOnce(versionedCaret(caretAddress(0, 1)));
    const anchor = resolvedCaret(await selection.resolveCaret({ pageIndex: 0, x: 1, y: 0 }));
    setRevisionState(fixture.state, { ...revisionSummary('rev', 4, 4), revisionVersion: 1 });
    fixture.resolveTextCaretAtRevision.mockResolvedValueOnce(versionedCaret(caretAddress(0, 2), 1));
    const focus = resolvedCaret(await selection.resolveCaret({ pageIndex: 0, x: 2, y: 0 }));

    await expect(
      selection.resolveTextSelectionMovement({
        anchor,
        focus,
        movement: 'characterRight',
      }),
    ).resolves.toBeUndefined();
    expect(fixture.resolveTextSelectionMovementAtRevision).not.toHaveBeenCalled();
  });

  it('drops an in-flight movement after the committed revision changes', async () => {
    const fixture = readyFixture();
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, focus, anchorAddress] = await bindCaretPair(fixture, selection);
    const deferred = createDeferred<CoreVersioned<CoreTextSelectionMovementResponse>>();
    fixture.resolveTextSelectionMovementAtRevision.mockReturnValue(deferred.promise);
    const pending = selection.resolveTextSelectionMovement({
      anchor,
      focus,
      movement: 'characterRight',
    });

    setRevisionState(fixture.state, { ...revisionSummary('rev', 4, 4), revisionVersion: 1 });
    deferred.resolve(versionedMovement(anchorAddress, caretAddress(0, 4)));

    await expect(pending).resolves.toBeUndefined();
  });

  it.each([
    ['revision', /does not match its revision request/],
    ['anchor', /movement anchor does not match its request/],
    ['range', /range focus does not match its request/],
    ['caretPage', /movement focus caret does not match committed navigation/],
    ['rectSpread', /text range rectangle does not match committed navigation/],
  ] as const)('rejects a forged %s movement response', async (forgery, pattern) => {
    const fixture = readyFixture();
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, focus, anchorAddress] = await bindCaretPair(fixture, selection);
    const response = movementResponse(anchorAddress, caretAddress(0, 4));
    forgeMovement(response, forgery);
    fixture.resolveTextSelectionMovementAtRevision.mockResolvedValue({
      revision: handle(),
      value: response,
    });

    await expect(
      selection.resolveTextSelectionMovement({
        anchor,
        focus,
        movement: 'characterRight',
      }),
    ).rejects.toThrow(pattern);
  });
});

function readyFixture() {
  const fixture = createWorker(() => undefined, 'movement-session');
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 4, 4));
  return { ...fixture, state };
}

function requireTextSelection(interactions: ReturnType<typeof createBrowserReaderInteractions>) {
  const capability = interactions.textSelection;
  if (!capability?.resolveTextSelectionMovement) {
    throw new Error('Expected exact text selection movement capability');
  }
  return capability as ReaderTextSelectionInteractions & {
    resolveTextSelectionMovement: NonNullable<
      ReaderTextSelectionInteractions['resolveTextSelectionMovement']
    >;
  };
}

async function bindCaretPair(
  fixture: ReturnType<typeof readyFixture>,
  selection: ReaderTextSelectionInteractions,
): Promise<
  readonly [ReaderTextCaret, ReaderTextCaret, CoreTextCaretAddress, CoreTextCaretAddress]
> {
  const anchorAddress = caretAddress(0, 1);
  const focusAddress = caretAddress(0, 2);
  fixture.resolveTextCaretAtRevision
    .mockResolvedValueOnce(versionedCaret(anchorAddress))
    .mockResolvedValueOnce(versionedCaret(focusAddress));
  const anchor = resolvedCaret(await selection.resolveCaret({ pageIndex: 0, x: 1, y: 0 }));
  const focus = resolvedCaret(await selection.resolveCaret({ pageIndex: 0, x: 2, y: 0 }));
  return [anchor, focus, anchorAddress, focusAddress];
}

function resolvedCaret(result: ReaderTextCaretResolution | undefined): ReaderTextCaret {
  if (!result || result.status !== 'resolved') throw new Error('Expected a resolved caret');
  return result.caret;
}

function handle(revisionVersion = 0) {
  return { revisionId: 'rev', revisionVersion };
}

function caretAddress(pageIndex: number, charIndex: number): CoreTextCaretAddress {
  return {
    pageIndex,
    blockIndex: 0,
    lineIndex: 0,
    runIndex: 0,
    charIndex,
    affinity: 'downstream',
  };
}

function versionedCaret(
  address: CoreTextCaretAddress,
  revisionVersion = 0,
): CoreVersioned<CoreTextCaretResponse> {
  return {
    revision: handle(revisionVersion),
    value: {
      revisionId: 'rev',
      pageIndex: address.pageIndex,
      spreadIndex: address.pageIndex,
      resolution: { status: 'resolved', caret: coreCaret(address) },
    },
  };
}

function versionedMovement(
  anchor: CoreTextCaretAddress,
  focus: CoreTextCaretAddress,
  revisionVersion = 0,
  preferredInlinePosition?: number,
): CoreVersioned<CoreTextSelectionMovementResponse> {
  return {
    revision: handle(revisionVersion),
    value: movementResponse(anchor, focus, preferredInlinePosition),
  };
}

function movementResponse(
  anchor: CoreTextCaretAddress,
  focus: CoreTextCaretAddress,
  preferredInlinePosition?: number,
): CoreTextSelectionMovementResponse {
  return {
    revisionId: 'rev',
    resolution: {
      status: 'resolved',
      anchorCaret: coreCaret(anchor),
      focusCaret: coreCaret(focus),
      range: {
        anchor,
        focus,
        start: anchor,
        end: focus,
        selectedText: 'text',
        sourceLocator: {
          href: 'chapter.xhtml',
          sourceRange: {
            start: { nodePath: [0], textOffset: anchor.charIndex },
            end: { nodePath: [0], textOffset: focus.charIndex },
          },
        },
        rects: [
          {
            pageIndex: 0,
            spreadIndex: 0,
            x: 1,
            y: 0,
            width: 3,
            height: 18,
            blockIndex: 0,
            lineIndex: 0,
            runIndex: 0,
            startCharIndex: 1,
            endCharIndex: 4,
          },
        ],
      },
      ...(preferredInlinePosition === undefined ? {} : { preferredInlinePosition }),
    },
  };
}

function coreCaret(address: CoreTextCaretAddress) {
  return {
    address,
    geometry: { x: address.charIndex, y: 0, height: 18 },
    sourceLocator: {
      href: 'chapter.xhtml',
      sourcePoint: { nodePath: [0], textOffset: address.charIndex },
    },
  };
}

function forgeMovement(
  response: CoreTextSelectionMovementResponse,
  forgery: 'revision' | 'anchor' | 'range' | 'caretPage' | 'rectSpread',
): void {
  if (response.resolution.status !== 'resolved') throw new Error('Expected resolved movement');
  if (forgery === 'revision') {
    Object.assign(response, { revisionId: 'other' });
  } else if (forgery === 'anchor') {
    Object.assign(response.resolution.anchorCaret, { address: caretAddress(0, 9) });
  } else if (forgery === 'range') {
    Object.assign(response.resolution.range, { focus: caretAddress(0, 9) });
  } else if (forgery === 'caretPage') {
    Object.assign(response.resolution.focusCaret, { address: caretAddress(9, 4) });
  } else {
    const rect = response.resolution.range.rects[0];
    if (!rect) throw new Error('Expected movement range rectangle');
    Object.assign(rect, { spreadIndex: 2 });
  }
}
