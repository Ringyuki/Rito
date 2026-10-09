import { describe, expect, it, vi } from 'vitest';

const binding = vi.hoisted(() => ({
  createReader: vi.fn(() => Promise.resolve({ facade: true })),
  preloadReaderRuntime: vi.fn(() => Promise.resolve()),
}));
const session = vi.hoisted(() => ({
  createReader: vi.fn(() => Promise.resolve({ session: true })),
}));
vi.mock('../../src/bindings/browser/reader/reader', () => binding);
vi.mock('../../src/bindings/browser/session-reader/reader', () => session);

import { createReader, preloadReaderRuntime } from '../../src/reader/create-reader';

describe('root reader facade', () => {
  it('opens a book on the session reader', async () => {
    const data = new ArrayBuffer(0);
    const canvas = {} as HTMLCanvasElement;
    const options = { width: 1, height: 1 } as never;
    const reader = await createReader(data, canvas, options);
    expect(reader).toEqual({ session: true });
    expect(session.createReader).toHaveBeenCalledWith(data, canvas, options);
    expect(binding.createReader).not.toHaveBeenCalled();
  });

  it('opens a book on the revision reader for a page that asks for it', async () => {
    const page = globalThis as { __ritoSessionReader?: boolean };
    page.__ritoSessionReader = false;
    try {
      const data = new ArrayBuffer(0);
      const canvas = {} as HTMLCanvasElement;
      const options = { width: 1, height: 1 } as never;
      expect(await createReader(data, canvas, options)).toEqual({ facade: true });
      expect(binding.createReader).toHaveBeenCalledWith(data, canvas, options);
    } finally {
      delete page.__ritoSessionReader;
    }
  });

  it('forwards preloadReaderRuntime to the browser binding', async () => {
    await preloadReaderRuntime();
    expect(binding.preloadReaderRuntime).toHaveBeenCalledOnce();
  });
});
