import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrowserReaderRevisionState,
  commitBrowserReaderViewResult,
} from '../../src/bindings/browser/reader/revision';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  createDeferred,
  createState,
  createWorker,
  flushPromises,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser reader revision lifecycle', () => {
  it('releases the previous worker revision when revision ids collide', () => {
    const foreground = createWorker(() => undefined);
    const background = createWorker(() => undefined);
    const state = createState(foreground.worker);
    setRevisionState(state, revisionResult('rev-1', 1, 1).bundle.revision);
    const nextResult = revisionResult('rev-1', 1, 1);
    const previousHandle = state.revisionHandle;
    if (!previousHandle) throw new Error('test revision handle is missing');
    state.interaction.pageTargets.set(0, {
      revision: previousHandle,
      value: { pageIndex: 0, spreadIndex: 0, targets: [] },
    });
    state.interaction.pendingPageTargets.set(0, {
      revision: previousHandle,
      task: Promise.resolve(undefined),
    });
    const versionedResult = {
      ...nextResult,
      bundle: {
        ...nextResult.bundle,
        revision: { ...nextResult.bundle.revision, revisionVersion: 7 },
      },
    };

    applyBrowserReaderRevisionState(state, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      result: versionedResult,
      worker: background.worker,
    });

    expect(foreground.releaseRevision).toHaveBeenCalledWith('rev-1');
    expect(foreground.releaseRevisionAtRevision).toHaveBeenCalledWith({
      revisionId: 'rev-1',
      revisionVersion: 0,
    });
    expect(state.revisionHandle).toEqual({
      workerSessionId: background.worker.sessionId,
      revisionId: 'rev-1',
      revisionVersion: 7,
      commitGeneration: 2,
    });
    expect(state.commitGeneration).toBe(2);
    expect(state.interaction.pageTargets.size).toBe(0);
    expect(state.interaction.pendingPageTargets.size).toBe(0);
  });

  it('does not release an accepted in-place revision advance on the same worker', () => {
    const fixture = createWorker(() => undefined);
    const state = createState(fixture.worker);
    setRevisionState(state, revisionResult('bounded', 1, 1).bundle.revision);
    const next = revisionResult('bounded', 2, 2);
    const advanced = {
      ...next,
      bundle: {
        ...next.bundle,
        revision: { ...next.bundle.revision, revisionVersion: 1 },
      },
    };

    applyBrowserReaderRevisionState(state, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      result: advanced,
      worker: fixture.worker,
    });

    expect(fixture.releaseRevisionAtRevision).not.toHaveBeenCalled();
    expect(state.revisionHandle).toEqual({
      workerSessionId: fixture.worker.sessionId,
      revisionId: 'bounded',
      revisionVersion: 1,
      commitGeneration: 2,
    });
  });

  it('blocks a pinned candidate revision until every required face has loaded', async () => {
    const loads = new Map<string, ReturnType<typeof createDeferred<FontFace>>>();
    class DeferredFontFace {
      constructor(readonly family: string) {}
      load(): Promise<FontFace> {
        const deferred = createDeferred<FontFace>();
        loads.set(this.family, deferred);
        return deferred.promise;
      }
    }
    vi.stubGlobal('FontFace', DeferredFontFace);
    const registry = { add: vi.fn(), delete: vi.fn((_face: FontFace) => true) };
    const foreground = createWorker(() => undefined);
    const candidate = createWorker(() => undefined);
    const state = pinnedState(foreground.worker, registry);
    const oldRevision = revisionResult('old', 1, 1).bundle.revision;
    setRevisionState(state, oldRevision);
    const result = withRequiredFonts(revisionResult('candidate', 1, 1), [
      requiredFace('First', 'fonts/shared.ttf', 0),
      requiredFace('Second', 'fonts/shared.ttf', 1),
    ]);
    const readResource = vi.fn<BrowserReaderState['worker']['readResourceAtRevision']>(
      (revision, _kind, href) => Promise.resolve(fontResource(revision, 'font', href)),
    );
    Object.assign(candidate.worker, { readResourceAtRevision: readResource });

    const commit = commitBrowserReaderViewResult(
      state,
      queuedReflow(state),
      candidate.worker,
      result,
      false,
    );
    await flushPromises();
    expect(readResource).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(loads.size).toBe(2);
    });
    expect(registry.add).not.toHaveBeenCalled();
    expect(state.revisionBundle.revision.revisionId).toBe('old');

    expectDefined(loads.get('Second')).resolve({} as FontFace);
    await flushPromises();
    expect(registry.add).not.toHaveBeenCalled();
    expectDefined(loads.get('First')).resolve({} as FontFace);
    await expect(commit).resolves.toBe(true);

    expect(registry.add.mock.calls.map(([face]) => (face as DeferredFontFace).family)).toEqual([
      'First',
      'Second',
    ]);
    expect(state.revisionBundle.revision.revisionId).toBe('candidate');
  });

  it('discards prepared required faces when the candidate becomes stale', async () => {
    const load = createDeferred<FontFace>();
    class DeferredFontFace {
      load(): Promise<FontFace> {
        return load.promise;
      }
    }
    vi.stubGlobal('FontFace', DeferredFontFace);
    const registry = { add: vi.fn(), delete: vi.fn((_face: FontFace) => true) };
    const foreground = createWorker(() => undefined);
    const candidate = createWorker(() => undefined);
    const state = pinnedState(foreground.worker, registry);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    const result = withRequiredFonts(revisionResult('candidate', 1, 1), [
      requiredFace('Book', 'fonts/book.ttf', 0),
    ]);
    const readResource = vi.fn<BrowserReaderState['worker']['readResourceAtRevision']>();
    readResource.mockResolvedValue(fontResource(candidateRevision(), 'font', 'fonts/book.ttf'));
    Object.assign(candidate.worker, { readResourceAtRevision: readResource });

    const commit = commitBrowserReaderViewResult(
      state,
      queuedReflow(state),
      candidate.worker,
      result,
      false,
    );
    await flushPromises();
    state.reflow.token += 1;
    load.resolve({} as FontFace);

    await expect(commit).resolves.toBe(false);
    expect(registry.add).not.toHaveBeenCalled();
    expect(candidate.releaseRevision).toHaveBeenCalledWith('candidate');
    expect(state.revisionBundle.revision.revisionId).toBe('old');
  });

  it('rolls back registered required faces when the decoded candidate becomes stale', async () => {
    class ImmediateFontFace {
      constructor(readonly family: string) {}
      load(): Promise<FontFace> {
        return Promise.resolve(this as unknown as FontFace);
      }
    }
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = { add: vi.fn(), delete: vi.fn((_face: FontFace) => true) };
    const foreground = createWorker(() => undefined);
    const candidate = createWorker(() => undefined);
    const state = pinnedState(foreground.worker, registry);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    const decode = state.decodeFrameCommandBuffer;
    Object.assign(state, {
      decodeFrameCommandBuffer: vi.fn<BrowserReaderState['decodeFrameCommandBuffer']>(
        (metadata, bytes) => {
          const frame = decode(metadata, bytes);
          state.reflow.token += 1;
          return frame;
        },
      ),
    });
    const result = withRequiredFonts(revisionResult('candidate', 1, 1), [
      requiredFace('Book', 'fonts/book.ttf', 0),
    ]);
    Object.assign(candidate.worker, {
      readResourceAtRevision: vi
        .fn<BrowserReaderState['worker']['readResourceAtRevision']>()
        .mockResolvedValue(fontResource(candidateRevision(), 'font', 'fonts/book.ttf')),
    });

    await expect(
      commitBrowserReaderViewResult(state, queuedReflow(state), candidate.worker, result, false),
    ).resolves.toBe(false);

    expect(registry.add).toHaveBeenCalledOnce();
    expect(registry.delete).toHaveBeenCalledWith(registry.add.mock.calls[0]?.[0]);
    expect(state.registeredFontFaces.size).toBe(0);
    expect(candidate.releaseRevision).toHaveBeenCalledWith('candidate');
    expect(state.revisionBundle.revision.revisionId).toBe('old');
  });

  it('rolls back registered required faces when candidate frame decoding fails', async () => {
    class ImmediateFontFace {
      load(): Promise<FontFace> {
        return Promise.resolve(this as unknown as FontFace);
      }
    }
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = { add: vi.fn(), delete: vi.fn((_face: FontFace) => true) };
    const foreground = createWorker(() => undefined);
    const candidate = createWorker(() => undefined);
    const state = pinnedState(foreground.worker, registry);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    Object.assign(state, {
      decodeFrameCommandBuffer: vi.fn(() => {
        throw new Error('frame decode failed');
      }),
    });
    const result = withRequiredFonts(revisionResult('candidate', 1, 1), [
      requiredFace('Book', 'fonts/book.ttf', 0),
    ]);
    Object.assign(candidate.worker, {
      readResourceAtRevision: vi
        .fn<BrowserReaderState['worker']['readResourceAtRevision']>()
        .mockResolvedValue(fontResource(candidateRevision(), 'font', 'fonts/book.ttf')),
    });

    await expect(
      commitBrowserReaderViewResult(state, queuedReflow(state), candidate.worker, result, false),
    ).rejects.toThrow('frame decode failed');

    expect(registry.add).toHaveBeenCalledOnce();
    expect(registry.delete).toHaveBeenCalledWith(registry.add.mock.calls[0]?.[0]);
    expect(state.registeredFontFaces.size).toBe(0);
    expect(candidate.releaseRevision).toHaveBeenCalledWith('candidate');
    expect(state.revisionBundle.revision.revisionId).toBe('old');
  });

  it('rolls back newly added faces when a later FontFaceSet add fails', async () => {
    class ImmediateFontFace {
      constructor(readonly family: string) {}
      load(): Promise<FontFace> {
        return Promise.resolve(this as unknown as FontFace);
      }
    }
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = {
      add: vi.fn((face: FontFace) => {
        if (face.family === 'Second') throw new Error('registry add failed');
      }),
      delete: vi.fn((_face: FontFace) => true),
    };
    const foreground = createWorker(() => undefined);
    const candidate = createWorker(() => undefined);
    const state = pinnedState(foreground.worker, registry);
    const existing = {} as FontFace;
    state.registeredFontFaces.set('legacy', existing);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    const result = withRequiredFonts(revisionResult('candidate', 1, 1), [
      requiredFace('First', 'fonts/first.ttf', 0),
      requiredFace('Second', 'fonts/second.ttf', 1),
    ]);
    const readResource = vi.fn<BrowserReaderState['worker']['readResourceAtRevision']>(
      (revision, _kind, href) => Promise.resolve(fontResource(revision, 'font', href)),
    );
    Object.assign(candidate.worker, { readResourceAtRevision: readResource });

    await expect(
      commitBrowserReaderViewResult(state, queuedReflow(state), candidate.worker, result, false),
    ).rejects.toThrow('registry add failed');

    expect(registry.delete).toHaveBeenCalledOnce();
    expect((registry.delete.mock.calls[0]?.[0] as ImmediateFontFace).family).toBe('First');
    expect(state.registeredFontFaces).toEqual(new Map([['legacy', existing]]));
    expect(candidate.releaseRevision).toHaveBeenCalledWith('candidate');
    expect(state.revisionBundle.revision.revisionId).toBe('old');
  });

  it('rejects same-length required font bytes with the wrong fingerprint', async () => {
    const constructFontFace = vi.fn();
    class ImmediateFontFace {
      constructor() {
        constructFontFace();
      }
      load(): Promise<FontFace> {
        return Promise.resolve(this as unknown as FontFace);
      }
    }
    vi.stubGlobal('FontFace', ImmediateFontFace);
    const registry = { add: vi.fn(), delete: vi.fn((_face: FontFace) => true) };
    const foreground = createWorker(() => undefined);
    const candidate = createWorker(() => undefined);
    const state = pinnedState(foreground.worker, registry);
    setRevisionState(state, revisionResult('old', 1, 1).bundle.revision);
    const result = withRequiredFonts(revisionResult('candidate', 1, 1), [
      requiredFace('Book', 'fonts/book.ttf', 0),
    ]);
    const resource = fontResource(candidateRevision(), 'font', 'fonts/book.ttf');
    resource.value.bytes.set([4, 3, 2, 1]);
    Object.assign(candidate.worker, {
      readResourceAtRevision: vi.fn().mockResolvedValue(resource),
    });

    await expect(
      commitBrowserReaderViewResult(state, queuedReflow(state), candidate.worker, result, false),
    ).rejects.toThrow('Pinned reader required font fingerprint mismatch');

    expect(constructFontFace).not.toHaveBeenCalled();
    expect(registry.add).not.toHaveBeenCalled();
    expect(candidate.releaseRevision).toHaveBeenCalledWith('candidate');
    expect(state.revisionBundle.revision.revisionId).toBe('old');
  });
});

