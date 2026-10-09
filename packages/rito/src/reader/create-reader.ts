import type { Reader, ReaderOptions, ReaderPublication } from './instance';
export async function createReader(
  data: ReaderPublication,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  const binding = await import('../bindings/browser/session-reader/reader');
  return binding.createReader(data, canvas, options);
}
/** Loads the reader's code ahead of the first book, so opening one does not wait for it. */
export async function preloadReaderRuntime(): Promise<void> {
  await import('../bindings/browser/session-reader/reader');
}
