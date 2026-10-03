import { describe, expect, it, vi } from 'vitest';
import type { ReaderHostFontFace } from '../../src/reader';
import { catchUpBrowserReaderHostFontChanges } from '../../src/bindings/browser/host-font-faces';
import { disposeBrowserReaderSessionHosts } from '../../src/bindings/browser/reader-session-host';
import {
  parkBrowserReaderStandbyWorker,
  takeBrowserReaderStandbyWorker,
} from '../../src/bindings/browser/revision-session-owner';
import { createState, createWorker } from './browser-reader-reflow-fixtures';

const face = (sha: string): ReaderHostFontFace => ({
  bytes: new ArrayBuffer(4),
  expectedSha256: sha,
  genericRole: 'serif',
});

describe('Browser reader standby session', () => {
  it('brings a kept session up to date with only the changes it has not applied', async () => {
    const current = createWorker(() => undefined);
    const kept = createWorker(() => undefined);
    const state = createState(current.worker);
    state.dpr = 2;
    const setRenderRatio = vi.fn(() => Promise.resolve());
    const addHostFontFaces = vi.fn(() => Promise.resolve(state.pinnedFonts.summary));
    const removeHostFontFaces = vi.fn(() => Promise.resolve(state.pinnedFonts.summary));
    Object.assign(kept.worker, { setRenderRatio, addHostFontFaces, removeHostFontFaces });
    state.pinnedFonts.changes.push({ kind: 'add', faces: [face('a')] });
    // The kept session applied the first change while it was laid out on.
    await catchUpBrowserReaderHostFontChanges(kept.worker, state.pinnedFonts.changes);
    state.pinnedFonts.changes.push({ kind: 'remove', sha256s: ['a'] });

    await parkBrowserReaderStandbyWorker(state, kept.worker);
    const taken = await takeBrowserReaderStandbyWorker(state);

    expect(taken).toBe(kept.worker);
    expect(state.revisionSessions.standby).toBeUndefined();
    expect(setRenderRatio).toHaveBeenCalledWith(2);
    expect(addHostFontFaces).toHaveBeenCalledOnce();
    expect(removeHostFontFaces).toHaveBeenCalledWith(['a']);
    expect(kept.dispose).not.toHaveBeenCalled();
  });

  it('drops a kept session it cannot bring up to date, so the layout opens a new one', async () => {
    const current = createWorker(() => undefined);
    const kept = createWorker(() => undefined);
    const state = createState(current.worker);
    const setRenderRatio = vi.fn(() => Promise.reject(new Error('session gone')));
    Object.assign(kept.worker, { setRenderRatio });

    await parkBrowserReaderStandbyWorker(state, kept.worker);
    await expect(takeBrowserReaderStandbyWorker(state)).resolves.toBeUndefined();

    expect(kept.dispose).toHaveBeenCalledOnce();
    expect(state.logger.warn).toHaveBeenCalledWith(
      'reader standby session could not be brought up to date',
      expect.any(Error),
    );
  });

  it('keeps one session, the newest, and none once the reader released its sessions', async () => {
    const current = createWorker(() => undefined);
    const older = createWorker(() => undefined);
    const newer = createWorker(() => undefined);
    const late = createWorker(() => undefined);
    const state = createState(current.worker);

    await parkBrowserReaderStandbyWorker(state, older.worker);
    await parkBrowserReaderStandbyWorker(state, newer.worker);
    expect(older.dispose).toHaveBeenCalledOnce();
    expect(state.revisionSessions.standby).toBe(newer.worker);

    disposeBrowserReaderSessionHosts(state);
    expect(state.revisionSessions.standby).toBeUndefined();
    await parkBrowserReaderStandbyWorker(state, late.worker);
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(state.revisionSessions.standby).toBeUndefined();
  });
});
