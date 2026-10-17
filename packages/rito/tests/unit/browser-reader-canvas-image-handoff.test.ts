import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserReaderSessionCanvasPresenter } from '../../src/bindings/browser/reader-session-canvas';
import {
  RitoReaderError,
  type BrowserReaderArtifact,
  type BrowserReaderResource,
  type BrowserReaderSession,
} from '../../src/bindings/browser/reader-session';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';

const HREF = 'Images/plate.png';

describe('an image read shared between two artifacts of one page', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() =>
        Promise.resolve({ width: 32, height: 48, close: vi.fn() } as unknown as ImageBitmap),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads through the artifact that replaced the one it was waiting on', async () => {
    // The page laid out alone reads its image and waits for the shard; the
    // whole-book layout brings the same page meanwhile, and the reader
    // gives the old page back before the shard arrives.
    const shown = imageArtifact(11n);
    const book = imageArtifact(12n);
    let failShown: (error: unknown) => void = () => undefined;
    const readResource = vi.fn((artifactId: bigint, _kind: 'font' | 'image', href: string) =>
      artifactId === shown.artifactId
        ? new Promise<BrowserReaderResource>((_, reject) => {
            failShown = reject;
          })
        : Promise.resolve(pngResource(artifactId, href)),
    );
    const presenter = createBrowserReaderSessionCanvasPresenter(session(shown, readResource));

    const old = await presenter.prepare(shown);
    const next = await presenter.prepare(book);
    old.dispose();
    failShown(
      new RitoReaderError('unknown-artifact', 'Reader artifact is not live in this worker'),
    );
    await next.imagesSettled;

    const mock = createMockCanvasContext();
    presenter.paint(next, mock.ctx);
    expect(mock.getCalls('drawImage')).toHaveLength(1);
    expect(readResource).toHaveBeenCalledWith(book.artifactId, 'image', HREF);
    next.dispose();
    presenter.dispose();
  });

  it('shares a failure of the image itself with every artifact waiting on it', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('bad image'))),
    );
    const shown = imageArtifact(11n);
    const book = imageArtifact(12n);
    let landShown: (resource: BrowserReaderResource) => void = () => undefined;
    const readResource = vi.fn(
      () =>
        new Promise<BrowserReaderResource>((resolve) => {
          landShown = resolve;
        }),
    );
    const presenter = createBrowserReaderSessionCanvasPresenter(session(shown, readResource));

    const old = await presenter.prepare(shown);
    const next = await presenter.prepare(book);
    landShown(pngResource(shown.artifactId, HREF));
    await Promise.all([old.imagesSettled, next.imagesSettled]);

    const mock = createMockCanvasContext();
    presenter.paint(next, mock.ctx);
    expect(mock.getCalls('drawImage')).toHaveLength(0);
    expect(readResource).toHaveBeenCalledOnce();
    old.dispose();
    next.dispose();
    presenter.dispose();
  });
});

function imageArtifact(artifactId: bigint): BrowserReaderArtifact {
  const commands: BrowserReaderArtifact['displayList']['displayList']['commands'] = [
    { kind: 'draw-image', src: HREF, dest: { x: 0, y: 0, width: 32, height: 48 } },
  ];
  return {
    protocolVersion: 1,
    capabilityProfileId: 1,
    sessionId: 7n,
    requestId: artifactId,
    revisionId: artifactId,
    revisionVersion: 1,
    artifactId,
    locator: { href: 'Text/plate.xhtml', progression: 0 },
    matchedBy: 'progression',
    localPageIndex: 0,
    localSpreadIndex: 0,
    localPageIndexes: [0],
    width: 400,
    height: 600,
    navigation: { previous: 'available', next: 'available' },
    textProfile: 'platform-string-runs',
    displayList: {
      formatVersion: 2,
      commandCount: commands.length,
      wireBytes: new Uint8Array(),
      displayList: { formatVersion: 2, ratio: 1, commandCount: commands.length, commands },
    },
    resources: [{ kind: 'image', href: HREF }],
    fonts: [],
    pages: [],
  };
}

function session(
  artifact: BrowserReaderArtifact,
  readResource: BrowserReaderSession['readResource'],
): BrowserReaderSession {
  return {
    sessionId: artifact.sessionId,
    initialArtifact: artifact,
    readResource,
    release: vi.fn(() => Promise.resolve(true)),
  } as unknown as BrowserReaderSession;
}

function pngResource(artifactId: bigint, href: string): BrowserReaderResource {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 32);
  new DataView(bytes.buffer).setUint32(20, 48);
  return { artifactId, kind: 'image', href, mediaType: 'image/png', bytes, width: 32, height: 48 };
}
