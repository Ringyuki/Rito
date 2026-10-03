import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserReaderWorkerClient,
  BrowserReaderWorkerOpenOptions,
  CorePinnedFontPolicySummary,
} from '../../src/bindings/browser/core-contracts';
import {
  disposeBrowserReaderPinnedFonts,
  openBrowserReaderWorker,
  prepareBrowserReaderPinnedFonts,
  registerBrowserReaderPinnedFonts,
} from '../../src/bindings/browser/pinned-fonts';
import {
  addBrowserReaderHostFontFaces,
  removeBrowserReaderHostFontFaces,
} from '../../src/bindings/browser/host-font-faces';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser reader pinned fonts', () => {
  it('owns caller bytes and creates fresh transferable buffers for every worker open', async () => {
    const registry = fontRegistry();
    stubFontEnvironment(LoadedFontFace, registry);
    const callerBytes = new Uint8Array([1, 2, 3]).buffer;
    const prepared = prepareBrowserReaderPinnedFonts(policy([face(callerBytes, HASH_A, 'serif')]));
    const retained = prepared.policy?.faces[0]?.bytes;
    if (!retained) throw new Error('Expected retained pinned font bytes');
    const transferred: ArrayBuffer[] = [];
    const open = vi.fn((data: ArrayBuffer, options?: BrowserReaderWorkerOpenOptions) => {
      const fontBytes = options?.pinnedFontPolicy?.faces[0]?.bytes;
      if (!fontBytes) throw new Error('Expected worker pinned font bytes');
      expect(new Uint8Array(fontBytes)).toEqual(new Uint8Array(callerBytes));
      expect(fontBytes).not.toBe(retained);
      transferred.push(fontBytes);
      structuredClone({ data, options }, { transfer: [data, fontBytes] });
      return Promise.resolve({
        publication: publication(),
        pinnedFontPolicy: summary([summaryFace(HASH_A, 'serif', 3)]),
      });
    });
    const setRenderRatio = vi.fn(() => Promise.resolve());
    const worker = { open, setRenderRatio } as unknown as BrowserReaderWorkerClient;

    const first = await openBrowserReaderWorker(worker, epubBytes(), prepared.policy, 2);
    await openBrowserReaderWorker(worker, epubBytes(), prepared.policy, 2, first.pinnedFontPolicy);
    // Every open hands the worker the ratio its frames are painted at.
    expect(setRenderRatio.mock.calls).toEqual([[2], [2]]);
    const pinned = await registerBrowserReaderPinnedFonts(prepared, first.pinnedFontPolicy);

    expect(retained).not.toBe(callerBytes);
    expect(new Uint8Array(retained)).toEqual(new Uint8Array(callerBytes));
    expect(transferred).toHaveLength(2);
    expect(transferred[0]).not.toBe(transferred[1]);
    expect(transferred.map((buffer) => buffer.byteLength)).toEqual([0, 0]);
    expect(LoadedFontFace.created[0]?.source).toBe(retained);

    disposeBrowserReaderPinnedFonts(pinned);
    disposeBrowserReaderPinnedFonts(pinned);
    expect(registry.delete).toHaveBeenCalledOnce();
    expect(pinned.policy).toBeUndefined();
    expect(pinned.registry).toBeUndefined();
    expect(pinned.faces.size).toBe(0);
  });

  it('maps canonical summary order by SHA and adds only after every face loads', async () => {
    const registry = fontRegistry();
    const loads = new Map<string, () => void>();
    class DeferredFontFace extends LoadedFontFace {
      override load(): Promise<DeferredFontFace> {
        return new Promise((resolve) => {
          loads.set(this.family, () => {
            resolve(this);
          });
        });
      }
    }
    stubFontEnvironment(DeferredFontFace, registry);
    const prepared = prepareBrowserReaderPinnedFonts(
      policy([
        face(new Uint8Array([2]).buffer, HASH_B, 'sansSerif'),
        face(new Uint8Array([1]).buffer, HASH_A, 'serif'),
      ]),
    );
    const canonical = summary([summaryFace(HASH_A, 'serif'), summaryFace(HASH_B, 'sansSerif')]);

    const registration = registerBrowserReaderPinnedFonts(prepared, canonical);
    await flushPromises();
    const aliasA = alias(HASH_A);
    const aliasB = alias(HASH_B);
    loads.get(aliasB)?.();
    await flushPromises();
    expect(registry.add).not.toHaveBeenCalled();

    loads.get(aliasA)?.();
    const pinned = await registration;

    expect(registry.add.mock.calls.map(([loaded]) => loaded.family)).toEqual([aliasA, aliasB]);
    const byFamily = new Map(LoadedFontFace.created.map((loaded) => [loaded.family, loaded]));
    expect(new Uint8Array(byFamily.get(aliasA)?.source ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1]),
    );
    expect(new Uint8Array(byFamily.get(aliasB)?.source ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([2]),
    );
    disposeBrowserReaderPinnedFonts(pinned);
  });

  it('rolls back earlier registry additions when a later add fails', async () => {
    const registry = fontRegistry();
    registry.add
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('registry rejected face');
      });
    stubFontEnvironment(LoadedFontFace, registry);
    const prepared = prepareBrowserReaderPinnedFonts(
      policy([
        face(new Uint8Array([1]).buffer, HASH_A, 'serif'),
        face(new Uint8Array([2]).buffer, HASH_B, 'sansSerif'),
      ]),
    );

    await expect(
      registerBrowserReaderPinnedFonts(
        prepared,
        summary([summaryFace(HASH_A, 'serif'), summaryFace(HASH_B, 'sansSerif')]),
      ),
    ).rejects.toThrow('registry rejected face');

    expect(registry.delete).toHaveBeenCalledOnce();
    expect(registry.delete).toHaveBeenCalledWith(registry.add.mock.calls[0]?.[0]);
  });

  it('does not mutate the registry when a pinned face fails to load', async () => {
    const registry = fontRegistry();
    class RejectedFontFace extends LoadedFontFace {
      override load(): Promise<RejectedFontFace> {
        return Promise.reject(new Error('font decode failed'));
      }
    }
    stubFontEnvironment(RejectedFontFace, registry);
    const prepared = prepareBrowserReaderPinnedFonts(
      policy([face(new Uint8Array([1]).buffer, HASH_A, 'serif')]),
    );

    await expect(
      registerBrowserReaderPinnedFonts(prepared, summary([summaryFace(HASH_A)])),
    ).rejects.toThrow('font decode failed');

    expect(registry.add).not.toHaveBeenCalled();
    expect(registry.delete).not.toHaveBeenCalled();
  });

  it('rejects a configured policy when FontFace or a mutable registry is unavailable', () => {
    vi.stubGlobal('FontFace', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('fonts', undefined);

    expect(() =>
      prepareBrowserReaderPinnedFonts(policy([face(new Uint8Array([1]).buffer, HASH_A, 'serif')])),
    ).toThrow('Browser pinned fonts require FontFace and a mutable FontFaceSet');
  });
  it('rejects mismatched or duplicated pinned font summaries', async () => {
    const registry = fontRegistry();
    stubFontEnvironment(LoadedFontFace, registry);
    const bytes = new Uint8Array([1]).buffer;

    // A summary face for a request that never sent one.
    const bare = prepareBrowserReaderPinnedFonts(undefined);
    await expect(
      registerBrowserReaderPinnedFonts(bare, summary([summaryFace(HASH_A)])),
    ).rejects.toThrow(/unexpected pinned font policy/);

    // Count mismatch between the request and the summary.
    const single = prepareBrowserReaderPinnedFonts(policy([face(bytes, HASH_A, 'serif')]));
    await expect(registerBrowserReaderPinnedFonts(single, summary([]))).rejects.toThrow(
      /does not match its request/,
    );

    // Duplicate SHA sources collapse in the lookup map.
    const dup = prepareBrowserReaderPinnedFonts(
      policy([face(bytes, HASH_A, 'serif'), face(bytes, HASH_A, 'serif')]),
    );
    await expect(
      registerBrowserReaderPinnedFonts(dup, summary([summaryFace(HASH_A), summaryFace(HASH_A)])),
    ).rejects.toThrow(/does not match its request/);

    // A summary face whose SHA the request never declared.
    const wrong = prepareBrowserReaderPinnedFonts(policy([face(bytes, HASH_A, 'serif')]));
    await expect(
      registerBrowserReaderPinnedFonts(wrong, summary([summaryFace('b'.repeat(64))])),
    ).rejects.toThrow(/does not match its request/);
  });

  it('requires a FontFaceSet once real faces must register', async () => {
    // The environment is present at prepare time and lost by register
    // time (the defensive branch a torn-down document reaches).
    stubFontEnvironment(LoadedFontFace, fontRegistry());
    const prepared = prepareBrowserReaderPinnedFonts(
      policy([face(new Uint8Array([1]).buffer, HASH_A, 'serif')]),
    );
    await expect(
      registerBrowserReaderPinnedFonts(
        { ...prepared, registry: undefined },
        summary([summaryFace(HASH_A)]),
      ),
    ).rejects.toThrow(/FontFace/);
  });
});
describe('Browser reader host faces changed at runtime', () => {
  async function openedPinnedFonts(registry: ReturnType<typeof fontRegistry>) {
    stubFontEnvironment(LoadedFontFace, registry);
    const prepared = prepareBrowserReaderPinnedFonts(
      policy([face(new Uint8Array([1]).buffer, HASH_A, 'serif')]),
    );
    return registerBrowserReaderPinnedFonts(prepared, summary([summaryFace(HASH_A)]));
  }

  it('register an added face for paint and replay it into every worker that opens', async () => {
    const registry = fontRegistry();
    const pinned = await openedPinnedFonts(registry);
    const extended = summary([summaryFace(HASH_A), summaryFace(HASH_B, 'sansSerif', 2)]);
    const addHostFontFaces = vi.fn(() => Promise.resolve(extended));
    const committed = { addHostFontFaces } as unknown as BrowserReaderWorkerClient;
    const callerBytes = new Uint8Array([7, 8]).buffer;
    await addBrowserReaderHostFontFaces(pinned, committed, [
      face(callerBytes, HASH_B, 'sansSerif'),
    ]);
    expect(pinned.summary).toBe(extended);
    expect(pinned.faces.get(alias(HASH_B))).toBe(LoadedFontFace.created.at(-1));
    expect(LoadedFontFace.created.at(-1)?.family).toBe(alias(HASH_B));

    // A reflow candidate opens on the open-time policy, then replays the
    // addition from retained bytes it can take.
    const replay = vi.fn((_faces: readonly { bytes: ArrayBuffer }[]) => Promise.resolve(extended));
    const candidate = {
      open: vi.fn(() =>
        Promise.resolve({
          publication: publication(),
          pinnedFontPolicy: summary([summaryFace(HASH_A)]),
        }),
      ),
      setRenderRatio: vi.fn(() => Promise.resolve()),
      addHostFontFaces: replay,
    } as unknown as BrowserReaderWorkerClient;
    await openBrowserReaderWorker(
      candidate,
      epubBytes(),
      pinned.policy,
      1,
      pinned.summary,
      pinned.changes,
    );
    const sent = replay.mock.calls[0]?.[0]?.[0]?.bytes;
    expect(new Uint8Array(sent ?? new ArrayBuffer(0))).toEqual(new Uint8Array([7, 8]));
    expect(sent).not.toBe(callerBytes);

    // A worker that ends on other faces than the committed layout is refused.
    const stale = {
      ...candidate,
      addHostFontFaces: vi.fn(() => Promise.resolve(summary([summaryFace(HASH_A)]))),
    } as unknown as BrowserReaderWorkerClient;
    await expect(
      openBrowserReaderWorker(stale, epubBytes(), pinned.policy, 1, pinned.summary, pinned.changes),
    ).rejects.toThrow(/different pinned font policy/);
  });

  it('take a removed face out of paint', async () => {
    const registry = fontRegistry();
    const pinned = await openedPinnedFonts(registry);
    const both = summary([summaryFace(HASH_A), summaryFace(HASH_B, 'sansSerif')]);
    const worker = {
      addHostFontFaces: vi.fn(() => Promise.resolve(both)),
      removeHostFontFaces: vi.fn(() => Promise.resolve(summary([summaryFace(HASH_A)]))),
    } as unknown as BrowserReaderWorkerClient;
    await addBrowserReaderHostFontFaces(pinned, worker, [
      face(new Uint8Array([3]).buffer, HASH_B, 'sansSerif'),
    ]);
    const added = pinned.faces.get(alias(HASH_B));
    await removeBrowserReaderHostFontFaces(pinned, worker, [HASH_B]);
    expect(registry.delete).toHaveBeenCalledWith(added);
    expect(pinned.faces.has(alias(HASH_B))).toBe(false);
    expect(pinned.faces.has(alias(HASH_A))).toBe(true);
    expect(pinned.changes.map((change) => change.kind)).toEqual(['add', 'remove']);
  });
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

class LoadedFontFace {
  static readonly created: LoadedFontFace[] = [];

  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors?: FontFaceDescriptors,
  ) {
    LoadedFontFace.created.push(this);
  }

  load(): Promise<LoadedFontFace> {
    return Promise.resolve(this);
  }
}

function stubFontEnvironment(
  fontFace: typeof LoadedFontFace,
  registry: ReturnType<typeof fontRegistry>,
): void {
  LoadedFontFace.created.length = 0;
  vi.stubGlobal('FontFace', fontFace);
  vi.stubGlobal('document', { fonts: registry });
}

function fontRegistry() {
  return {
    add: vi.fn<(face: FontFace) => void>(),
    delete: vi.fn<(face: FontFace) => boolean>(() => true),
  };
}

function policy(faces: readonly ReturnType<typeof face>[]) {
  return { schemaVersion: 1 as const, faces };
}

function face(bytes: ArrayBuffer, expectedSha256: string, genericRole: 'serif' | 'sansSerif') {
  return { bytes, expectedSha256, genericRole };
}

function summary(faces: readonly ReturnType<typeof summaryFace>[]): CorePinnedFontPolicySummary {
  return { schemaVersion: 1, policyId: 'c'.repeat(64), faces };
}

function summaryFace(sha256: string, genericRole: 'serif' | 'sansSerif' = 'serif', byteLength = 1) {
  return {
    sha256,
    familyName: 'Fixture',
    shapeFingerprint: sha256.slice(0, 16),
    familyAlias: alias(sha256),
    byteLength,
    genericRole,
    language: 'und',
    style: 'normal' as const,
    weight: 400 as const,
  };
}

function alias(sha256: string): string {
  return `__RitoPinned_${sha256}`;
}

function epubBytes(): ArrayBuffer {
  return new Uint8Array([9]).buffer;
}

function publication() {
  return {
    package: {
      metadata: { title: '', language: '', identifier: '' },
      manifest: [],
      spine: [],
      toc: [],
    },
    resources: { stylesheets: [], fonts: [], images: [] },
    chapters: [],
    fontFaces: [],
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
