// Renders every paint-parity fixture through the browser blitter (the
// oracle) into out/browser/<name>.png: the engine's lowered `RITODL1`
// bytes for the fixture (written by rito-core's
// lower_paint_parity_fixtures into out/lowered/) decoded by the
// production decoder and blitted by the production primitive renderer;
// the same bytes through the canvas pen on an OffscreenCanvas (the canvas
// a reader's pages are painted on) into out/browser-offscreen/ and through
// the GPU pen into out/browser-gl-software/; and those two again in
// Chromium on the machine's GPU into out/browser-gpu/ and out/browser-gl/.
//
//   node tools/paint-parity/render-browser.mjs [outRoot]
//
// Bundles harness/entry.ts with vite's build API, boots headless
// Chromium at deviceScaleFactor 1 (the pixel-court calibration point),
// registers the shared pinned fonts, and asserts the faces actually
// loaded before painting — an unloaded face silently falls back and
// invalidates every text fixture.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const requireRepo = createRequire(`${REPO}package.json`);
const { chromium } = requireRepo('@playwright/test');
const vite = await import(pathToFileURL(requireRepo.resolve('vite')));
const { launchUnthrottled } = await import('../resize-frames/shared.mjs');

const outRoot = process.argv[2] ?? path.join(HERE, 'out');
const bundleDir = path.join(outRoot, 'harness-bundle');
const loweredDir = path.join(outRoot, 'lowered');
if (!existsSync(loweredDir)) {
  throw new Error(`no lowered fixtures at ${loweredDir}; run the engine lowering first`);
}

await vite.build({
  configFile: false,
  logLevel: 'error',
  build: {
    lib: {
      entry: path.join(HERE, 'harness/entry.ts'),
      formats: ['iife'],
      name: 'RitoPaintParityHarness',
      fileName: () => 'harness.js',
    },
    outDir: bundleDir,
    emptyOutDir: true,
    minify: false,
  },
});

const FONTS = [
  { family: 'Tinos', file: 'apps/reader/src/assets/fonts/Tinos-Regular.ttf' },
  {
    family: 'Source Han Serif CN',
    file: 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf',
  },
];

// The headless default rasterizes in software (the oracle, and the GPU
// pen where WebGL has no GPU); the GPU pass is a reader's browser, where
// the GPU pen draws text and fills itself and is held to that browser's
// canvas pen.
await renderPass(await chromium.launch(), {
  flat: 'browser',
  offscreen: 'browser-offscreen',
  gpu: 'browser-gl-software',
});
await renderPass(await launchUnthrottled(), {
  offscreen: 'browser-gpu',
  gpu: 'browser-gl',
});

async function renderPass(browser, dirs) {
  for (const dir of Object.values(dirs)) mkdirSync(path.join(outRoot, dir), { recursive: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
    });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: path.join(bundleDir, 'harness.js') });
    await loadFonts(page);
    const lowered = readdirSync(loweredDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const file of lowered) {
      const meta = JSON.parse(readFileSync(path.join(loweredDir, file), 'utf8'));
      const bytes = readFileSync(path.join(loweredDir, `${meta.name}.ritodl`)).toString('base64');
      const renders = {
        flat: () => page.evaluate(([m, b]) => window.__renderLoweredFixture(m, b), [meta, bytes]),
        offscreen: () =>
          page.evaluate(([m, b]) => window.__renderLoweredFixtureOffscreen(m, b), [meta, bytes]),
        gpu: () => page.evaluate(([m, b]) => window.__renderLoweredFixtureGl(m, b), [meta, bytes]),
      };
      for (const [kind, dir] of Object.entries(dirs)) {
        writeFileSync(path.join(outRoot, dir, `${meta.name}.png`), pngOf(await renders[kind]()));
      }
      console.log(`${Object.values(dirs).join(' / ')} ${meta.name}`);
    }
  } finally {
    await browser.close();
  }
}

function pngOf(dataUrl) {
  return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
}

async function loadFonts(page) {
  for (const font of FONTS) {
    const bytes = readFileSync(path.join(REPO, font.file)).toString('base64');
    const loaded = await page.evaluate(
      async ([family, base64]) => {
        const raw = atob(base64);
        const buffer = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) buffer[i] = raw.charCodeAt(i);
        const face = new FontFace(family, buffer.buffer);
        await face.load();
        document.fonts.add(face);
        return document.fonts.check(`16px "${family}"`);
      },
      [font.family, bytes],
    );
    if (!loaded) throw new Error(`font failed to load: ${font.family}`);
  }
}
