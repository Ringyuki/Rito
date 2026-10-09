import type { Reader, ReaderOptions, ReaderPublication } from './instance';
export async function createReader(
  data: ReaderPublication,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  // Migration switch: the reader built on the session protocol is chosen
  // by a page-level flag until it replaces the one below.
  if ((globalThis as { __ritoSessionReader?: boolean }).__ritoSessionReader === true) {
    const session = await import('../bindings/browser/session-reader/reader');
    return session.createReader(data, canvas, options);
  }
  const binding = await import('../bindings/browser/reader/reader');
  return binding.createReader(data, canvas, options);
}
export async function preloadReaderRuntime(): Promise<void> {
  const binding = await import('../bindings/browser/reader/reader');
  await binding.preloadReaderRuntime();
}
