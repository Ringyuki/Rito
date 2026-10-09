import { describe, expect, it, vi } from 'vitest';

const binding = vi.hoisted(() => ({
  createReader: vi.fn(() => Promise.resolve({ session: true })),
}));
vi.mock('../../src/bindings/browser/session-reader/reader', () => binding);

import { createReader, preloadReaderRuntime } from '../../src/reader/create-reader';

describe('root reader facade', () => {
  it('opens a book on the session reader', async () => {
    const data = new ArrayBuffer(0);
    const canvas = {} as HTMLCanvasElement;
    const options = { width: 1, height: 1 } as never;
    const reader = await createReader(data, canvas, options);
    expect(reader).toEqual({ session: true });
    expect(binding.createReader).toHaveBeenCalledWith(data, canvas, options);
  });

  it('loads the reader ahead of a book without opening one', async () => {
    await preloadReaderRuntime();
    expect(binding.createReader).toHaveBeenCalledOnce();
  });
});
