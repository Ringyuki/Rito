import { RitoReaderError } from '@ritojs/core-wasm/decoder';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reader, ReaderOptions } from '../../src/reader';
import type { BrowserReaderSessionOpenOptions } from '../../src/bindings/browser/reader-session';
import { createReader } from '../../src/bindings/browser/session-reader/reader';
import {
  FakeReaderSession,
  LIVE_ARTIFACT_CAP,
  fakeCanvasContext,
  type FakeChapter,
} from './session-reader-fixtures';

const harness = vi.hoisted(() => ({
  fake: undefined as unknown,
  warnings: [] as unknown[][],
}));

vi.mock('../../src/bindings/browser/reader-session', async (importOriginal) => {
  const original = await importOriginal<object>();
  return {
    ...original,
    openBrowserReaderSession: async (_data: unknown, options: BrowserReaderSessionOpenOptions) => {
      const fixtures = await import('./session-reader-fixtures');
      const fake = new fixtures.FakeReaderSession(CHAPTERS, {
        layout: options.layout,
        locator: options.initialLocator,
        textProfile: 'platform-string-runs',
      });
      harness.fake = fake;
      return fake.session();
    },
  };
});

vi.mock('../../src/bindings/browser/reader-session-canvas', () => ({
  createBrowserReaderSessionCanvasPresenter: () => ({
    prepare: (artifact: unknown) =>
      Promise.resolve({
        artifact,
        ratio: 2,
        disposed: false,
        onImagesChanged: () => () => undefined,
        imagesSettled: Promise.resolve(),
        dispose: () => undefined,
      }),
    paint: () => undefined,
    dispose: () => undefined,
  }),
}));

const CHAPTERS: FakeChapter[] = [
  { idref: 'cover', href: 'cover.xhtml', pages: 1 },
  { idref: 'one', href: 'one.xhtml', pages: 8 },
  { idref: 'two', href: 'two.xhtml', pages: 5 },
];

const NO_ROOM = new RitoReaderError('artifact-capacity', 'Reader retains at most 6 artifacts');
const STALE = new RitoReaderError('stale-request', 'foreground candidate is no longer pending');
const FAILED = 'reader session operation failed';

