import { describe, expect, it } from 'vitest';
import { rendersInSoftware } from '../../src/bindings/browser/gl-pen/hardware';

const UNMASKED_RENDERER_WEBGL = 0x9246;
const RENDERER = 0x1f01;

/** A context naming `renderer`, behind the debug extension or, without it, as its own. */
function contextNaming(renderer: string, debugInfo = true): WebGL2RenderingContext {
  return {
    RENDERER,
    getExtension: (name: string) =>
      name === 'WEBGL_debug_renderer_info' && debugInfo ? { UNMASKED_RENDERER_WEBGL } : null,
    getParameter: (parameter: number) =>
      parameter === (debugInfo ? UNMASKED_RENDERER_WEBGL : RENDERER) ? renderer : 'WebKit WebGL',
  } as unknown as WebGL2RenderingContext;
}

describe('whether WebGL draws on a GPU', () => {
  it('takes a software rasterizer the caveat let through for none', () => {
    // As Chromium names SwiftShader on a machine with no GPU.
    const swiftShader =
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)';
    expect(rendersInSoftware(contextNaming(swiftShader))).toBe(true);
    expect(rendersInSoftware(contextNaming('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe(true);
    expect(rendersInSoftware(contextNaming('Microsoft Basic Render Driver', false))).toBe(true);
  });

  it('takes a GPU the renderer names for one', () => {
    const metal = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)';
    expect(rendersInSoftware(contextNaming(metal))).toBe(false);
    expect(rendersInSoftware(contextNaming('NVIDIA GeForce RTX 4070/PCIe/SSE2', false))).toBe(
      false,
    );
  });
});
