import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  openBrowserReaderV1WithWorker,
  type BrowserReaderArtifactV1,
  type BrowserReaderPublicationV1,
} from '../../src/bindings/browser/reader-v1';

const mocks = vi.hoisted(() => ({
  adoptBackgroundCandidate: vi.fn(),
  adoptForegroundCandidate: vi.fn(),
  advanceBackgroundOnce: vi.fn(),
  dispose: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  open: vi.fn(),
  readPublication: vi.fn(),
}));

vi.mock('@ritojs/core-wasm/decoder', () => ({
  RitoReaderErrorV1: class RitoReaderErrorV1 extends Error {},
  createRitoCoreWasmReaderV1WorkerClient: vi.fn(() => ({
    sessionId: 7n,
    open: mocks.open,
    requestAdjacent: vi.fn(),
    requestArtifact: vi.fn(),
    seek: vi.fn(),
    adoptForegroundCandidate: mocks.adoptForegroundCandidate,
    readPublication: mocks.readPublication,
    advanceBackgroundOnce: mocks.advanceBackgroundOnce,
    adoptBackgroundCandidate: mocks.adoptBackgroundCandidate,
    readResource: vi.fn(),
    release: vi.fn(),
    dispose: mocks.dispose,
  })),
}));

const options = {
  initialLocator: { href: 'Text/Section040.xhtml', progression: 0.75 },
  layout: {
    viewportWidth: 800,
    viewportHeight: 600,
    marginTop: 24,
    marginRight: 24,
    marginBottom: 24,
    marginLeft: 24,
    spreadMode: 'single' as const,
    firstPageAlone: false,
    spreadGap: 24,
    rootFontSize: 16,
  },
  work: {
    maxTopLevelNodesPerQuantum: 64,
    maxForegroundQuanta: 8,
    localPageCap: 16,
  },
};

describe('Browser Reader v1 facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the requested initial locator as a candidate and adopts it explicitly', async () => {
    const artifact = { artifactId: 11n } as BrowserReaderArtifactV1;
    mocks.open.mockResolvedValueOnce(artifact);

    const session = await openBrowserReaderV1WithWorker({} as never, new ArrayBuffer(8), options);

    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.open.mock.calls[0]?.[1]).toEqual({
      layout: options.layout,
      locator: options.initialLocator,
      work: options.work,
      textProfile: 'platform-string-runs',
    });
    expect(session.initialArtifact).toBe(artifact);
    const publication: BrowserReaderPublicationV1 = {
      protocolVersion: 1,
      sessionId: 7n,
      metadata: { title: 'Book', language: 'ja', identifier: 'book-id' },
      spine: [],
      toc: [],
    };
    mocks.readPublication.mockResolvedValueOnce(publication);
    await expect(session.readPublication()).resolves.toBe(publication);
    await session.adoptForegroundCandidate(undefined, 11n);
    await session.advanceBackgroundOnce(11n, 64);
    await session.adoptBackgroundCandidate(11n, 12n);
    expect(mocks.advanceBackgroundOnce).toHaveBeenCalledWith(11n, 64);
    expect(mocks.adoptForegroundCandidate).toHaveBeenCalledWith(undefined, 11n);
    expect(mocks.adoptBackgroundCandidate).toHaveBeenCalledWith(11n, 12n);
    expect(mocks.readPublication).toHaveBeenCalledOnce();
  });

  it('disposes the dedicated worker client when initial artifact creation fails', async () => {
    const failure = new Error('initial locator failed');
    mocks.open.mockRejectedValueOnce(failure);

    await expect(
      openBrowserReaderV1WithWorker({} as never, new ArrayBuffer(8), options),
    ).rejects.toBe(failure);

    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('keeps raw WASM ownership in the worker entry and the main facade on decoder-only imports', () => {
    const bindingRoot = join(import.meta.dirname, '../../src/bindings/browser');
    const facade = readFileSync(join(bindingRoot, 'reader-v1.ts'), 'utf8');
    const worker = readFileSync(join(bindingRoot, 'reader-v1-worker.ts'), 'utf8');

    expect(facade).toContain("from '@ritojs/core-wasm/decoder'");
    expect(facade).not.toContain("from '@ritojs/core-wasm'");
    expect(facade).not.toContain('RitoReaderSessionV1');
    expect(facade).toContain('options.initialLocator');
    expect(facade).toContain('adoptForegroundCandidate');
    expect(facade).toContain('readPublication');
    expect(worker).toContain('RitoReaderSessionV1');
    expect(worker).toContain("from '@ritojs/core-wasm'");
  });
});