async function open(): Promise<{ reader: Reader; fake: FakeReaderSession }> {
  const ctx = fakeCanvasContext(800, 1200);
  const options: ReaderOptions = {
    width: 400,
    height: 600,
    devicePixelRatio: 2,
    logLevel: 'warn',
    initialLocator: { href: 'one.xhtml' },
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [{ bytes: new ArrayBuffer(8), expectedSha256: 'ab'.repeat(32), genericRole: 'serif' }],
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const reader = await createReader(new ArrayBuffer(4), canvas as never, options);
  const fake = harness.fake as FakeReaderSession;
  await vi.waitFor(() => {
    expect(reader.layoutScope).toBe('book');
  });
  return { reader, fake };
}

/** Resolves once the reader shows the whole book laid out at `fontSize`. */
async function bookAt(reader: Reader, fontSize: number): Promise<void> {
  await vi.waitFor(() => {
    expect(reader.getLayoutGeometry().rootFontSize).toBe(fontSize);
    expect(reader.layoutScope).toBe('book');
  });
}

/** Lets every queued session call and its consequences run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The root font sizes of the layouts whose artifacts the session still holds. */
function liveFontSizes(fake: FakeReaderSession): number[] {
  return [...new Set([...fake.live.values()].map((owned) => owned.revision.layout.rootFontSize))];
}

/** The warnings logged since the last call, by their message. */
function takeWarnings(): string[] {
  const messages = harness.warnings.map((warning) => String(warning[0]));
  harness.warnings = [];
  return messages;
}

/** Holds the whole-book step open until the returned function is called. */
function holdBook(fake: FakeReaderSession): () => void {
  let finish: () => void = () => undefined;
  fake.backgroundGate = new Promise((resolve) => {
    finish = resolve;
  });
  return () => {
    fake.backgroundGate = undefined;
    finish();
  };
}

describe('Reader on a session that refuses', () => {
  beforeEach(() => {
    harness.warnings = [];
    vi.stubGlobal(
      'FontFace',
      class {
        load(): Promise<this> {
          return Promise.resolve(this);
        }
      },
    );
    vi.stubGlobal('fonts', new Set<unknown>());
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      harness.warnings.push(args);
    });
  });

  afterEach(() => {
    // Every refusal a test provoked was read by that test: nothing else failed.
    expect(harness.warnings).toEqual([]);
    // The reader's work on artifacts came one call at a time, refused or not.
    expect((harness.fake as FakeReaderSession).violations).toEqual([]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('applies a setting changed while the book of the last one is laid out', async () => {
    const { reader, fake } = await open();
    const finishBook = holdBook(fake);
    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(fake.calls.at(-1)).toBe('advance');
    });

    // The session is occupied with the book of 32: the change waits for
    // that step, whose page is then not wanted, and is laid out after it.
    reader.setTypography({ fontSize: 24 });
    await settle();
    expect(reader.getLayoutGeometry().rootFontSize).toBe(32);
    finishBook();

    await bookAt(reader, 24);
    await settle();
    // Nothing of the layouts replaced is held, the unwanted book page included.
    expect(liveFontSizes(fake)).toEqual([24]);
    expect(fake.live.size).toBe(3);
    expect(fake.maxLive).toBeLessThanOrEqual(LIVE_ARTIFACT_CAP);
    await reader.dispose();
  });

  it('gives back a layout the session refuses to show and takes the next setting', async () => {
    const { reader, fake } = await open();
    fake.refuse('adoptForegroundCandidate', STALE);

    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(takeWarnings()).toEqual([`[rito] ${FAILED}`]);
    });
    await settle();
    // The reader shows what the session shows, and the candidate that was
    // refused holds no slot: the visible spread and its two neighbours.
    expect(reader.getLayoutGeometry().rootFontSize).toBe(16);
    expect(reader.layoutScope).toBe('book');
    expect(liveFontSizes(fake)).toEqual([16]);
    expect(fake.live.size).toBe(3);

    // The size is still the one asked for: the next change lays out for it.
    reader.setTypography({ lineHeight: 1.8 });
    await bookAt(reader, 32);
    for (const fontSize of [20, 24, 28]) {
      reader.setTypography({ fontSize });
      await bookAt(reader, fontSize);
    }
    await settle();
    expect(fake.live.size).toBe(3);
    await reader.dispose();
  });

  it('reports a layout the session has no room for and holds nothing of it', async () => {
    const { reader, fake } = await open();
    fake.refuse('requestArtifact', NO_ROOM);

    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(takeWarnings()).toEqual([`[rito] ${FAILED}`]);
    });
    await settle();
    expect(reader.getLayoutGeometry().rootFontSize).toBe(16);
    expect(fake.live.size).toBe(3);

    reader.setTypography({ fontSize: 24 });
    await bookAt(reader, 24);
    await reader.dispose();
  });

  it('keeps the book coming for the layout it shows when a newer one fails', async () => {
    const { reader, fake } = await open();
    const finishBook = holdBook(fake);
    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(fake.calls.at(-1)).toBe('advance');
    });
    expect(reader.layoutScope).toBe('chapter');

    // The reader turns and a change is asked for while the book is laid
    // out; the session cannot make the layout for the change.
    fake.refuse('adoptForegroundCandidate', new RitoReaderError('invalid-layout', 'no layout'));
    reader.notifyActiveSpread(1);
    reader.setTypography({ fontSize: 24 });
    finishBook();
    await vi.waitFor(() => {
      expect(takeWarnings()).toEqual([`[rito] ${FAILED}`]);
    });

    // The size it could not lay out is not shown; the one it shows gets its
    // whole book, on the page the reader turned to, and nothing of the
    // failed layout is held.
    await bookAt(reader, 32);
    await settle();
    expect(reader.activeSpreadIndex).toBe(fake.visibleSpread());
    expect(liveFontSizes(fake)).toEqual([32]);
    expect(fake.live.size).toBe(3);
    await reader.dispose();
  });

  it('waits with the book while the session could not follow a turn', async () => {
    const { reader, fake } = await open();
    const finishBook = holdBook(fake);
    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(fake.calls.at(-1)).toBe('advance');
    });

    // The reader turns while the book is laid out, and the session refuses
    // to show the spread it turned to.
    fake.refuse('commitPeekedArtifact', STALE);
    reader.notifyActiveSpread(1);
    finishBook();
    await vi.waitFor(() => {
      expect(takeWarnings()).toEqual([`[rito] ${FAILED}`]);
    });
    await settle();
    // The book is not brought for the page the reader left, and is not
    // asked for over and over either.
    const steps = fake.calls.filter((call) => call === 'advance').length;
    await settle();
    expect(fake.calls.filter((call) => call === 'advance')).toHaveLength(steps);
    expect(reader.layoutScope).toBe('chapter');

    // The next turn is followed, and the book arrives on that page.
    reader.notifyActiveSpread(2);
    await bookAt(reader, 32);
    await settle();
    expect(fake.visibleSpread()).toBe(reader.activeSpreadIndex);
    await reader.dispose();
  });

  it('tries the book again after a step of it failed, once the reader is asked something', async () => {
    const { reader, fake } = await open();
    fake.refuse('adoptBackgroundCandidate', STALE);

    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(takeWarnings()).toEqual(['[rito] reader whole-book layout failed']);
    });
    await settle();
    // The chapter stays readable, and the page the book brought was given
    // back: the chapter's first spread and the one after it are all that is held.
    expect(reader.layoutScope).toBe('chapter');
    expect(reader.getLayoutGeometry().rootFontSize).toBe(32);
    expect(fake.live.size).toBe(2);

    reader.notifyActiveSpread(reader.activeSpreadIndex + 1);
    await bookAt(reader, 32);
    await settle();
    expect(reader.activeSpreadIndex).toBe(fake.visibleSpread());
    await reader.dispose();
  });
});
