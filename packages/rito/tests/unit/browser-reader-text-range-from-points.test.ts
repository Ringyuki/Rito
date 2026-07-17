import { describe, expect, it } from 'vitest';
import type {
  CoreTextRangeFromPointsResponse,
  CoreVersioned,
} from '../../src/bindings/browser/core-contracts';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import { closeExactRevisionReadGate } from '../../src/bindings/browser/reader/pipeline/revision-handle';
import {
  caretAddress,
  changeIdentity,
  handle,
  request,
  requireTextSelection,
  resolvedRangeResponse,
  versionedPointRange,
  versionedPointResolution,
} from './browser-reader-text-range-from-points-fixtures';
import {
  createDeferred,
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader granular point ranges', () => {
  it('maps and privately binds both resolved carets while reusing the standard range shape', async () => {
    const fixture = readyFixture();
    const anchorAddress = caretAddress(1);
    const focusAddress = caretAddress(4);
    fixture.resolveTextRangeFromPointsAtRevision.mockResolvedValue(
      versionedPointRange(anchorAddress, focusAddress),
    );
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const request = {
      anchor: { pageIndex: 0, x: 12, y: 20 },
      focus: { pageIndex: 0, x: 48, y: 20 },
      granularity: 'word' as const,
    };

    const result = await selection.resolveTextRangeFromPoints(request);

    expect(fixture.resolveTextRangeFromPointsAtRevision).toHaveBeenCalledWith(handle(), request);
    expect(result?.status).toBe('resolved');
    if (!result || result.status !== 'resolved') throw new Error('Expected resolved point range');
    expect(result.range).toMatchObject({
      selectedText: 'word',
      sourceSpan: {
        start: { href: 'chapter.xhtml', sourcePoint: { nodePath: [0], textOffset: 1 } },
        end: { href: 'chapter.xhtml', sourcePoint: { nodePath: [0], textOffset: 4 } },
      },
      sourceLocator: {
        href: 'chapter.xhtml',
        sourceRange: {
          start: { nodePath: [0], textOffset: 1 },
          end: { nodePath: [0], textOffset: 4 },
        },
      },
      rects: [{ pageIndex: 0, spreadIndex: 0, x: 10, y: 12, width: 30, height: 18 }],
    });
    expect(result.range).toMatchObject({
      anchor: { pageIndex: 0 },
      focus: { pageIndex: 0 },
    });
    expect(result.range.anchor).not.toHaveProperty('address');
    expect(result.range.focus).not.toHaveProperty('address');

    fixture.resolveTextRangeAtRevision.mockResolvedValue({
      revision: handle(),
      value: resolvedRangeResponse(anchorAddress, focusAddress),
    });
    await selection.resolveTextRange(result.range.anchor, result.range.focus);
    expect(fixture.resolveTextRangeAtRevision).toHaveBeenCalledWith(handle(), {
      anchor: anchorAddress,
      focus: focusAddress,
    });
  });

  it('preserves miss and unavailable outcomes and validates requests before dispatch', async () => {
    const fixture = readyFixture();
    fixture.resolveTextRangeFromPointsAtRevision
      .mockResolvedValueOnce(versionedPointResolution({ status: 'miss' }))
      .mockResolvedValueOnce(
        versionedPointResolution({ status: 'unavailable', reason: 'shapeUnavailable' }),
      );
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const request = {
      anchor: { pageIndex: 0, x: 1, y: 2 },
      focus: { pageIndex: 0, x: 3, y: 4 },
      granularity: 'paragraph' as const,
    };

    await expect(selection.resolveTextRangeFromPoints(request)).resolves.toEqual({
      status: 'miss',
    });
    await expect(selection.resolveTextRangeFromPoints(request)).resolves.toEqual({
      status: 'unavailable',
      reason: 'shapeUnavailable',
    });
    await expect(
      selection.resolveTextRangeFromPoints({
        ...request,
        anchor: { ...request.anchor, x: Number.NaN },
      }),
    ).rejects.toThrow('finite');
    expect(fixture.resolveTextRangeFromPointsAtRevision).toHaveBeenCalledTimes(2);
  });

  it('accepts a paragraph endpoint expanded onto a different page than its input point', async () => {
    const fixture = readyFixture();
    const anchorAddress = caretAddress(1);
    const focusAddress = { ...caretAddress(4), pageIndex: 1 };
    fixture.resolveTextRangeFromPointsAtRevision.mockResolvedValue(
      versionedPointRange(anchorAddress, focusAddress),
    );
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const input = {
      anchor: { pageIndex: 0, x: 12, y: 20 },
      focus: { pageIndex: 0, x: 48, y: 20 },
      granularity: 'paragraph' as const,
    };

    const result = await selection.resolveTextRangeFromPoints(input);

    expect(result?.status).toBe('resolved');
    if (!result || result.status !== 'resolved') throw new Error('Expected cross-page range');
    expect(result.range).toMatchObject({
      anchor: { pageIndex: 0 },
      focus: { pageIndex: 1 },
    });
    expect(result.range.focus.sourceLocator.sourcePoint?.textOffset).toBe(4);
  });

  it('rejects an expanded caret outside committed navigation even without range rects there', async () => {
    const fixture = readyFixture();
    const anchorAddress = caretAddress(1);
    const focusAddress = { ...caretAddress(4), pageIndex: 99 };
    fixture.resolveTextRangeFromPointsAtRevision.mockResolvedValue(
      versionedPointRange(anchorAddress, focusAddress),
    );
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));

    await expect(selection.resolveTextRangeFromPoints(request())).rejects.toThrow(
      'granular focus caret does not match committed navigation',
    );
  });

  it('rejects a range endpoint that does not match its complete resolved caret', async () => {
    const fixture = readyFixture();
    const response = versionedPointRange(caretAddress(1), caretAddress(4));
    if (response.value.resolution.status !== 'resolved') throw new Error('Expected fixture');
    const forged = {
      ...response,
      value: {
        ...response.value,
        resolution: {
          ...response.value.resolution,
          range: {
            ...response.value.resolution.range,
            anchor: caretAddress(2),
          },
        },
      },
    };
    fixture.resolveTextRangeFromPointsAtRevision.mockResolvedValue(forged);
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));

    await expect(selection.resolveTextRangeFromPoints(request())).rejects.toThrow(
      'anchor does not match',
    );
  });

  it.each(['worker', 'generation', 'version'] as const)(
    'drops an in-flight point range after a %s identity change',
    async (change) => {
      const fixture = readyFixture();
      const deferred = createDeferred<CoreVersioned<CoreTextRangeFromPointsResponse>>();
      fixture.resolveTextRangeFromPointsAtRevision.mockReturnValue(deferred.promise);
      const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
      const pending = selection.resolveTextRangeFromPoints(request());

      changeIdentity(fixture.state, change);
      deferred.resolve(versionedPointRange(caretAddress(1), caretAddress(4)));

      await expect(pending).resolves.toBeUndefined();
    },
  );

  it('cancels an in-flight point range when the exact revision gate closes', async () => {
    const fixture = readyFixture();
    const deferred = createDeferred<CoreVersioned<CoreTextRangeFromPointsResponse>>();
    fixture.resolveTextRangeFromPointsAtRevision.mockReturnValue(deferred.promise);
    const selection = requireTextSelection(createBrowserReaderInteractions(fixture.state));
    const pending = selection.resolveTextRangeFromPoints(request());

    closeExactRevisionReadGate(fixture.state);
    deferred.resolve(versionedPointRange(caretAddress(1), caretAddress(4)));

    await expect(pending).resolves.toBeUndefined();
  });
});

function readyFixture() {
  const fixture = createWorker(() => undefined, 'point-range-session');
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 4, 4));
  return { ...fixture, state };
}