function pinnedState(
  worker: BrowserReaderState['worker'],
  registry: {
    readonly add: (face: FontFace) => void;
    readonly delete: (face: FontFace) => boolean;
  },
): BrowserReaderState {
  const state = createState(worker);
  Object.assign(state.pinnedFonts, {
    registry,
    summary: {
      schemaVersion: 1,
      policyId: '1'.repeat(64),
      faces: [{ familyAlias: '__RitoPinned_test' }],
    },
  });
  return state;
}

function queuedReflow(state: BrowserReaderState) {
  return {
    config: state.config,
    spreadMode: state.spreadMode,
    lineBreaking: state.lineBreaking,
    token: state.reflow.token,
  };
}

function withRequiredFonts(
  result: ReturnType<typeof revisionResult>,
  faces: readonly ReturnType<typeof requiredFace>[],
) {
  return {
    ...result,
    bundle: {
      ...result.bundle,
      requiredFontFaces: {
        schemaVersion: 1 as const,
        revisionId: result.bundle.revision.revisionId,
        faces,
      },
    },
  };
}

function requiredFace(family: string, href: string, sourceOrder: number) {
  return {
    family,
    href,
    style: 'normal' as const,
    weight: 400,
    shapeFingerprint: '9f64a747e1b97f13',
    byteLength: 4,
    sourceOrder,
  };
}

function fontResource(
  revision: { readonly revisionId: string; readonly revisionVersion: number },
  kind: 'font',
  href: string,
): Awaited<ReturnType<BrowserReaderState['worker']['readResourceAtRevision']>> {
  return {
    revision,
    value: {
      payload: {
        revisionId: revision.revisionId,
        transferId: `transfer-${href}`,
        kind,
        href,
        mediaType: 'font/ttf',
        byteLength: 4,
      },
      bytes: new Uint8Array([1, 2, 3, 4]),
    },
  };
}

function candidateRevision(): { readonly revisionId: string; readonly revisionVersion: number } {
  return { revisionId: 'candidate', revisionVersion: 0 };
}

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}
