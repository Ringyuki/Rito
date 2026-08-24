import { describe, expect, it, vi } from 'vitest';

const binding = vi.hoisted(() => ({
  createReader: vi.fn(() => Promise.resolve({ facade: true })),
  preloadReaderRuntime: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../src/bindings/browser/reader/reader', () => binding);

import { createReader, preloadReaderRuntime } from '../../src/reader/create-reader';

describe('root reader facade', () => {
  it('forwards createReader to the browser binding', async () => {
    const data = new ArrayBuffer(0);
    const canvas = {} as HTMLCanvasElement;
    const options = { width: 1, height: 1 } as never;
    const reader = await createReader(data, canvas, options);
    expect(reader).toEqual({ facade: true });
    expect(binding.createReader).toHaveBeenCalledWith(data, canvas, options);
  });

  it('forwards preloadReaderRuntime to the browser binding', async () => {
    await preloadReaderRuntime();
    expect(binding.preloadReaderRuntime).toHaveBeenCalledOnce();
  });
});
