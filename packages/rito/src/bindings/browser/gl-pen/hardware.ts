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
