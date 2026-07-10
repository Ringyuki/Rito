import type { Reader, ReaderOptions } from './types';
export async function createReader(
  data: ArrayBuffer,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  const binding = await import('../bindings/browser/reader/reader');
  return binding.createReader(data, canvas, options);
}
export async function preloadReaderRuntime(): Promise<void> {
  const binding = await import('../bindings/browser/reader/reader');
  await binding.preloadReaderRuntime();
}
