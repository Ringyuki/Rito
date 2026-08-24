import { describe, expect, it } from 'vitest';

/**
 * Integration test scaffold.
 * Validates that the public API surface exports the expected symbols.
 */
describe('public API surface', () => {
  it('exports the Rust-backed reader facade from the main entry', async () => {
    const api = await import('../../src/index');
    expect(api.createReader).toBeDefined();
    expect(api.createLayoutConfig).toBeDefined();
    expect(api.preloadReaderRuntime).toBeDefined();
  });

  it('keeps the controller-integration oracle in the reference core', async () => {
    const integration = await import('../../src/reference/ts-core/interaction');
    expect(integration.buildHitMap).toBeDefined();
    expect(integration.buildLinkMap).toBeDefined();
    expect(integration.getSelectionRects).toBeDefined();
    expect(integration.hitTestLink).toBeDefined();
  });

  it('does not export internal APIs from main entry', async () => {
    const api = await import('../../src/index');
    // Parser internals are reference-only during the Rust migration.
    expect((api as Record<string, unknown>)['NODE_TYPES']).toBeUndefined();
    expect((api as Record<string, unknown>)['parseXhtml']).toBeUndefined();
    expect((api as Record<string, unknown>)['createZipReader']).toBeUndefined();
    // Style internals are reference-only during the Rust migration.
    expect((api as Record<string, unknown>)['DEFAULT_STYLE']).toBeUndefined();
    expect((api as Record<string, unknown>)['resolveStyles']).toBeUndefined();
    expect((api as Record<string, unknown>)['parseCssDeclarations']).toBeUndefined();
    // Layout internals are reference-only during the Rust migration.
    expect((api as Record<string, unknown>)['layoutBlocks']).toBeUndefined();
    expect((api as Record<string, unknown>)['paginateBlocks']).toBeUndefined();
    // Advanced runtime / render helpers should be kept off the main entry
    expect((api as Record<string, unknown>)['paginateWithMeta']).toBeUndefined();
    expect((api as Record<string, unknown>)['findPageForTocEntry']).toBeUndefined();
    expect((api as Record<string, unknown>)['loadFonts']).toBeUndefined();
    expect((api as Record<string, unknown>)['loadImages']).toBeUndefined();
    expect((api as Record<string, unknown>)['loadAssets']).toBeUndefined();
    expect((api as Record<string, unknown>)['prepare']).toBeUndefined();
    expect((api as Record<string, unknown>)['disposeResources']).toBeUndefined();
    expect((api as Record<string, unknown>)['render']).toBeUndefined();
    expect((api as Record<string, unknown>)['renderPage']).toBeUndefined();
    expect((api as Record<string, unknown>)['createTextMeasurer']).toBeUndefined();
    expect((api as Record<string, unknown>)['getSpreadDimensions']).toBeUndefined();
    expect((api as Record<string, unknown>)['paginateWithAssets']).toBeUndefined();
    expect((api as Record<string, unknown>)['disposeAssets']).toBeUndefined();
    expect((api as Record<string, unknown>)['createLazyImageLoader']).toBeUndefined();
    expect((api as Record<string, unknown>)['canvasDisplayListRenderer']).toBeUndefined();
    expect((api as Record<string, unknown>)['canvasTextMeasurementBackend']).toBeUndefined();
    expect((api as Record<string, unknown>)['paginateInWorker']).toBeUndefined();
    expect((api as Record<string, unknown>)['createRustWorkerClient']).toBeUndefined();
    expect((api as Record<string, unknown>)['createBrowserRustWorkerClient']).toBeUndefined();
    expect((api as Record<string, unknown>)['createInProcessRustWorkerClient']).toBeUndefined();
    expect((api as Record<string, unknown>)['createLogger']).toBeUndefined();
  });

  it('does not keep legacy TypeScript compatibility subpaths in package exports', async () => {
    const packageJson = await import('../../package.json');
    const exportsMap = packageJson.default.exports as Record<string, unknown>;
    expect(Object.keys(exportsMap).sort()).toEqual(['.', './package.json']);
  });
});
