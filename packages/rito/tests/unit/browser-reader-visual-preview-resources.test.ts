import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserReaderRevisionResult,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import { commitBrowserReaderViewResult } from '../../src/bindings/browser/reader/revision';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  createDeferred,
  createState,
  createWorker,
  flushPromises,
  revisionResult,
} from './browser-reader-reflow-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser reader visual preview resources', () => {
  it('commits mixed content before its selected image resource finishes decoding', async () => {
    const imageDecode = createDeferred<ImageBitmap>();
    const bitmap = fakeImageBitmap();
    const createImageBitmap = vi.fn(() => imageDecode.promise);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { worker } = createWorker(() => undefined);
    const state = previewState(worker);
    const invalidated = collectInvalidatedSpreads(state);

    await expect(
      commitResourceVisualPreview(state, worker, resourceRevisionResult('mixed-preview', false)),
    ).resolves.toBe(true);

    expect(state.visualPreview?.revisionId).toBe('mixed-preview');
    expect(state.visualPreview?.spreadIndex).toBe(2);
    expect(state.visualPreview?.frame.resourceRefs.images).toEqual(['images/cover.png']);
    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(state.images.has('images/cover.png')).toBe(false);
    expect(invalidated).toEqual([2]);

    imageDecode.resolve(bitmap);
    await flushPromises();

    expect(state.images.get('images/cover.png')).toBe(bitmap);
    expect(invalidated).toEqual([2, 2]);
  });

  it('does not invalidate a preview after navigation makes it inactive', async () => {
    const imageDecode = createDeferred<ImageBitmap>();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => imageDecode.promise),
    );
    const { worker } = createWorker(() => undefined);
    const state = previewState(worker);
    const invalidated = collectInvalidatedSpreads(state);

    await commitResourceVisualPreview(
      state,
      worker,
      resourceRevisionResult('stale-preview', false),
    );
    state.activeSpreadIndex = 1;
    imageDecode.resolve(fakeImageBitmap());
    await flushPromises();

    expect(state.images.has('images/cover.png')).toBe(true);
    expect(invalidated).toEqual([2]);
  });

  it('does not invalidate a replacement preview when stale image decode settles', async () => {
    const imageDecode = createDeferred<ImageBitmap>();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => imageDecode.promise),
    );
    const { worker } = createWorker(() => undefined);
    const state = previewState(worker);
    const invalidated = collectInvalidatedSpreads(state);

    await commitResourceVisualPreview(
      state,
      worker,
      resourceRevisionResult('stale-preview', false),
    );
    const preview = state.visualPreview;
    if (!preview) throw new Error('Expected a committed visual preview');
    state.visualPreview = { ...preview, revisionId: 'replacement-preview' };
    imageDecode.resolve(fakeImageBitmap());
    await flushPromises();

    expect(state.images.has('images/cover.png')).toBe(true);
    expect(invalidated).toEqual([2]);
  });

  it('does not invalidate a disposed reader when preview image decode settles', async () => {
    const imageDecode = createDeferred<ImageBitmap>();
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => imageDecode.promise),
    );
    const { worker } = createWorker(() => undefined);
    const state = previewState(worker);
    const invalidated = collectInvalidatedSpreads(state);

    await commitResourceVisualPreview(
      state,
      worker,
      resourceRevisionResult('disposed-preview', false),
    );
    state.disposed = true;
    imageDecode.resolve({ close } as unknown as ImageBitmap);
    await flushPromises();

    expect(close).toHaveBeenCalledOnce();
    expect(state.images.has('images/cover.png')).toBe(false);
    expect(invalidated).toEqual([2]);
  });

  it('keeps image-dominated preview commits blocked on selected image decode', async () => {
    const imageDecode = createDeferred<ImageBitmap>();
    const bitmap = fakeImageBitmap();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => imageDecode.promise),
    );
    const { worker } = createWorker(() => undefined);
    const state = previewState(worker);
    const invalidated = collectInvalidatedSpreads(state);
    const commit = commitResourceVisualPreview(
      state,
      worker,
      resourceRevisionResult('image-preview', true),
    );

    await flushPromises();
    expect(state.visualPreview).toBeUndefined();
    expect(invalidated).toEqual([]);

    imageDecode.resolve(bitmap);
    await expect(commit).resolves.toBe(true);
    await flushPromises();

    expect(state.images.get('images/cover.png')).toBe(bitmap);
    expect(state.visualPreview?.revisionId).toBe('image-preview');
    expect(invalidated).toEqual([2]);
  });

  it('isolates mixed-preview image decode failures from the committed preview', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('decode failed'))),
    );
    const { worker } = createWorker(() => undefined);
    const state = previewState(worker);
    const invalidated = collectInvalidatedSpreads(state);

    await expect(
      commitResourceVisualPreview(state, worker, resourceRevisionResult('broken-preview', false)),
    ).resolves.toBe(true);
    await flushPromises();

    expect(state.visualPreview?.revisionId).toBe('broken-preview');
    expect(state.images.has('images/cover.png')).toBe(false);
    expect(invalidated).toEqual([2]);
  });
});

function previewState(worker: BrowserReaderWorkerClient): BrowserReaderState {
  const state = createState(worker);
  state.activeSpreadIndex = 2;
  return state;
}

function commitResourceVisualPreview(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
) {
  return commitBrowserReaderViewResult(
    state,
    {
      config: state.config,
      spreadMode: 'single',
      lineBreaking: 'greedy',
      token: state.reflow.token,
    },
    worker,
    result,
    true,
  );
}

function resourceRevisionResult(
  revisionId: string,
  imageDominated: boolean,
): BrowserReaderRevisionResult {
  const base = revisionResult(revisionId, 1, 1, 2);
  const selectedFrame = base.selectedFrame;
  const frameWindow = base.frameWindow;
  if (!selectedFrame || !frameWindow) throw new Error('Expected a selected frame fixture');
  const frame = {
    ...selectedFrame.frame,
    metadata: {
      ...selectedFrame.frame.metadata,
      imageDominated,
      resourceRefCount: 1,
      resourceTable: ['images/cover.png'],
    },
  };
  return {
    ...base,
    selectedFrame: { ...selectedFrame, frame },
    frameWindow: {
      ...frameWindow,
      frames: [frame],
      spreads: [{ spreadIndex: 0, resources: [imageResource(revisionId)] }],
    },
  };
}

function imageResource(revisionId: string) {
  return {
    payload: {
      revisionId,
      transferId: `transfer-${revisionId}`,
      kind: 'image' as const,
      href: 'images/cover.png',
      mediaType: 'image/png',
      byteLength: 4,
    },
    bytes: new Uint8Array([1, 2, 3, 4]),
  };
}

function collectInvalidatedSpreads(state: BrowserReaderState): number[] {
  const invalidated: number[] = [];
  state.spreadContentInvalidatedListeners.add((spreadIndex) => invalidated.push(spreadIndex));
  return invalidated;
}

function fakeImageBitmap(): ImageBitmap {
  return { close: vi.fn() } as unknown as ImageBitmap;
}
