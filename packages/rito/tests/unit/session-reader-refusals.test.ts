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

function requestedFontSizes(fake: FakeReaderSession): number[] {
  return fake.requests.slice(1).map((request) => request.layout.rootFontSize);
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
    // A refusal the reader rides out is not a failure: nothing is reported.
    expect(harness.warnings).toEqual([]);
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

    reader.setTypography({ fontSize: 24 });
    await vi.waitFor(() => {
      expect(reader.getLayoutGeometry().rootFontSize).toBe(24);
    });
    finishBook();

    await bookAt(reader, 24);
    await settle();
    // The book laid out for the size replaced was given back.
    expect(liveFontSizes(fake)).toEqual([24]);
    expect(fake.maxLive).toBeLessThanOrEqual(LIVE_ARTIFACT_CAP);
    await reader.dispose();
  });

  it('gives back a layout the session refuses to adopt and asks for it again', async () => {
    const { reader, fake } = await open();
    fake.refuse('adoptForegroundCandidate', STALE);

    reader.setTypography({ fontSize: 32 });

    await bookAt(reader, 32);
    await settle();
    expect(requestedFontSizes(fake)).toEqual([32, 32]);
    // The candidate that was refused holds no slot: the visible spread and
    // its two neighbours are all the session keeps.
    expect(fake.live.size).toBe(3);
    expect(liveFontSizes(fake)).toEqual([32]);

    // Every later setting still has room.
    for (const fontSize of [20, 24, 28]) {
      reader.setTypography({ fontSize });
      await bookAt(reader, fontSize);
    }
    await settle();
    expect(fake.live.size).toBe(3);
    await reader.dispose();
  });

  it('keeps a setting the session had no room for and applies it once it has', async () => {
    const { reader, fake } = await open();
    fake.refuse('requestArtifact', NO_ROOM, 3);

    reader.setTypography({ fontSize: 32 });

    await bookAt(reader, 32);
    expect(fake.calls.filter((call) => call === 'refused requestArtifact')).toHaveLength(3);
    expect(requestedFontSizes(fake)).toEqual([32]);
    await reader.dispose();
  });

  it('lays out for the newest setting when one refused before it is due again', async () => {
    const { reader, fake } = await open();
    const finishBook = holdBook(fake);
    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(reader.getLayoutGeometry().rootFontSize).toBe(32);
    });
    expect(reader.layoutScope).toBe('chapter');

    // A change is refused; before it is asked again the reader is set back
    // to what it shows, which needs no layout.
    fake.refuse('requestArtifact', NO_ROOM);
    fake.onRefusal = () => reader.setTypography({ fontSize: 32 });
    reader.setTypography({ fontSize: 24 });
    await vi.waitFor(() => {
      expect(fake.calls).toContain('refused requestArtifact');
    });
    finishBook();

    // The chapter it shows still gets its whole book.
    await bookAt(reader, 32);
    await settle();
    expect(requestedFontSizes(fake)).toEqual([32]);
    await reader.dispose();
  });

  it('reports a layout the session cannot make and keeps the one it shows whole', async () => {
    const { reader, fake } = await open();
    const finishBook = holdBook(fake);
    reader.setTypography({ fontSize: 32 });
    await vi.waitFor(() => {
      expect(reader.getLayoutGeometry().rootFontSize).toBe(32);
    });

    fake.refuse('adoptForegroundCandidate', new RitoReaderError('invalid-layout', 'not a layout'));
    reader.setTypography({ fontSize: 24 });
    await vi.waitFor(() => {
      expect(harness.warnings).toHaveLength(1);
    });
    expect(String(harness.warnings[0])).toContain('reader session operation failed');
    harness.warnings = [];
    finishBook();

    // The size it could not lay out is not shown; the one it shows is laid
    // out for the whole book, and nothing of the failed one is held.
    await bookAt(reader, 32);
    await settle();
    expect(liveFontSizes(fake)).toEqual([32]);
    expect(fake.live.size).toBe(3);

    reader.setTypography({ fontSize: 20 });
    await bookAt(reader, 20);
    await reader.dispose();
  });
});
