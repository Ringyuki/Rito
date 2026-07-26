import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserReaderCanvasUnsupportedErrorV1,
  createBrowserReaderV1CanvasPresenter,
} from '../../src/bindings/browser/reader-v1-canvas';
import {
  BROWSER_READER_CANVAS_IMAGE_LIMITS_V1,
  BrowserReaderCanvasImageBudgetExceededErrorV1,
  BrowserReaderCanvasImageLeaseBudgetV1,
} from '../../src/bindings/browser/reader-v1-canvas-image-limits';
import type {
  BrowserReaderArtifactV1,
  BrowserReaderResourceV1,
  BrowserReaderV1Session,
} from '../../src/bindings/browser/reader-v1';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';

const fontSet = { add: vi.fn(), delete: vi.fn() };
const closeImage = vi.fn();
const adoptForegroundCandidate = vi.fn(() => Promise.resolve());
const advanceBackgroundOnce = vi.fn(() => Promise.resolve());
const releaseArtifact = vi.fn(() => Promise.resolve(true));
const readResourceImpl = (artifactId: bigint, kind: 'font' | 'image', href: string) =>
  Promise.resolve(resource(artifactId, kind, href));
const readResource = vi.fn(readResourceImpl);

class FakeFontFace {
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors: FontFaceDescriptors,
  ) {}

  load(): Promise<FakeFontFace> {
    return Promise.resolve(this);
  }
}

