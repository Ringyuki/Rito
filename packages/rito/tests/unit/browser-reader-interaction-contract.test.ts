import { describe, expect, it } from 'vitest';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type {
  CorePageTargets,
  CoreSourceLocatorResolution,
} from '../../src/bindings/browser/core-contracts';
import {
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
  spreadNavigationSlot,
} from './browser-reader-reflow-fixtures';

describe('Browser reader interaction contract', () => {
  it('maps typed page targets without exposing worker layout internals', async () => {
    const fixture = readyFixture();
    fixture.getPageTargetsAtRevision.mockResolvedValue({
      revision: handle(),
      value: pageTargets(0, 0),
    });
    const interactions = createBrowserReaderInteractions(fixture.state);

    const result = await interactions.getPageTargets(0);

    expect(fixture.getPageTargetsAtRevision).toHaveBeenCalledWith(handle(), 0);
    expect(result).toEqual({
      pageIndex: 0,
      spreadIndex: 0,
      targets: [
        {
          kind: 'footnote',
          bounds: { x: -4, y: 2, width: 30, height: 12 },
          label: '1',
          href: '#fn1',
          sourceLocator: {
            href: 'Text/chapter.xhtml',
            sourcePoint: { nodePath: [0, 1], textOffset: 3 },
          },
          targetLocator: { href: 'Text/chapter.xhtml', anchorId: 'fn1' },
          footnoteKey: 'Text/chapter.xhtml#fn1',
        },
      ],
    });
    expect(result?.targets[0]).not.toHaveProperty('blockIndex');
    expect(result?.targets[0]).not.toHaveProperty('text');
  });

  it('uses committed navigation as the authoritative page-to-spread projection', async () => {
    const fixture = createWorker(() => undefined, 'interaction-session');
    const state = createState(fixture.worker);
    setRevisionState(state, revisionSummary('rev', 2, 1), {
      revisionId: 'rev',
      pageCount: 2,
      spreadCount: 1,
      spreads: [spreadNavigationSlot(0, 0, 1)],
      chapters: [],
      chapterMap: {},
    });
    fixture.getPageTargetsAtRevision.mockResolvedValue({
      revision: handle(),
      value: pageTargets(1, 0),
    });

    await expect(createBrowserReaderInteractions(state).getPageTargets(1)).resolves.toMatchObject({
      pageIndex: 1,
      spreadIndex: 0,
    });
  });

  it.each([
    {
      ownership: 'inner revision',
      value: { ...pageTargets(0, 0), revisionId: 'forged' },
      message: 'Reader page targets response does not match its request',
    },
    {
      ownership: 'requested page',
      value: pageTargets(1, 0),
      message: 'Reader page targets response does not match its request',
    },
    {
      ownership: 'committed spread',
      value: pageTargets(0, 1),
      message: 'Reader page targets do not match committed navigation',
    },
  ])('rejects a page-target response with mismatched $ownership', async ({ value, message }) => {
    const fixture = readyFixture();
    fixture.getPageTargetsAtRevision.mockResolvedValue({ revision: handle(), value });

    await expect(createBrowserReaderInteractions(fixture.state).getPageTargets(0)).rejects.toThrow(
      message,
    );
    expect(fixture.state.interaction.pageTargets.size).toBe(0);
    expect(fixture.state.interaction.pendingPageTargets.size).toBe(0);
  });

  it('fetches footnotes and maps resolved and pending locator projections', async () => {
    const fixture = readyFixture();
    fixture.getFootnoteAtRevision.mockResolvedValue({
      revision: handle(),
      value: {
        revisionId: 'rev',
        key: 'Text/chapter.xhtml#fn1',
        kind: 'footnote',
        text: 'Note',
        html: '<p>Note</p>',
      },
    });
    fixture.resolveSourceLocatorAtRevision
      .mockResolvedValueOnce({ revision: handle(), value: resolvedLocator() })
      .mockResolvedValueOnce({ revision: handle(), value: pendingLocator() });
    const interactions = createBrowserReaderInteractions(fixture.state);
    const locator = { href: 'Text/chapter.xhtml', anchorId: 'target' };

    await expect(interactions.getFootnote('Text/chapter.xhtml#fn1')).resolves.toEqual({
      kind: 'footnote',
      text: 'Note',
      html: '<p>Note</p>',
    });
    await expect(interactions.resolveLocator(locator)).resolves.toEqual({
      status: 'resolved',
      locator,
      spineIdref: 'chapter',
      pageIndex: 0,
      spreadIndex: 0,
      matchedBy: 'anchor',
    });
    await expect(interactions.resolveLocator(locator)).resolves.toEqual({
      status: 'pending',
      locator,
      spineIdref: 'chapter',
      reason: 'notPaginated',
      matchedBy: 'anchor',
    });
    expect(fixture.resolveSourceLocatorAtRevision).toHaveBeenCalledWith(handle(), locator);
  });

  it('reports disabled without a canonical revision or during a visual preview', () => {
    const { worker } = createWorker(() => undefined);
    const state = createState(worker);
    const interactions = createBrowserReaderInteractions(state);
    expect(interactions.enabled).toBe(false);

    setRevisionState(state, revisionSummary('rev', 1, 1));
    expect(interactions.enabled).toBe(true);

    state.visualPreview = {} as typeof state.visualPreview;
    expect(interactions.enabled).toBe(false);
    state.visualPreview = undefined;
    state.disposed = true;
    expect(interactions.enabled).toBe(false);
  });
});

function readyFixture() {
  const fixture = createWorker(() => undefined, 'interaction-session');
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 1, 1));
  return { ...fixture, state };
}

function handle() {
  return { revisionId: 'rev', revisionVersion: 0 };
}

function pageTargets(pageIndex: number, spreadIndex: number): CorePageTargets {
  return {
    revisionId: 'rev',
    pageIndex,
    spreadIndex,
    entryCount: 1,
    textHash: 'page',
    entries: [
      {
        kind: 'footnote',
        bounds: { x: -4, y: 2, width: 30, height: 12 },
        blockIndex: 2,
        lineIndex: 3,
        runIndex: 4,
        label: '1',
        text: { hash: 'text', length: 1 },
        href: '#fn1',
        sourceLocator: {
          href: 'Text/chapter.xhtml',
          sourcePoint: { nodePath: [0, 1], textOffset: 3 },
        },
        targetLocator: { href: 'Text/chapter.xhtml', anchorId: 'fn1' },
        footnoteKey: 'Text/chapter.xhtml#fn1',
      },
    ],
  };
}

function resolvedLocator(): CoreSourceLocatorResolution {
  return {
    status: 'resolved',
    revisionId: 'rev',
    locator: { href: 'Text/chapter.xhtml', anchorId: 'target' },
    spineIdref: 'chapter',
    pageIndex: 0,
    spreadIndex: 0,
    matchedBy: 'anchor',
  };
}

function pendingLocator(): CoreSourceLocatorResolution {
  return {
    status: 'pending',
    revisionId: 'rev',
    locator: { href: 'Text/chapter.xhtml', anchorId: 'target' },
    spineIdref: 'chapter',
    reason: 'notPaginated',
    matchedBy: 'anchor',
  };
}
