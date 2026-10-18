import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reader, ReaderOptions } from '../../src/reader';
import type { BrowserReaderSessionOpenOptions } from '../../src/bindings/browser/reader-session';
import { createReader } from '../../src/bindings/browser/session-reader/reader';
import {
  FakeReaderSession,
  LIVE_ARTIFACT_CAP,
  fakeCanvasContext,
  type FakeCanvasContext,
  type FakeChapter,
} from './session-reader-fixtures';

const harness = vi.hoisted(() => ({
  fake: undefined as unknown,
  chapters: [] as unknown[],
  openOptions: undefined as unknown,
  painted: [] as string[],
  framesDisposed: 0,
  warnings: [] as unknown[][],
}));

vi.mock('../../src/bindings/browser/reader-session', async (importOriginal) => {
  const original = await importOriginal<object>();
  return {
    ...original,
    openBrowserReaderSession: async (_data: unknown, options: BrowserReaderSessionOpenOptions) => {
      const fixtures = await import('./session-reader-fixtures');
      const fake = new fixtures.FakeReaderSession(harness.chapters as FakeChapter[], {
        layout: options.layout,
        locator: options.initialLocator,
        textProfile: 'platform-string-runs',
      });
      // The engine lists every host face for paint, under the face's own descriptors.
      const policy = options.pinnedFontPolicy;
      const declared = JSON.parse(policy?.metadataJson ?? '{"faces":[]}') as {
        faces: { expectedSha256: string }[];
      };
      fake.fonts = declared.faces.map((face, index) => ({
        family: `__RitoPinned_${face.expectedSha256}`,
        href: `rito-host-font:${face.expectedSha256}`,
        style: 'normal',
        weight: 400,
        shapeFingerprint: 'shape',
        byteLength: BigInt(policy?.faces[index]?.byteLength ?? 0),
      }));
      harness.fake = fake;
      harness.openOptions = options;
      return fake.session();
    },
  };
});

vi.mock('../../src/bindings/browser/reader-session-canvas', () => ({
  createBrowserReaderSessionCanvasPresenter: (
    _session: unknown,
    options: { hostFont?: (font: unknown) => Promise<unknown> | undefined } = {},
  ) => ({
    // Like the presenter it stands in for, it waits for the faces the page registers itself.
    prepare: async (artifact: {
      artifactId: bigint;
      localSpreadIndex: number;
      fonts: readonly unknown[];
    }) => {
      for (const font of artifact.fonts) await options.hostFont?.(font);
      // Painted at the ratio its layout was asked at.
      const owned = (harness.fake as FakeReaderSession | undefined)?.live.get(artifact.artifactId);
      return {
        artifact,
        ratio: owned?.revision.layout.renderRatio ?? 2,
        disposed: false,
        onImagesChanged: () => () => undefined,
        imagesSettled: Promise.resolve(),
        dispose() {
          harness.framesDisposed += 1;
        },
      };
    },
    paint: (
      prepared: { artifact: { localSpreadIndex: number } },
      _ctx: unknown,
      options: { backgroundColor?: string; scale?: number },
    ) => {
      harness.painted.push(
        `${String(prepared.artifact.localSpreadIndex)}:${String(options.backgroundColor)}` +
          (options.scale === 1 ? '' : `@${String(options.scale)}`),
      );
    },
    dispose: () => undefined,
  }),
}));

const CHAPTERS: readonly FakeChapter[] = [
  { idref: 'cover', href: 'cover.xhtml', pages: 1 },
  { idref: 'one', href: 'one.xhtml', pages: 8 },
  { idref: 'two', href: 'two.xhtml', pages: 5 },
];
const SHA = 'ab'.repeat(32);

function options(extra: Partial<ReaderOptions> = {}): ReaderOptions {
  return {
    width: 400,
    height: 600,
    devicePixelRatio: 2,
    logLevel: 'warn',
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [{ bytes: new ArrayBuffer(8), expectedSha256: SHA, genericRole: 'serif' }],
    },
    ...extra,
  };
}

interface Opened {
  readonly reader: Reader;
  readonly fake: FakeReaderSession;
  readonly ctx: FakeCanvasContext;
  readonly commits: { index: number; scope: string | undefined; spreads: number }[];
  readonly invalidated: number[];
}