describe('Browser Reader v1 Canvas presenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readResource.mockImplementation(readResourceImpl);
    vi.stubGlobal('document', { fonts: fontSet });
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() =>
        Promise.resolve({ width: 32, height: 48, close: closeImage } as unknown as ImageBitmap),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prepares every resource and adopts the still-latest candidate before painting', async () => {
    const artifact = readerArtifact();
    const session = readerSession(artifact);
    const presenter = createBrowserReaderV1CanvasPresenter(session);
    const prepared = await presenter.prepare(artifact, { pixelRatio: 2 });
    await session.adoptForegroundCandidate(undefined, artifact.artifactId);
    const mock = createMockCanvasContext();

    expect(readResource).toHaveBeenCalledTimes(2);
    expect(fontSet.add).toHaveBeenCalledOnce();
    expect(adoptForegroundCandidate).toHaveBeenCalledWith(undefined, artifact.artifactId);

    presenter.paint(prepared, mock.ctx);

    expect(mock.getCalls('clearRect')[0]?.args).toEqual([0, 0, 800, 600]);
    expect(mock.getCalls('scale')[0]?.args).toEqual([2, 2]);
    expect(mock.getCalls('fillText')[0]?.args).toEqual(['target', 20, 42.8]);
    expect(mock.getCalls('drawImage')[0]?.args.slice(1)).toEqual([0, 0, 40, 60]);

    presenter.paint(prepared, mock.ctx, {
      clear: false,
      foregroundColor: '#f5f5f5',
      backgroundColor: '#000000',
    });
    expect(mock.getPropertySets('fillStyle').some(({ value }) => value === '#f5f5f5')).toBe(true);

    prepared.dispose();
    await Promise.resolve();
    expect(closeImage).toHaveBeenCalledOnce();
    expect(fontSet.delete).toHaveBeenCalledOnce();
    presenter.dispose();
  });

  it('deduplicates resources while current and incoming animation artifacts coexist', async () => {
    const artifact = readerArtifact();
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    const [current, incoming] = await Promise.all([
      presenter.prepare(artifact),
      presenter.prepare({ ...artifact, artifactId: 12n }),
    ]);

    expect(readResource).toHaveBeenCalledTimes(2);
    current.dispose();
    await Promise.resolve();
    expect(closeImage).not.toHaveBeenCalled();
    expect(fontSet.delete).not.toHaveBeenCalled();

    incoming.dispose();
    await Promise.resolve();
    expect(closeImage).toHaveBeenCalledOnce();
    expect(fontSet.delete).toHaveBeenCalledOnce();
    presenter.dispose();
  });

  it('separates cache entries by target bucket while retaining session and href ownership', async () => {
    vi.stubGlobal('createImageBitmap', bitmapFactoryFromResizeOptions());
    const base = readerArtifact();
    const href = 'Images/bucketed.png';
    const commands: BrowserReaderArtifactV1['displayList']['displayList']['commands'] = [
      {
        kind: 'paint-image',
        opcode: 11,
        src: href,
        rect: { x: 0, y: 0, width: 100, height: 50 },
      },
    ];
    const first = artifactWithCommands(base, 31n, commands, [href]);
    const second = { ...first, artifactId: 32n, requestId: 32n };
    readResource.mockImplementation((artifactId, _kind, href) =>
      Promise.resolve(imageResource(artifactId, href, 1000, 500)),
    );
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(first));

    const current = await presenter.prepare(first, { pixelRatio: 1 });
    const incoming = await presenter.prepare(second, { pixelRatio: 2 });

    expect(readResource).toHaveBeenCalledTimes(2);
    expect(createImageBitmap).toHaveBeenNthCalledWith(
      1,
      expect.any(Blob),
      expect.objectContaining({ resizeWidth: 128, resizeHeight: 64 }),
    );
    expect(createImageBitmap).toHaveBeenNthCalledWith(
      2,
      expect.any(Blob),
      expect.objectContaining({ resizeWidth: 256, resizeHeight: 128 }),
    );
    current.dispose();
    incoming.dispose();
    await Promise.resolve();
    expect(closeImage).toHaveBeenCalledTimes(2);
    presenter.dispose();
  });

  it('decodes a transformed direct image into an aspect-preserving DPR target bucket', async () => {
    const createBitmap = bitmapFactoryFromResizeOptions();
    vi.stubGlobal('createImageBitmap', createBitmap);
    const base = readerArtifact();
    const commands: BrowserReaderArtifactV1['displayList']['displayList']['commands'] = [
      { kind: 'push-state', opcode: 1 },
      {
        kind: 'transform',
        opcode: 5,
        origin: { x: 0, y: 0 },
        boxSize: { width: 100, height: 50 },
        transforms: [{ kind: 'scale', sx: 0.5, sy: 2 }],
      },
      {
        kind: 'paint-image',
        opcode: 11,
        src: 'Images/large.png',
        rect: { x: 0, y: 0, width: 100, height: 50 },
      },
      { kind: 'pop-state', opcode: 2 },
    ];
    const artifact = artifactWithCommands(base, 21n, commands, ['Images/large.png']);
    readResource.mockResolvedValue(
      imageResource(artifact.artifactId, 'Images/large.png', 1000, 500),
    );
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    const prepared = await presenter.prepare(artifact, { pixelRatio: 2 });

    expect(createBitmap).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ resizeWidth: 448, resizeHeight: 224, resizeQuality: 'high' }),
    );
    prepared.dispose();
    presenter.dispose();
  });

  it('plans cover background decode size from its box, transform, and DPR', async () => {
    const createBitmap = bitmapFactoryFromResizeOptions();
    vi.stubGlobal('createImageBitmap', createBitmap);
    const base = readerArtifact();
    const commands: BrowserReaderArtifactV1['displayList']['displayList']['commands'] = [
      {
        kind: 'paint-block',
        opcode: 8,
        rect: { x: 0, y: 0, width: 300, height: 300 },
        paint: {
          background: {
            image: 'Images/background.png',
            size: 'cover',
            repeat: 'no-repeat',
          },
          boxShadows: [],
        },
      },
    ];
    const artifact = artifactWithCommands(base, 22n, commands, ['Images/background.png']);
    readResource.mockResolvedValue(
      imageResource(artifact.artifactId, 'Images/background.png', 1200, 800),
    );
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    const prepared = await presenter.prepare(artifact, { pixelRatio: 2 });

    expect(createBitmap).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ resizeWidth: 960, resizeHeight: 640 }),
    );
    prepared.dispose();
    presenter.dispose();
  });

  it('parses bounded PNG dimensions when Core metadata is absent', async () => {
    const createBitmap = bitmapFactoryFromResizeOptions();
    vi.stubGlobal('createImageBitmap', createBitmap);
    const base = readerArtifact();
    const artifact = imageOnlyArtifact(base, 23n, 'metadata-free', 1);
    const href = artifact.resources[0]?.href ?? '';
    readResource.mockResolvedValue(imageResource(artifact.artifactId, href, 1000, 500, false));
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    const prepared = await presenter.prepare(artifact);

    expect(createBitmap).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ resizeWidth: 64, resizeHeight: 32 }),
    );
    prepared.dispose();
    presenter.dispose();
  });

  it('parses a bounded JPEG header before requesting browser decode', async () => {
    const createBitmap = bitmapFactoryFromResizeOptions();
    vi.stubGlobal('createImageBitmap', createBitmap);
    const artifact = imageOnlyArtifact(readerArtifact(), 27n, 'jpeg', 1);
    const href = artifact.resources[0]?.href ?? '';
    readResource.mockResolvedValue({
      artifactId: artifact.artifactId,
      kind: 'image',
      href,
      mediaType: 'image/jpeg',
      bytes: jpegHeader(1000, 500),
    });
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    const prepared = await presenter.prepare(artifact);

    expect(createBitmap).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image/jpeg' }),
      expect.objectContaining({ resizeWidth: 64, resizeHeight: 32 }),
    );
    prepared.dispose();
    presenter.dispose();
  });

  it('binds paint DPR to the prepared resource target before clearing the canvas', async () => {
    const artifact = readerArtifact();
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));
    const prepared = await presenter.prepare(artifact, { pixelRatio: 2 });
    const mock = createMockCanvasContext();

    expect(() => {
      presenter.paint(prepared, mock.ctx, { pixelRatio: 1 });
    }).toThrow('pixelRatio must match');
    expect(mock.getCalls('clearRect')).toHaveLength(0);
    prepared.dispose();
    presenter.dispose();
  });

  it('prepares large resource sets in bounded batches below the worker queue limit', async () => {
    const hrefs = Array.from({ length: 12 }, (_, index) => `Images/page-${String(index)}.png`);
    const commands: BrowserReaderArtifactV1['displayList']['displayList']['commands'] = hrefs.map(
      (src, index) => ({
        kind: 'paint-image',
        opcode: 11,
        src,
        rect: { x: index * 10, y: 0, width: 10, height: 10 },
      }),
    );
    const base = readerArtifact();
    const artifact: BrowserReaderArtifactV1 = {
      ...base,
      fonts: [],
      resources: hrefs.map((href) => ({ kind: 'image', href })),
      displayList: {
        ...base.displayList,
        commandCount: commands.length,
        displayList: { formatVersion: 1, commandCount: commands.length, commands },
      },
    };
    let active = 0;
    let peak = 0;
    readResource.mockImplementation(async (artifactId, kind, href) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return resource(artifactId, kind, href);
    });
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    const prepared = await presenter.prepare(artifact);

    expect(readResource).toHaveBeenCalledTimes(hrefs.length);
    expect(peak).toBe(4);
    prepared.dispose();
    presenter.dispose();
  });

  it('shares one four-job cap across overlapping artifact preparations', async () => {
    const base = readerArtifact();
    const first = imageOnlyArtifact(base, 11n, 'first', 6);
    const second = imageOnlyArtifact(base, 12n, 'second', 6);
    const gate = deferred<undefined>();
    let active = 0;
    let peak = 0;
    readResource.mockImplementation(async (artifactId, kind, href) => {
      active += 1;
      peak = Math.max(peak, active);
      await gate.promise;
      active -= 1;
      return resource(artifactId, kind, href);
    });
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(first));

    const firstPrepare = presenter.prepare(first);
    const secondPrepare = presenter.prepare(second);
    await Promise.resolve();
    await Promise.resolve();

    expect(peak).toBe(4);
    gate.resolve(undefined);
    const prepared = await Promise.all([firstPrepare, secondPrepare]);
    expect(readResource).toHaveBeenCalledTimes(12);
    prepared.forEach((value) => {
      value.dispose();
    });
    presenter.dispose();
  });

  it('rejects queued image work on dispose and lets only four active reads drain', async () => {
    const artifact = imageOnlyArtifact(readerArtifact(), 24n, 'dispose', 12);
    const gate = deferred<undefined>();
    readResource.mockImplementation(async (artifactId, kind, href) => {
      await gate.promise;
      return resource(artifactId, kind, href);
    });
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    const preparation = presenter.prepare(artifact);
    await Promise.resolve();
    presenter.dispose();

    expect(readResource).toHaveBeenCalledTimes(4);
    gate.resolve(undefined);
    await expect(preparation).rejects.toThrow('disposed during preparation');
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('fails safely before decode for unsupported image formats even with claimed dimensions', async () => {
    const artifact = imageOnlyArtifact(readerArtifact(), 25n, 'unsupported', 1);
    const href = artifact.resources[0]?.href ?? '';
    readResource.mockResolvedValue({
      artifactId: artifact.artifactId,
      kind: 'image',
      href,
      mediaType: 'image/svg+xml',
      bytes: new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e]),
      width: 100,
      height: 100,
    });
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    await expect(presenter.prepare(artifact)).rejects.toEqual(
      expect.objectContaining<Partial<BrowserReaderCanvasUnsupportedErrorV1>>({
        feature: 'image-format:image/svg+xml',
      }),
    );
    expect(createImageBitmap).not.toHaveBeenCalled();
    presenter.dispose();
  });

  it('rejects oversized source dimensions before browser decode', async () => {
    const artifact = imageOnlyArtifact(readerArtifact(), 26n, 'oversized', 1);
    const href = artifact.resources[0]?.href ?? '';
    readResource.mockResolvedValue(imageResource(artifact.artifactId, href, 20_000, 1));
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(artifact));

    await expect(presenter.prepare(artifact)).rejects.toThrow('source dimension budget');
    expect(createImageBitmap).not.toHaveBeenCalled();
    presenter.dispose();
  });

  it('rejects unsupported paint before loading resources or committing a wrong frame', async () => {
    const artifact = readerArtifact();
    const unsupported: BrowserReaderArtifactV1 = {
      ...artifact,
      resources: [],
      fonts: [],
      displayList: {
        ...artifact.displayList,
        displayList: {
          formatVersion: 1,
          commandCount: 1,
          commands: [
            {
              kind: 'paint-block',
              opcode: 8,
              rect: { x: 0, y: 0, width: 40, height: 40 },
              paint: {
                border: { top: { color: srgb(0, 0, 0), style: 'double' } },
                boxShadows: [],
              },
              borderBox: { topWidth: 3, rightWidth: 0, bottomWidth: 0, leftWidth: 0 },
            },
          ],
        },
      },
    };
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(unsupported));

    await expect(presenter.prepare(unsupported)).rejects.toEqual(
      expect.objectContaining<Partial<BrowserReaderCanvasUnsupportedErrorV1>>({
        feature: 'border-style:double',
      }),
    );
    expect(readResource).not.toHaveBeenCalled();
    presenter.dispose();
  });

  it('rolls back an acquired font when later image preparation fails', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('bad image'))),
    );
    const visible = readerArtifact();
    const candidate = { ...visible, requestId: 2n, artifactId: 12n };
    const session = readerSession(visible);
    const presenter = createBrowserReaderV1CanvasPresenter(session);

    await expect(presenter.prepare(candidate)).rejects.toThrow('bad image');
    await Promise.resolve();
    await session.release(candidate.artifactId);
    await session.advanceBackgroundOnce(visible.artifactId, 1);

    expect(fontSet.add).toHaveBeenCalledOnce();
    expect(fontSet.delete).toHaveBeenCalledOnce();
    expect(adoptForegroundCandidate).not.toHaveBeenCalled();
    expect(releaseArtifact).toHaveBeenCalledWith(candidate.artifactId);
    expect(advanceBackgroundOnce).toHaveBeenCalledWith(visible.artifactId, 1);
    presenter.dispose();
  });

  it('rejects an invalid display state stack before clearing or painting', async () => {
    const artifact = readerArtifact();
    const invalid: BrowserReaderArtifactV1 = {
      ...artifact,
      resources: [],
      fonts: [],
      displayList: {
        ...artifact.displayList,
        displayList: {
          formatVersion: 1,
          commandCount: 1,
          commands: [{ kind: 'pop-state', opcode: 2 }],
        },
      },
    };
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(invalid));

    await expect(presenter.prepare(invalid)).rejects.toEqual(
      expect.objectContaining<Partial<BrowserReaderCanvasUnsupportedErrorV1>>({
        feature: 'display-state:unmatched-pop',
      }),
    );
    expect(readResource).not.toHaveBeenCalled();
    presenter.dispose();
  });

  it('uses the current worker realm FontFaceSet when document is unavailable', async () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('fonts', fontSet);
    const artifact = readerArtifact();
    const fontOnly: BrowserReaderArtifactV1 = {
      ...artifact,
      resources: artifact.resources.filter(({ kind }) => kind === 'font'),
      displayList: {
        ...artifact.displayList,
        displayList: {
          formatVersion: 1,
          commandCount: 1,
          commands: artifact.displayList.displayList.commands.slice(1, 2),
        },
      },
    };
    const presenter = createBrowserReaderV1CanvasPresenter(readerSession(fontOnly));

    const prepared = await presenter.prepare(fontOnly);

    expect(fontSet.add).toHaveBeenCalledOnce();
    prepared.dispose();
    await Promise.resolve();
    expect(fontSet.delete).toHaveBeenCalledOnce();
    presenter.dispose();
  });
});

