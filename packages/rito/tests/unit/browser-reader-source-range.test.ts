import { describe, expect, it } from 'vitest';
import type {
  CoreExactSourceRangeResponse,
  CoreVersioned,
} from '../../src/bindings/browser/core-contracts';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type { ReaderExactSourceRangeRequest, ReaderInteractions } from '../../src/reader';
import {
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader exact source-range contract', () => {
  it('copies the request and maps exact native geometry without layout internals', async () => {
    const fixture = readyFixture();
    const response = resolvedResponse();
    fixture.resolveExactSourceRangeAtRevision.mockResolvedValue(response);
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));
    const request = sourceRequest();

    const result = await interactions.resolveExactSourceRange(request);

    expect(fixture.resolveExactSourceRangeAtRevision).toHaveBeenCalledWith(handle(), request);
    const sent = fixture.resolveExactSourceRangeAtRevision.mock.calls[0]?.[1];
    expect(sent).not.toBe(request);
    expect(sent?.sourceRange).not.toBe(request.sourceRange);
    expect(sent?.sourceRange.start.nodePath).not.toBe(request.sourceRange.start.nodePath);
    expect(result).toEqual({
      status: 'resolved',
      range: {
        selectedText: 'Hello',
        sourceLocator: {
          href: 'Text/chapter.xhtml',
          sourceRange: {
            start: { nodePath: [0, 1], textOffset: 2 },
            end: { nodePath: [0, 1], textOffset: 7 },
          },
        },
        rects: [{ pageIndex: 0, spreadIndex: 0, x: 10, y: 20, width: 42, height: 16 }],
      },
    });
    if (result?.status !== 'resolved') throw new Error('expected a resolved source range');
    const coreRange = resolvedCoreRange(response);
    expect(result.range.sourceLocator).not.toBe(coreRange.sourceLocator);
    expect(result.range.sourceLocator.sourceRange?.start.nodePath).not.toBe(
      coreRange.sourceLocator.sourceRange?.start.nodePath,
    );
    expect(result.range.rects[0]).not.toBe(coreRange.rects[0]);
    expect(result.range.rects[0]).not.toHaveProperty('blockIndex');
  });

  it('preserves typed pending and unavailable outcomes', async () => {
    const fixture = readyFixture();
    fixture.resolveExactSourceRangeAtRevision
      .mockResolvedValueOnce(
        versioned({
          revisionId: 'rev',
          resolution: { status: 'pending', reason: 'notPaginated' },
        }),
      )
      .mockResolvedValueOnce(
        versioned({
          revisionId: 'rev',
          resolution: { status: 'unavailable', reason: 'shapeUnavailable' },
        }),
      );
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));

    await expect(interactions.resolveExactSourceRange(sourceRequest())).resolves.toEqual({
      status: 'pending',
      reason: 'notPaginated',
    });
    await expect(interactions.resolveExactSourceRange(sourceRequest())).resolves.toEqual({
      status: 'unavailable',
      reason: 'shapeUnavailable',
    });
  });

  it('rejects geometry outside committed page/spread navigation', async () => {
    const fixture = readyFixture();
    const value = resolvedResponse();
    const range = resolvedCoreRange(value);
    const rect = range.rects[0];
    if (!rect) throw new Error('expected a core source-range rectangle');
    fixture.resolveExactSourceRangeAtRevision.mockResolvedValue(
      versioned({
        revisionId: 'rev',
        resolution: {
          status: 'resolved',
          range: { ...range, rects: [{ ...rect, spreadIndex: 1 }] },
        },
      }),
    );
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));

    await expect(interactions.resolveExactSourceRange(sourceRequest())).rejects.toThrow(
      'does not match committed navigation',
    );
  });

  it('rejects an inner response revision mismatch', async () => {
    const fixture = readyFixture();
    fixture.resolveExactSourceRangeAtRevision.mockResolvedValue(
      versioned({
        revisionId: 'forged',
        resolution: { status: 'pending', reason: 'notPaginated' },
      }),
    );
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));

    await expect(interactions.resolveExactSourceRange(sourceRequest())).rejects.toThrow(
      'does not match its revision request',
    );
  });
});

function readyFixture() {
  const fixture = createWorker(() => undefined, 'source-range-session');
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 1, 1));
  return { ...fixture, state };
}

function requireCapability(
  interactions: ReaderInteractions,
): Required<Pick<ReaderInteractions, 'resolveExactSourceRange'>> {
  if (!interactions.resolveExactSourceRange) {
    throw new Error('missing exact source-range capability');
  }
  return interactions as Required<Pick<ReaderInteractions, 'resolveExactSourceRange'>>;
}

function sourceRequest(): ReaderExactSourceRangeRequest {
  return {
    href: 'Text/chapter.xhtml',
    sourceRange: {
      start: { nodePath: [0, 1], textOffset: 2 },
      end: { nodePath: [0, 1], textOffset: 7 },
    },
  };
}

function resolvedResponse(): CoreVersioned<CoreExactSourceRangeResponse> {
  return versioned({
    revisionId: 'rev',
    resolution: {
      status: 'resolved',
      range: {
        selectedText: 'Hello',
        sourceLocator: { href: 'Text/chapter.xhtml', sourceRange: sourceRequest().sourceRange },
        rects: [
          {
            pageIndex: 0,
            spreadIndex: 0,
            x: 10,
            y: 20,
            width: 42,
            height: 16,
            blockIndex: 1,
            lineIndex: 2,
            runIndex: 3,
            startCharIndex: 2,
            endCharIndex: 7,
          },
        ],
      },
    },
  });
}

function resolvedCoreRange(value: CoreVersioned<CoreExactSourceRangeResponse>) {
  const resolution = value.value.resolution;
  if (resolution.status !== 'resolved') throw new Error('expected a resolved core source range');
  return resolution.range;
}

function versioned(
  value: CoreExactSourceRangeResponse,
): CoreVersioned<CoreExactSourceRangeResponse> {
  return { revision: handle(), value };
}

function handle() {
  return { revisionId: 'rev', revisionVersion: 0 };
}
