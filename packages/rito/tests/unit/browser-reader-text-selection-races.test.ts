import { describe, expect, it } from 'vitest';
import type {
  CoreSameFlowTextRangeResponse,
  CoreTextCaretAddress,
  CoreTextCaretResponse,
  CoreVersioned,
} from '../../src/bindings/browser/core-contracts';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import type { ReaderTextCaret, ReaderTextCaretResolution } from '../../src/reader';
import {
  createDeferred,
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader exact text selection races', () => {
  it.each(['worker', 'generation', 'version'] as const)(
    'drops an in-flight caret after a %s identity change',
    async (change) => {
      const fixture = readyFixture();
      const deferred = createDeferred<CoreVersioned<CoreTextCaretResponse>>();
      fixture.resolveTextCaretAtRevision.mockReturnValue(deferred.promise);
      const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
      const pending = textSelection.resolveCaret({ pageIndex: 0, x: 2, y: 3 });

      changeIdentity(fixture.state, change);
      deferred.resolve(versionedCaret(caretAddress(0, 2)));

      await expect(pending).resolves.toBeUndefined();
    },
  );

  it('turns a rejected disposed caret read into an unavailable result', async () => {
    const fixture = readyFixture();
    const deferred = createDeferred<CoreVersioned<CoreTextCaretResponse>>();
    fixture.resolveTextCaretAtRevision.mockReturnValue(deferred.promise);
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const pending = textSelection.resolveCaret({ pageIndex: 0, x: 2, y: 3 });

    fixture.state.disposed = true;
    deferred.reject(new Error('worker disposed'));

    await expect(pending).resolves.toBeUndefined();
  });

  it('does not dispatch point reads while a visual preview is active', async () => {
    const fixture = readyFixture();
    fixture.state.visualPreview = {} as typeof fixture.state.visualPreview;
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));

    await expect(textSelection.resolveCaret({ pageIndex: 0, x: 2, y: 3 })).resolves.toBeUndefined();
    expect(fixture.resolveTextCaretAtRevision).not.toHaveBeenCalled();
  });

  it.each(['worker', 'generation', 'version'] as const)(
    'rejects bound carets after a %s identity change without dispatching a range read',
    async (change) => {
      const fixture = readyFixture();
      const interactions = createBrowserReaderInteractions(fixture.state);
      const textSelection = requireTextSelection(interactions);
      const [anchor, focus] = await bindCaretPair(fixture, textSelection);

      changeIdentity(fixture.state, change);

      await expect(textSelection.resolveSameFlowRange(anchor, focus)).resolves.toBeUndefined();
      expect(fixture.resolveSameFlowTextRangeAtRevision).not.toHaveBeenCalled();
    },
  );

  it('drops an in-flight range when a visual preview starts', async () => {
    const fixture = readyFixture();
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, focus, anchorAddress, focusAddress] = await bindCaretPair(
      fixture,
      textSelection,
    );
    const deferred = createDeferred<CoreVersioned<CoreSameFlowTextRangeResponse>>();
    fixture.resolveSameFlowTextRangeAtRevision.mockReturnValue(deferred.promise);
    const pending = textSelection.resolveSameFlowRange(anchor, focus);

    fixture.state.visualPreview = {} as typeof fixture.state.visualPreview;
    deferred.resolve(versionedRange(anchorAddress, focusAddress));

    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects cloned and cross-Reader carets before dispatch', async () => {
    const first = readyFixture('first-selection-session');
    const second = readyFixture('second-selection-session');
    const firstSelection = requireTextSelection(createBrowserReaderInteractions(first.state));
    const secondSelection = requireTextSelection(createBrowserReaderInteractions(second.state));
    first.resolveTextCaretAtRevision.mockResolvedValue(versionedCaret(caretAddress(0, 1)));
    second.resolveTextCaretAtRevision.mockResolvedValue(versionedCaret(caretAddress(0, 2)));
    const firstCaret = resolvedCaret(
      await firstSelection.resolveCaret({ pageIndex: 0, x: 1, y: 1 }),
    );
    const secondCaret = resolvedCaret(
      await secondSelection.resolveCaret({ pageIndex: 0, x: 2, y: 1 }),
    );
    const clonedCaret = { ...firstCaret };

    await expect(firstSelection.resolveSameFlowRange(firstCaret, secondCaret)).rejects.toThrow(
      'does not belong',
    );
    await expect(firstSelection.resolveSameFlowRange(firstCaret, clonedCaret)).rejects.toThrow(
      'does not belong',
    );
    expect(first.resolveSameFlowTextRangeAtRevision).not.toHaveBeenCalled();
  });

  it('rejects a mismatched response revision while the request remains current', async () => {
    const fixture = readyFixture();
    fixture.resolveTextCaretAtRevision.mockResolvedValue({
      revision: { revisionId: 'rev', revisionVersion: 1 },
      value: caretResponse(caretAddress(0, 1)),
    });
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));

    await expect(textSelection.resolveCaret({ pageIndex: 0, x: 1, y: 1 })).rejects.toThrow(
      'does not match its revision request',
    );
  });
});

