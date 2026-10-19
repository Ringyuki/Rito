let onGpu: boolean | undefined;

/**
 * Whether WebGL runs on the GPU here. On a software rasterizer the canvas
 * and the page blend text into the pixels beneath with their own integer
 * arithmetic, which a WebGL blend does not reproduce, so there the GPU pen
 * paints every primitive through the canvas pen and only copies it in.
 */
export function webglOnGpu(): boolean {
  if (onGpu === undefined) {
    const probe = new OffscreenCanvas(1, 1).getContext('webgl2', {
      failIfMajorPerformanceCaveat: true,
    });
    onGpu = probe !== null;
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return onGpu;
}

let chromium: boolean | undefined;

/**
 * Whether the canvas here rasterizes text the way the GPU pen reproduces
 * it. The pen places each glyph by laws measured on Chromium's canvas
 * (quarter-pixel phases, advances within a joined cluster); WebKit's and
 * Gecko's canvases place some glyphs otherwise (measured: up to 128 levels
 * apart on more than half of a book's sampled spreads), so there the canvas
 * pen paints every list and the GPU only copies it in.
 */
export function canvasTextMatchesGpuPen(): boolean {
  chromium ??=
    (
      globalThis.navigator as
        | { userAgentData?: { brands?: readonly { brand: string }[] } }
        | undefined
    )?.userAgentData?.brands?.some((entry) => entry.brand === 'Chromium') ?? false;
  return chromium;
}
