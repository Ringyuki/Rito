import { describe, expect, it } from 'vitest';

/**
 * Integration test scaffold.
 * Validates that the public API surface exports the expected symbols.
 */
describe('public API surface', () => {
  it('exports essential functions', async () => {
    const api = await import('../../src/index');
    expect(api.loadEpub).toBeDefined();
    expect(api.prepare).toBeDefined();
    expect(api.disposeResources).toBeDefined();
    expect(api.render).toBeDefined();
    expect(api.paginate).toBeDefined();
    expect(api.buildSpreads).toBeDefined();
    expect(api.createLayoutConfig).toBeDefined();
    expect(api.createTextMeasurer).toBeDefined();
    expect(api.getSpreadDimensions).toBeDefined();
  });

  it('does not export internal APIs from main entry', async () => {
    const api = await import('../../src/index');
    // Parser internals should be in @rito/core/advanced
    expect((api as Record<string, unknown>)['NODE_TYPES']).toBeUndefined();
    expect((api as Record<string, unknown>)['parseXhtml']).toBeUndefined();
    expect((api as Record<string, unknown>)['createZipReader']).toBeUndefined();
    // Style internals should be in @rito/core/advanced
    expect((api as Record<string, unknown>)['DEFAULT_STYLE']).toBeUndefined();
    expect((api as Record<string, unknown>)['resolveStyles']).toBeUndefined();
    expect((api as Record<string, unknown>)['parseCssDeclarations']).toBeUndefined();
    // Layout internals should be in @rito/core/advanced
    expect((api as Record<string, unknown>)['layoutBlocks']).toBeUndefined();
    expect((api as Record<string, unknown>)['paginateBlocks']).toBeUndefined();
    // Advanced runtime / render helpers should be kept off the main entry
    expect((api as Record<string, unknown>)['paginateWithMeta']).toBeUndefined();
    expect((api as Record<string, unknown>)['findPageForTocEntry']).toBeUndefined();
    expect((api as Record<string, unknown>)['loadFonts']).toBeUndefined();
    expect((api as Record<string, unknown>)['loadImages']).toBeUndefined();
    expect((api as Record<string, unknown>)['loadAssets']).toBeUndefined();
    expect((api as Record<string, unknown>)['paginateWithAssets']).toBeUndefined();
    expect((api as Record<string, unknown>)['disposeAssets']).toBeUndefined();
    expect((api as Record<string, unknown>)['createLazyImageLoader']).toBeUndefined();
    expect((api as Record<string, unknown>)['paginateInWorker']).toBeUndefined();
    expect((api as Record<string, unknown>)['createLogger']).toBeUndefined();
  });

  it('exports internal APIs from advanced entry', async () => {
    const adv = await import('../../src/advanced');
    expect(adv.NODE_TYPES).toBeDefined();
    expect(adv.DEFAULT_STYLE).toBeDefined();
    expect(adv.FONT_WEIGHTS).toBeDefined();
    expect(adv.FONT_STYLES).toBeDefined();
    expect(adv.TEXT_ALIGNMENTS).toBeDefined();
    expect(adv.parseXhtml).toBeDefined();
    expect(adv.resolveStyles).toBeDefined();
    expect(adv.layoutBlocks).toBeDefined();
    expect(adv.paginateBlocks).toBeDefined();
    expect(adv.createZipReader).toBeDefined();
    expect(adv.paginateWithMeta).toBeDefined();
    expect(adv.findPageForTocEntry).toBeDefined();
    expect(adv.loadFonts).toBeDefined();
    expect(adv.loadImages).toBeDefined();
    expect(adv.loadAssets).toBeDefined();
    expect(adv.paginateWithAssets).toBeDefined();
    expect(adv.disposeAssets).toBeDefined();
    expect(adv.createLazyImageLoader).toBeDefined();
    expect(adv.createLogger).toBeDefined();
  });
});
