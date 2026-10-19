import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function matchesWith(navigator: unknown): Promise<boolean> {
  vi.resetModules();
  vi.stubGlobal('navigator', navigator);
  const { canvasTextMatchesGpuPen } = await import('../../src/bindings/browser/gl-pen/hardware');
  return canvasTextMatchesGpuPen();
}

describe('where the GPU pen paints text', () => {
  it("paints on Chromium's canvas, whose glyph placement it reproduces", async () => {
    const brands = [{ brand: 'Not.A/Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }];
    expect(await matchesWith({ userAgentData: { brands } })).toBe(true);
  });

  it('leaves WebKit and Gecko canvases, which expose no Chromium brand, to the canvas pen', async () => {
    expect(await matchesWith({ userAgent: 'Safari' })).toBe(false);
    expect(await matchesWith({ userAgentData: { brands: [{ brand: 'Firefox' }] } })).toBe(false);
    expect(await matchesWith(undefined)).toBe(false);
  });
});
