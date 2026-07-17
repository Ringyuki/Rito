import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserReaderBoundedSnapshot,
  CoreTextRangeResponse,
  CoreTextRangeFromPointsResponse,
  CoreTextCaretAddress,
  CoreTextCaretResponse,
  CoreVersioned,
} from '../../src/bindings/browser/core-contracts';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type {
  BrowserReaderBoundedSessionOwner,
  BrowserReaderState,
} from '../../src/bindings/browser/reader/types';
import { closeExactRevisionReadGate } from '../../src/bindings/browser/reader/pipeline/revision-handle';
import {
  recordBrowserReaderAcceptedRevision,
  restoreBrowserReaderExactReads,
  suspendBrowserReaderExactReads,
} from '../../src/bindings/browser/reader-session-host';
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

  it('does not dispatch point reads while the exact gate is closed', async () => {
    const fixture = readyFixture();
    closeExactRevisionReadGate(fixture.state);
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

      await expect(textSelection.resolveTextRange(anchor, focus)).resolves.toBeUndefined();
      expect(fixture.resolveTextRangeAtRevision).not.toHaveBeenCalled();
    },
  );

  it('drops an in-flight range when the exact gate closes', async () => {
    const fixture = readyFixture();
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, focus, anchorAddress, focusAddress] = await bindCaretPair(
      fixture,
      textSelection,
    );
    const deferred = createDeferred<CoreVersioned<CoreTextRangeResponse>>();
    fixture.resolveTextRangeAtRevision.mockReturnValue(deferred.promise);
    const pending = textSelection.resolveTextRange(anchor, focus);

    closeExactRevisionReadGate(fixture.state);
    deferred.resolve(versionedRange(anchorAddress, focusAddress));

    await expect(pending).resolves.toBeUndefined();
  });

  it('rebinds a caret after an exact-read gate restores the same publication', async () => {
    const fixture = readyFixture();
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor, , anchorAddress, focusAddress] = await bindCaretPair(fixture, textSelection);
    const before = fixture.state.revisionHandle;
    if (!before) throw new Error('Expected an initial exact revision handle');
    const owner = installBoundedOwner(fixture.state);
    const gate = suspendBrowserReaderExactReads(fixture.state);
    if (!gate) throw new Error('Expected an exact read gate');
    expect(restoreBrowserReaderExactReads(fixture.state, gate)).toBe(true);
    expect(fixture.state.revisionHandle?.commitGeneration).not.toBe(before.commitGeneration);
    expect(fixture.state.revisionHandle?.publicationGeneration).toBe(before.publicationGeneration);
    expect(fixture.state.boundedSessions.current).toBe(owner);
    fixture.resolveTextRangeToPointAtRevision.mockResolvedValue(
      versionedRangeToPoint(anchorAddress, focusAddress),
    );

    await expect(
      textSelection.resolveTextRangeToPoint(anchor, { pageIndex: 0, x: 4, y: 1 }),
    ).resolves.toMatchObject({ status: 'resolved' });
    expect(fixture.resolveTextRangeToPointAtRevision).toHaveBeenCalledOnce();
  });

  it('does not rebind a caret across a same-version layout replacement', async () => {
    const fixture = readyFixture();
    const textSelection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const [anchor] = await bindCaretPair(fixture, textSelection);
    const before = fixture.state.revisionHandle;
    if (!before) throw new Error('Expected an initial exact revision handle');

    setRevisionState(fixture.state, revisionSummary('rev', 4, 4));
    expect(fixture.state.revisionHandle?.revisionVersion).toBe(before.revisionVersion);
    expect(fixture.state.revisionHandle?.publicationGeneration).not.toBe(
      before.publicationGeneration,
    );

    await expect(
      textSelection.resolveTextRangeToPoint(anchor, { pageIndex: 0, x: 4, y: 1 }),
    ).resolves.toBeUndefined();
    expect(fixture.resolveTextRangeToPointAtRevision).not.toHaveBeenCalled();
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

    await expect(firstSelection.resolveTextRange(firstCaret, secondCaret)).rejects.toThrow(
      'does not belong',
    );
    await expect(firstSelection.resolveTextRange(firstCaret, clonedCaret)).rejects.toThrow(
      'does not belong',
    );
    expect(first.resolveTextRangeAtRevision).not.toHaveBeenCalled();
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

function installBoundedOwner(state: BrowserReaderState): BrowserReaderBoundedSessionOwner {
  const owner: BrowserReaderBoundedSessionOwner = {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      currentSnapshot: vi.fn(
        () => ({ revision: state.revisionBundle.revision }) as BrowserReaderBoundedSnapshot,
      ),
      cancel: vi.fn(),
      dispose: vi.fn(),
    },
    worker: state.worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
  recordBrowserReaderAcceptedRevision(owner, state.revisionBundle.revision);
  state.boundedSessions.current = owner;
  return owner;
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
): CoreVersioned<CoreTextRangeResponse> {
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
          sourceSpan: {
            start: {
              href: 'chapter.xhtml',
              sourcePoint: { nodePath: [0], textOffset: anchor.charIndex },
            },
            end: {
              href: 'chapter.xhtml',
              sourcePoint: { nodePath: [0], textOffset: focus.charIndex },
            },
          },
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

function versionedRangeToPoint(
  anchor: CoreTextCaretAddress,
  focus: CoreTextCaretAddress,
): CoreVersioned<CoreTextRangeFromPointsResponse> {
  const range = versionedRange(anchor, focus).value;
  if (range.resolution.status !== 'resolved') throw new Error('Expected a resolved range fixture');
  return {
    revision: handle(),
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
    geometry: { x: address.charIndex, y: 0, height: 18 },
    sourceLocator: {
      href: 'chapter.xhtml',
      sourcePoint: { nodePath: [0], textOffset: address.charIndex },
    },
  };
}