describe('Browser Reader v1 Canvas image budgets', () => {
  const limits = {
    ...BROWSER_READER_CANVAS_IMAGE_LIMITS_V1,
    maxEncodedBytesPerImage: 8,
    maxEncodedBytesPerLease: 10,
    maxTargetPixelsPerLease: 10,
  };

  it('enforces per-image and aggregate encoded byte limits without allocating large fixtures', () => {
    const perImage = new BrowserReaderCanvasImageLeaseBudgetV1(limits);
    expect(() => {
      perImage.reserveEncoded(9, 'large.png');
    }).toThrow(BrowserReaderCanvasImageBudgetExceededErrorV1);

    const aggregate = new BrowserReaderCanvasImageLeaseBudgetV1(limits);
    aggregate.reserveEncoded(6, 'first.png');
    expect(() => {
      aggregate.reserveEncoded(6, 'second.png');
    }).toThrow('per-lease byte budget');
  });

  it('enforces aggregate target pixels for each artifact lease', () => {
    const budget = new BrowserReaderCanvasImageLeaseBudgetV1(limits);
    budget.reserveTarget(6, 'first.png');
    expect(() => {
      budget.reserveTarget(5, 'second.png');
    }).toThrow('per-lease pixel budget');
  });
});

function readerSession(artifact: BrowserReaderArtifactV1): BrowserReaderV1Session {
  return {
    sessionId: artifact.sessionId,
    initialArtifact: artifact,
    adoptForegroundCandidate,
    advanceBackgroundOnce,
    readResource,
    release: releaseArtifact,
  } as unknown as BrowserReaderV1Session;
}

