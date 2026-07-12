import { afterEach, describe, expect, it, vi } from 'vitest';
import { fullReflowWorker } from '../../src/bindings/browser/reader/revision';
import type { BrowserReaderWorkerOpenOptions } from '../../src/bindings/browser/core-contracts';
import { createState, createWorker } from './browser-reader-reflow-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser reader pinned font full-worker lifecycle', () => {
  it('keeps retained bytes across a failed open and retries with fresh clones', async () => {
    vi.stubGlobal('Worker', vi.fn());
    const foreground = createWorker(() => undefined);
    const failed = createWorker(() => undefined);
    const recovered = createWorker(() => undefined);
    const state = createState(foreground.worker);
    const summary = pinnedFontPolicySummary();
    const retained = new Uint8Array([1, 2, 3]).buffer;
    Object.assign(state, { pinnedFonts: pinnedFontState(retained, summary) });
    const transferred: ArrayBuffer[] = [];
    failed.open.mockImplementation(
      (_data: ArrayBuffer, options?: BrowserReaderWorkerOpenOptions) => {
        const bytes = requiredFaceBytes(options);
        transferred.push(bytes);
        structuredClone(bytes, { transfer: [bytes] });
        return Promise.reject(new Error('first full open failed'));
      },
    );
    recovered.open.mockImplementation(
      (_data: ArrayBuffer, options?: BrowserReaderWorkerOpenOptions) => {
        transferred.push(requiredFaceBytes(options));
        return Promise.resolve({ publication: state.publication, pinnedFontPolicy: summary });
      },
    );
    const workerFactory = vi
      .fn(() => recovered.worker)
      .mockReturnValueOnce(failed.worker)
      .mockReturnValueOnce(recovered.worker);
    Object.assign(state, { workerFactory });

    await expect(fullReflowWorker(state)).rejects.toThrow('first full open failed');
    await expect(fullReflowWorker(state)).resolves.toBe(recovered.worker);

    expect(new Uint8Array(retained)).toEqual(new Uint8Array([1, 2, 3]));
    expect(transferred).toHaveLength(2);
    expect(transferred[0]).not.toBe(retained);
    expect(transferred[1]).not.toBe(retained);
    expect(transferred[0]).not.toBe(transferred[1]);
    expect(failed.dispose).toHaveBeenCalledOnce();
  });

  it('clears, disposes, and retries a worker with a mismatched canonical summary', async () => {
    vi.stubGlobal('Worker', vi.fn());
    const foreground = createWorker(() => undefined);
    const mismatched = createWorker(() => undefined);
    const recovered = createWorker(() => undefined);
    const state = createState(foreground.worker);
    const expected = pinnedFontPolicySummary();
    const retained = new Uint8Array([1, 2, 3]).buffer;
    const workerFactory = vi
      .fn(() => recovered.worker)
      .mockReturnValueOnce(mismatched.worker)
      .mockReturnValueOnce(recovered.worker);
    Object.assign(state, {
      pinnedFonts: pinnedFontState(retained, expected),
      workerFactory,
    });
    mismatched.open.mockResolvedValue({
      publication: state.publication,
      pinnedFontPolicy: { ...expected, policyId: 'd'.repeat(64) },
    });
    recovered.open.mockResolvedValue({
      publication: state.publication,
      pinnedFontPolicy: expected,
    });

    await expect(fullReflowWorker(state)).rejects.toThrow(
      'Browser reader worker returned a different pinned font policy',
    );
    expect(mismatched.dispose).toHaveBeenCalledOnce();
    expect(state.fullReflowWorker).toBeUndefined();
    expect(state.fullReflowOpenPromise).toBeUndefined();

    await expect(fullReflowWorker(state)).resolves.toBe(recovered.worker);
    expect(workerFactory).toHaveBeenCalledTimes(2);
    expect(new Uint8Array(retained)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

function requiredFaceBytes(options: BrowserReaderWorkerOpenOptions | undefined): ArrayBuffer {
  const bytes = options?.pinnedFontPolicy?.faces[0]?.bytes;
  if (!bytes) throw new Error('Expected pinned bytes');
  return bytes;
}

function pinnedFontState(
  retained: ArrayBuffer,
  summary: ReturnType<typeof pinnedFontPolicySummary>,
) {
  return {
    policy: {
      schemaVersion: 1 as const,
      faces: [
        {
          bytes: retained,
          expectedSha256: summary.faces[0]?.sha256 ?? '',
          genericRole: 'serif' as const,
        },
      ],
    },
    summary,
    registry: undefined,
    faces: new Map<string, FontFace>(),
  };
}

function pinnedFontPolicySummary() {
  const sha256 = 'a'.repeat(64);
  return {
    schemaVersion: 1 as const,
    policyId: 'c'.repeat(64),
    faces: [
      {
        sha256,
        shapeFingerprint: sha256.slice(0, 16),
        familyAlias: `__RitoPinned_${sha256}`,
        byteLength: 3,
        genericRole: 'serif' as const,
        language: 'und',
        style: 'normal' as const,
        weight: 400 as const,
      },
    ],
  };
}
