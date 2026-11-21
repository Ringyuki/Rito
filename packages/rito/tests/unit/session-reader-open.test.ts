import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reader, ReaderLocator } from '../../src/reader';
import type { BrowserReaderSessionOpenOptions } from '../../src/bindings/browser/reader-session';
import { createReader } from '../../src/bindings/browser/session-reader/reader';
import {
  fakeCanvasContext,
  type FakeChapter,
  type FakeReaderSession,
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

async function open(initialLocator: ReaderLocator): Promise<Reader> {
  const ctx = fakeCanvasContext(800, 1200);
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return createReader(new ArrayBuffer(4), canvas as never, {
    width: 400,
    height: 600,
    devicePixelRatio: 2,
    logLevel: 'warn',
    initialLocator,
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [{ bytes: new ArrayBuffer(8), expectedSha256: 'ab'.repeat(32), genericRole: 'serif' }],
    },
  });
}

describe('Reader opening on a saved position', () => {
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
    expect(harness.warnings).toEqual([]);
    expect((harness.fake as FakeReaderSession).violations).toEqual([]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('says how much of the position it opened at matched', async () => {
    const reader = await open({ href: 'one.xhtml', progression: 0.5 });
    expect(reader.initialLocatorMatch).toBe('progression');
    await reader.dispose();
  });

  it('opens a book whose saved position names no chapter at its start, and says so', async () => {
    const reader = await open({ href: 'another-edition.xhtml', progression: 0.5 });

    expect(reader.initialLocatorMatch).toBe('bookStart');
    expect(reader.activeSpreadIndex).toBe(0);
    expect((harness.fake as FakeReaderSession).visibleSpread()).toBe(0);
    // Once open, a locator that names no chapter leaves the reader where it is.
    await expect(
      reader.navigateToLocator?.({ href: 'another-edition.xhtml' }),
    ).resolves.toBeUndefined();
    expect(reader.activeSpreadIndex).toBe(0);
    await reader.dispose();
  });
});