function resource(
  artifactId: bigint,
  kind: 'font' | 'image',
  href: string,
): BrowserReaderResourceV1 {
  return kind === 'font'
    ? { artifactId, kind, href, mediaType: 'font/woff2', bytes: new Uint8Array([1, 2]) }
    : imageResource(artifactId, href, 32, 48);
}

function imageResource(
  artifactId: bigint,
  href: string,
  width: number,
  height: number,
  includeCoreDimensions = true,
): BrowserReaderResourceV1 {
  return {
    artifactId,
    kind: 'image',
    href,
    mediaType: 'image/png',
    bytes: pngHeader(width, height),
    ...(includeCoreDimensions ? { width, height } : {}),
  };
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  writeU32Be(bytes, 16, width);
  writeU32Be(bytes, 20, height);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]);
  writeU16Be(bytes, 7, height);
  writeU16Be(bytes, 9, width);
  bytes[11] = 3;
  return bytes;
}

function writeU16Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = Math.floor(value / 0x100) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeU32Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = Math.floor(value / 0x1000000) & 0xff;
  bytes[offset + 1] = Math.floor(value / 0x10000) & 0xff;
  bytes[offset + 2] = Math.floor(value / 0x100) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readerArtifact(): BrowserReaderArtifactV1 {
  const commands: BrowserReaderArtifactV1['displayList']['displayList']['commands'] = [
    {
      kind: 'paint-page',
      opcode: 7,
      rect: { x: 0, y: 0, width: 400, height: 600 },
      paint: { backgroundColor: srgb(1, 1, 1) },
    },
    {
      kind: 'paint-text',
      opcode: 9,
      text: 'target',
      rect: { x: 20, y: 30, width: 80, height: 24 },
      paint: {
        font: { family: 'Book Font', sizePx: 16, weight: 400, style: 'normal' },
        color: srgb(0, 0, 0),
        textShadows: [],
      },
    },
    {
      kind: 'paint-image',
      opcode: 11,
      src: 'Images/cover.png',
      rect: { x: 0, y: 0, width: 40, height: 60 },
    },
  ];
  return {
    protocolVersion: 1,
    capabilityProfileId: 1,
    sessionId: 7n,
    requestId: 1n,
    revisionId: 2n,
    revisionVersion: 1,
    artifactId: 11n,
    locator: { href: 'Text/Section040.xhtml', progression: 0.75 },
    matchedBy: 'progression',
    localPageIndex: 40,
    localSpreadIndex: 40,
    localPageIndexes: [40],
    width: 400,
    height: 600,
    terminalExtent: false,
    navigation: { previous: 'available', next: 'available' },
    textProfile: 'platform-string-runs',
    displayList: {
      formatVersion: 1,
      commandCount: commands.length,
      semanticDigest: new Uint8Array(32),
      wireBytes: new Uint8Array(),
      displayList: { formatVersion: 1, commandCount: commands.length, commands },
    },
    resources: [
      { kind: 'font', href: 'Fonts/book.woff2' },
      { kind: 'image', href: 'Images/cover.png' },
    ],
    fonts: [
      {
        family: 'Book Font',
        href: 'Fonts/book.woff2',
        style: 'normal',
        weight: 400,
        shapeFingerprint: 'font-shape-v1',
        byteLength: 2n,
      },
    ],
    pages: [],
  };
}