async function open(extra: Partial<ReaderOptions> = {}): Promise<Opened> {
  const ctx = fakeCanvasContext(800, 1200);
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const reader = await createReader(new ArrayBuffer(4), canvas as never, options(extra));
  const commits: Opened['commits'] = [];
  const invalidated: number[] = [];
  reader.onLayoutCommitted((index) => {
    commits.push({ index, scope: reader.layoutScope, spreads: reader.totalSpreads });
  });
  reader.onSpreadContentInvalidated((index) => invalidated.push(index));
  return { reader, fake: harness.fake as FakeReaderSession, ctx, commits, invalidated };
}

async function bookScope(reader: Reader): Promise<void> {
  await vi.waitFor(() => {
    expect(reader.layoutScope).toBe('book');
  });
}

/** Lets every queued session call and its consequences run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('Reader on a session', () => {
  beforeEach(() => {
    harness.chapters = [...CHAPTERS];
    harness.painted = [];
    harness.framesDisposed = 0;
    harness.warnings = [];
    const registered = new Set<unknown>();
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          readonly family: string,
          readonly source: unknown,
          readonly descriptors: unknown,
        ) {}
        load(): Promise<this> {
          return Promise.resolve(this);
        }
      },
    );
    vi.stubGlobal('fonts', registered);
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      harness.warnings.push(args);
    });
  });

  afterEach(() => {
    // Nothing the reader does may fail quietly: every session rule the fake
    // enforces surfaces as a logged warning.
    expect(harness.warnings).toEqual([]);
    // Its work on artifacts came one call at a time.
    expect((harness.fake as FakeReaderSession).violations).toEqual([]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the chapter being read first, then the same page of the whole book', async () => {
    const { reader, fake, commits } = await open({
      initialLocator: { href: 'one.xhtml', progression: 3 / 7 },
    });

    // The chapter alone: its pages count from zero.
    expect(reader.layoutScope).toBe('chapter');
    expect(reader.totalSpreads).toBe(8);
    expect(reader.pageCount).toBe(8);
    expect(reader.activeSpreadIndex).toBe(3);
    expect([...reader.chapterMap]).toEqual([['one', { startPage: 0, endPage: 7 }]]);
    expect(reader.spreads[3]).toEqual({ index: 3, pageIndexes: [3], leftPageIndex: 3 });
    expect(fake.visibleSpread()).toBe(3);

    await bookScope(reader);
    // The cover's one page precedes the chapter: the same page is book page 4.
    expect(commits).toEqual([{ index: 4, scope: 'book', spreads: 14 }]);
    expect(reader.activeSpreadIndex).toBe(4);
    expect(reader.pageCount).toBe(14);
    expect([...reader.chapterMap.keys()]).toEqual(['cover', 'one', 'two']);
    expect(reader.chapterMap.get('two')).toEqual({ startPage: 9, endPage: 13 });
    expect(fake.visibleSpread()).toBe(4);
    await reader.dispose();
  });

  it('opens at the start of the book, at the device ratio, with the policy faces', async () => {
    const { reader } = await open();
    const opened = harness.openOptions as BrowserReaderSessionOpenOptions;

    expect(opened.initialLocator).toEqual({ href: '' });
    expect(opened.layout).toMatchObject({
      viewportWidth: 400,
      viewportHeight: 600,
      marginTop: 40,
      spreadMode: 'single',
      rootFontSize: 16,
      renderRatio: 2,
      lineHeightForce: false,
      fontFamilyForce: false,
    });
    expect(JSON.parse(opened.pinnedFontPolicy?.metadataJson ?? '')).toEqual({
      schemaVersion: 1,
      faces: [{ expectedSha256: SHA, genericRole: 'serif' }],
    });
    expect(opened.pinnedFontPolicy?.faces).toHaveLength(1);
    expect(reader.metadata).toEqual({ title: 'Fake book', language: 'en', identifier: 'fake' });
    expect(reader.toc.map((entry) => entry.href)).toEqual([
      'cover.xhtml',
      'one.xhtml',
      'two.xhtml',
    ]);
    expect(reader.manifestHrefMap.get('two')).toBe('two.xhtml');
    await reader.dispose();
  });

  it('paints a loaded spread and loads one that is not, announcing its arrival', async () => {
    const { reader, ctx, invalidated } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    await settle();
    harness.painted = [];
    invalidated.length = 0;

    expect(reader.renderSpreadTo(1, ctx as never)).toBe(true);
    // The target is on the artifact's own device grid: no scaling.
    expect(harness.painted).toEqual(['1:#ffffff']);

    expect(reader.renderSpreadTo(9, ctx as never)).toBe(false);
    await vi.waitFor(() => {
      expect(invalidated).toContain(9);
    });
    expect(reader.renderSpreadTo(9, ctx as never)).toBe(true);
    expect(reader.renderSpreadTo(99, ctx as never)).toBe(false);

    harness.painted = [];
    const zoomed = fakeCanvasContext(1200, 1800);
    expect(reader.renderSpreadTo(1, zoomed as never)).toBe(true);
    expect(harness.painted).toEqual(['1:#ffffff@1.5']);
    await reader.dispose();
  });

  it('follows the host from spread to spread within the live-artifact budget', async () => {
    const { reader, fake } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    const rendered: number[] = [];
    reader.onSpreadRendered((index) => rendered.push(index));

    for (const index of [2, 3, 4, 5, 6, 5, 4, 12, 1]) {
      reader.notifyActiveSpread(index);
      expect(reader.activeSpreadIndex).toBe(index);
      await vi.waitFor(() => {
        expect(fake.visibleSpread()).toBe(index);
      });
      await settle();
      // The visible spread and its two neighbours stay loaded.
      const live = [...fake.live.values()].map((owned) => owned.artifact.localSpreadIndex);
      expect(live).toEqual(expect.arrayContaining([index - 1, index, index + 1]));
    }
    expect(rendered).toEqual([2, 3, 4, 5, 6, 5, 4, 12, 1]);
    expect(fake.maxLive).toBeLessThanOrEqual(LIVE_ARTIFACT_CAP);
    expect(fake.live.size).toBeLessThanOrEqual(4);
    await reader.dispose();
  });

  it('shows only the last of several spreads the host passes through at once', async () => {
    const { reader, fake } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);

    for (const index of [2, 3, 4, 5, 6]) reader.notifyActiveSpread(index);
    await vi.waitFor(() => {
      expect(fake.visibleSpread()).toBe(6);
    });
    await settle();
    expect(fake.calls.filter((call) => call.startsWith('commit'))).toHaveLength(1);
    await reader.dispose();
  });

  it('lays the chapter out again on the page it shows when typography changes', async () => {
    const { reader, fake, commits } = await open({
      initialLocator: { href: 'one.xhtml', progression: 4 / 7 },
    });
    await bookScope(reader);
    commits.length = 0;

    expect(reader.setTypography({ fontSize: 32, fontFamily: 'serif', fontFamilyForce: true })).toBe(
      false,
    );
    await vi.waitFor(() => {
      expect(commits).toHaveLength(2);
    });
    const request = fake.requests.at(-1);
    // The page shown names the position: chapter one, four sevenths in.
    expect(request?.locator).toEqual({ href: 'one.xhtml', progression: 4 / 7 });
    expect(request?.layout).toMatchObject({
      rootFontSize: 32,
      fontFamilyOverride: 'serif',
      fontFamilyForce: true,
      lineHeightForce: false,
      renderRatio: 2,
    });
    // Sixteen pages at twice the size, the reader four sevenths in; then the
    // book, with the cover's two pages before the chapter.
    expect(commits).toEqual([
      { index: 9, scope: 'chapter', spreads: 16 },
      { index: 11, scope: 'book', spreads: 28 },
    ]);
    expect(reader.getLayoutGeometry()).toMatchObject({
      rootFontSize: 32,
      fontFamilyOverride: 'serif',
    });
    await settle();
    // Every spread of the layouts replaced was given back.
    expect(
      [...fake.live.values()].every((owned) => owned.revision.layout.rootFontSize === 32),
    ).toBe(true);
    expect(fake.maxLive).toBeLessThanOrEqual(LIVE_ARTIFACT_CAP);
    await reader.dispose();
  });

  it('lays the book out again at a new device ratio, taking it as the layout commits', async () => {
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    commits.length = 0;

    reader.setDevicePixelRatio(3);
    // The pages shown were painted at 2 until the new layout replaces them.
    expect(reader.dpr).toBe(2);
    await vi.waitFor(() => {
      expect(reader.layoutScope).toBe('book');
      expect(commits.length).toBeGreaterThan(1);
    });
    expect(fake.requests.at(-1)?.layout).toMatchObject({
      viewportWidth: 400,
      viewportHeight: 600,
      renderRatio: 3,
    });
    expect(reader.dpr).toBe(3);
    expect(reader.getCanvasSize()).toEqual({ width: 400, height: 600 });

    // The ratio it is at already lays nothing out.
    const requests = fake.requests.length;
    reader.setDevicePixelRatio(3);
    await settle();
    expect(fake.requests).toHaveLength(requests);
    expect(() => {
      reader.setDevicePixelRatio(0);
    }).toThrow(RangeError);
    await reader.dispose();
  });

  it('commits a layout under way, then lays out only the newest request made meanwhile', async () => {
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    commits.length = 0;
    fake.layoutMs = 30;

    reader.setTypography({ fontSize: 20 });
    reader.setTypography({ fontSize: 24 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Both made while 24 is laid out.
    reader.setTypography({ fontSize: 28 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(reader.getLayoutGeometry().rootFontSize).toBe(32);
      expect(reader.layoutScope).toBe('book');
    });

    // Requests made in one task are one layout; 28 never laid out.
    expect(fake.requests.slice(1).map((request) => request.layout.rootFontSize)).toEqual([24, 32]);
    // Chapter one at 24 (12 pages) and 32 (16), then the book at 32.
    expect(commits.map((commit) => commit.spreads)).toEqual([12, 16, 28]);
    await reader.dispose();
  });

  it('holds the whole book back while the host holds it', async () => {
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    commits.length = 0;
    const advances = (): number => fake.calls.filter((call) => call === 'advance').length;
    const before = advances();

    // A window being resized: a new size every frame, the host holding the
    // whole book, which would occupy the session for as long as it takes.
    // Each size reaches the screen laid out with its chapter.
    const release = reader.holdBookLayout?.();
    const second = reader.holdBookLayout?.();
    for (let frame = 0; frame < 10; frame += 1) {
      reader.resize(420 + frame * 10, 600);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await settle();
    expect(commits.length).toBeGreaterThanOrEqual(8);
    expect(commits.every((commit) => commit.scope === 'chapter')).toBe(true);
    expect(advances()).toBe(before);

    // Holds nest: the book waits for the last one.
    second?.();
    await settle();
    expect(advances()).toBe(before);
    release?.();
    await bookScope(reader);
    expect(reader.getLayoutGeometry().pageWidth).toBe(510);
    await reader.dispose();
  });

  it('reads only the pages laid out while the host holds the book, and the whole table once it lets go', async () => {
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    await settle();
    commits.length = 0;
    const tables = (): string[] => fake.calls.filter((call) => call.startsWith('layout '));
    const before = tables().length;

    // The rest of the chapter would be laid out for every size of the drag.
    const release = reader.holdBookLayout?.();
    for (let frame = 0; frame < 4; frame += 1) {
      reader.resize(420 + frame * 10, 600);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await settle();
    const held = tables().slice(before);
    expect(held.length).toBeGreaterThanOrEqual(3);
    expect(held.every((call) => call === 'layout so far')).toBe(true);
    const heldCommits = commits.length;

    // Once the sizes stop, the table is read whole and the host told.
    release?.();
    await vi.waitFor(() => {
      expect(tables().slice(before + held.length)[0]).toBe('layout whole');
    });
    await vi.waitFor(() => {
      expect(commits.length).toBeGreaterThan(heldCommits);
    });
    await reader.dispose();
  });

  it('loads no neighbouring spread while the host holds the book, and loads them once it lets go', async () => {
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    // The book's own neighbours are loaded.
    await settle();
    commits.length = 0;
    const peeks = (): number => fake.calls.filter((call) => call.startsWith('peek ')).length;
    const before = peeks();

    // Each size's neighbours would be painted for a layout the next size
    // replaces, and a peek under way holds that size back.
    const release = reader.holdBookLayout?.();
    for (let frame = 0; frame < 5; frame += 1) {
      reader.resize(420 + frame * 10, 600);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await settle();
    expect(commits.length).toBeGreaterThanOrEqual(4);
    const held = peeks() - before;

    release?.();
    await bookScope(reader);
    await vi.waitFor(() => {
      expect(peeks() - before).toBeGreaterThan(held);
    });
    expect(held).toBe(0);
    await reader.dispose();
  });

  it('shows a size each time a layout ends while sizes come faster than the chapter lays out', async () => {
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    commits.length = 0;
    const release = reader.holdBookLayout?.();

    // A new size every frame, and a chapter that takes more than two frames.
    fake.layoutMs = 40;
    const sizes = 15;
    for (let frame = 0; frame < sizes; frame += 1) {
      reader.resize(420 + frame * 10, 600);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const duringDrag = commits.length;
    await vi.waitFor(() => {
      expect(reader.getLayoutGeometry().pageWidth).toBe(560);
    });
    expect(duringDrag).toBeGreaterThanOrEqual(2);
    // The sizes that came while a layout ran were laid out as the newest only.
    expect(fake.requests.length - 1).toBeLessThan(sizes);
    expect(commits.every((commit) => commit.scope === 'chapter')).toBe(true);

    release?.();
    await bookScope(reader);
    await reader.dispose();
  });

  it('does nothing for a layout request that changes nothing', async () => {
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    commits.length = 0;

    reader.resize(400, 600);
    reader.setTypography({ fontSize: 16 });
    await settle();
    expect(fake.requests).toHaveLength(1);
    expect(commits).toEqual([]);
    await reader.dispose();
  });

  it('turns inside the chapter while the book is laid out, and lands on its book page', async () => {
    let finishBook: () => void = () => undefined;
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    commits.length = 0;
    fake.backgroundGate = new Promise((resolve) => {
      finishBook = resolve;
    });

    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(commits).toHaveLength(1);
    });
    expect(reader.layoutScope).toBe('chapter');
    // The session is laying the book out; the reader turns two pages on.
    await vi.waitFor(() => {
      expect(fake.calls.at(-1)).toBe('advance');
    });
    reader.notifyActiveSpread(1);
    reader.notifyActiveSpread(2);
    finishBook();
    fake.backgroundGate = undefined;

    await bookScope(reader);
    // Chapter page 2 behind the cover's two pages.
    expect(commits.at(-1)).toEqual({ index: 4, scope: 'book', spreads: 28 });
    expect(fake.visibleSpread()).toBe(4);
    await reader.dispose();
  });

  it('keeps a turn made while the session adopts the whole book', async () => {
    const { reader, fake, commits } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    commits.length = 0;
    let turned = false;
    fake.onAnswer = (method) => {
      // The host turns at the last moment the book can be adopted for the
      // page it is leaving.
      if (method !== 'adoptBackgroundCandidate' || turned) return;
      turned = true;
      reader.notifyActiveSpread(reader.activeSpreadIndex + 1);
    };

    reader.setTypography({ fontSize: 32 });
    // The chapter commits first; the book follows once the layout settles.
    await vi.waitFor(() => {
      expect(commits).toHaveLength(2);
    });
    await settle();

    // The chapter's first spread sits behind the cover's two pages; the
    // reader is on the one after it, where it turned to, and so is the session.
    expect(commits).toEqual([
      { index: 0, scope: 'chapter', spreads: 16 },
      { index: 3, scope: 'book', spreads: 28 },
    ]);
    expect(reader.activeSpreadIndex).toBe(3);
    expect(fake.visibleSpread()).toBe(3);
    await reader.dispose();
  });

  it('answers a locator in the chapter now and one elsewhere once the book is in', async () => {
    let finishBook: () => void = () => undefined;
    const ctx = fakeCanvasContext(800, 1200);
    harness.chapters = [...CHAPTERS];
    const reader = await createReader(
      new ArrayBuffer(4),
      { width: 0, height: 0, getContext: () => ctx } as never,
      options({ initialLocator: { href: 'one.xhtml' } }),
    );
    const fake = harness.fake as FakeReaderSession;
    await bookScope(reader);
    fake.backgroundGate = new Promise((resolve) => {
      finishBook = resolve;
    });
    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(reader.layoutScope).toBe('chapter');
    });

    // The session is occupied with the book: both questions wait for it,
    // the one in the chapter being read is answered from that chapter, the
    // one elsewhere once the book is committed.
    const here = reader.navigateToLocator?.({ href: 'one.xhtml', progression: 1 });
    let elsewhere: unknown = 'waiting';
    void reader.navigateToLocator?.({ href: 'two.xhtml#top' }).then((resolution) => {
      elsewhere = resolution;
    });
    await settle();
    expect(elsewhere).toBe('waiting');

    finishBook();
    fake.backgroundGate = undefined;
    await expect(here).resolves.toEqual({
      status: 'resolved',
      locator: { href: 'one.xhtml', progression: 1 },
      spineIdref: 'one',
      pageIndex: 15,
      spreadIndex: 15,
      matchedBy: 'progression',
    });
    await vi.waitFor(() => {
      expect(elsewhere).not.toBe('waiting');
    });
    expect(elsewhere).toMatchObject({
      status: 'resolved',
      spineIdref: 'two',
      pageIndex: 18,
      spreadIndex: 18,
    });
    expect(await reader.navigateToLocator?.({ href: 'missing.xhtml' })).toBeUndefined();
    await reader.dispose();
  });

  it('places TOC entries in whichever layout is committed', async () => {
    let finishBook: () => void = () => undefined;
    const { reader, fake } = await open({ initialLocator: { href: 'one.xhtml' } });
    await bookScope(reader);
    const [cover, one, two] = reader.toc;
    if (!cover || !one || !two) throw new Error('the fixture has three TOC entries');

    expect(reader.resolveTocEntry(two)).toEqual({ pageIndex: 9, spreadIndex: 9 });
    expect(reader.findPage(one)).toBe(1);
    expect(reader.findSpread(9)).toBe(9);
    expect(reader.findActiveTocEntry(10)).toBe(two);
    // A host that kept only the href finds the same entry.
    expect(reader.resolveTocEntry({ label: 'x', href: 'two.xhtml', children: [] })).toEqual({
      pageIndex: 9,
      spreadIndex: 9,
    });

    fake.backgroundGate = new Promise((resolve) => {
      finishBook = resolve;
    });
    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(reader.layoutScope).toBe('chapter');
    });
    // Only chapter one is laid out: its own entry is placed, the others are not.
    expect(reader.resolveTocEntry(one)).toEqual({ pageIndex: 0, spreadIndex: 0 });
    expect(reader.resolveTocEntry(two)).toBeUndefined();
    expect(reader.findActiveTocEntry(3)).toBe(one);
    finishBook();
    fake.backgroundGate = undefined;
    await bookScope(reader);
    await reader.dispose();
  });

  it('sizes its canvas for a spread it renders, and gives its size in CSS pixels', async () => {
    const ctx = fakeCanvasContext(800, 1200);
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    const reader = await createReader(new ArrayBuffer(4), canvas as never, options());
    await bookScope(reader);
    harness.painted = [];
    // Twice the size, at the device's two pixels to each CSS one.
    reader.renderSpread(0, 2);
    expect(canvas).toMatchObject({ width: 1600, height: 2400 });
    expect(harness.painted).toEqual(['0:#ffffff']);
    expect(reader.getCanvasSize()).toEqual({ width: 400, height: 600 });
    // A fraction of a device pixel is rounded to the nearest one.
    expect(reader.getCanvasSize(1.0003)).toEqual({ width: 400, height: 600 });
    expect(reader.getCanvasSize(0.5)).toEqual({ width: 200, height: 300 });
    await reader.dispose();
  });

  it('repaints for a theme change and releases everything when it closes', async () => {
    const { reader, fake, ctx, invalidated } = await open({
      initialLocator: { href: 'one.xhtml' },
    });
    await bookScope(reader);
    await settle();
    invalidated.length = 0;

    reader.setTheme({ backgroundColor: '#101010', foregroundColor: '#eeeeee' });
    expect(invalidated).toEqual([reader.activeSpreadIndex]);
    harness.painted = [];
    reader.renderSpreadTo(reader.activeSpreadIndex, ctx as never);
    expect(harness.painted).toEqual([`${String(reader.activeSpreadIndex)}:#101010`]);
    reader.setTheme({ backgroundColor: '#101010' });
    expect(invalidated).toHaveLength(1);

    const registered = (globalThis as unknown as { fonts: Set<unknown> }).fonts;
    expect(registered.size).toBe(1);
    await reader.dispose();
    expect(fake.disposed).toBe(true);
    expect(registered.size).toBe(0);
    expect(reader.renderSpreadTo(0, ctx as never)).toBe(false);
  });
});