type TextSelection = NonNullable<
  ReturnType<typeof createBrowserReaderInteractions>['textSelection']
>;

function readyFixture(sessionId = 'text-selection-race-session') {
  const fixture = createWorker(() => undefined, sessionId);
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 4, 4));
  return { ...fixture, state };
}

function requireTextSelection(interactions: ReturnType<typeof createBrowserReaderInteractions>) {
  const capability = interactions.textSelection;
  if (!capability) throw new Error('Expected exact text selection capability');
  return capability;
}

async function bindCaretPair(
  fixture: ReturnType<typeof readyFixture>,
  textSelection: TextSelection,
): Promise<
  readonly [ReaderTextCaret, ReaderTextCaret, CoreTextCaretAddress, CoreTextCaretAddress]
> {
  const anchorAddress = caretAddress(0, 1);
  const focusAddress = caretAddress(0, 4);
  fixture.resolveTextCaretAtRevision
    .mockResolvedValueOnce(versionedCaret(anchorAddress))
    .mockResolvedValueOnce(versionedCaret(focusAddress));
  const anchor = resolvedCaret(await textSelection.resolveCaret({ pageIndex: 0, x: 1, y: 1 }));
  const focus = resolvedCaret(await textSelection.resolveCaret({ pageIndex: 0, x: 4, y: 1 }));
  return [anchor, focus, anchorAddress, focusAddress];
}

function resolvedCaret(result: ReaderTextCaretResolution | undefined): ReaderTextCaret {
  if (!result || result.status !== 'resolved') throw new Error('Expected a resolved caret');
  return result.caret;
}

function changeIdentity(
  state: BrowserReaderState,
  change: 'worker' | 'generation' | 'version',
): void {
  const current = state.revisionHandle;
  if (!current) throw new Error('Test revision is missing');
  if (change === 'worker') {
    state.worker = createWorker(() => undefined, 'replacement-selection-session').worker;
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

function handle() {
  return { revisionId: 'rev', revisionVersion: 0 };
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

function versionedCaret(address: CoreTextCaretAddress): CoreVersioned<CoreTextCaretResponse> {
  return { revision: handle(), value: caretResponse(address) };
}

function caretResponse(address: CoreTextCaretAddress): CoreTextCaretResponse {
  return {
    revisionId: 'rev',
    pageIndex: address.pageIndex,
    spreadIndex: address.pageIndex,
    resolution: {
      status: 'resolved',
      caret: {
        address,
        geometry: { x: address.charIndex, y: 0, height: 18 },
        sourceLocator: {
          href: 'chapter.xhtml',
          sourcePoint: { nodePath: [0], textOffset: address.charIndex },
        },
      },
    },
  };
}

function versionedRange(
  anchor: CoreTextCaretAddress,
  focus: CoreTextCaretAddress,
): CoreVersioned<CoreSameFlowTextRangeResponse> {
  return {
    revision: handle(),
    value: {
      revisionId: 'rev',
      resolution: {
        status: 'resolved',
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
      },
    },
  };
}