function imageOnlyArtifact(
  base: BrowserReaderArtifactV1,
  artifactId: bigint,
  prefix: string,
  count: number,
): BrowserReaderArtifactV1 {
  const hrefs = Array.from(
    { length: count },
    (_, index) => `Images/${prefix}-${String(index)}.png`,
  );
  const commands: BrowserReaderArtifactV1['displayList']['displayList']['commands'] = hrefs.map(
    (src, index) => ({
      kind: 'paint-image',
      opcode: 11,
      src,
      rect: { x: index * 10, y: 0, width: 10, height: 10 },
    }),
  );
  return {
    ...base,
    artifactId,
    requestId: artifactId,
    fonts: [],
    resources: hrefs.map((href) => ({ kind: 'image' as const, href })),
    displayList: {
      ...base.displayList,
      commandCount: commands.length,
      displayList: { formatVersion: 1, commandCount: commands.length, commands },
    },
  };
}

function artifactWithCommands(
  base: BrowserReaderArtifactV1,
  artifactId: bigint,
  commands: BrowserReaderArtifactV1['displayList']['displayList']['commands'],
  imageHrefs: readonly string[],
): BrowserReaderArtifactV1 {
  return {
    ...base,
    artifactId,
    requestId: artifactId,
    fonts: [],
    resources: imageHrefs.map((href) => ({ kind: 'image' as const, href })),
    displayList: {
      ...base.displayList,
      commandCount: commands.length,
      displayList: { formatVersion: 1, commandCount: commands.length, commands },
    },
  };
}

function bitmapFactoryFromResizeOptions() {
  return vi.fn((_source: Blob, options: ImageBitmapOptions) =>
    Promise.resolve({
      width: options.resizeWidth ?? 1,
      height: options.resizeHeight ?? 1,
      close: closeImage,
    } as unknown as ImageBitmap),
  );
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function srgb(red: number, green: number, blue: number) {
  return {
    space: 'srgb' as const,
    component0: red,
    component1: green,
    component2: blue,
    alpha: 1,
    none: { component0: false, component1: false, component2: false, alpha: false },
  };
}
