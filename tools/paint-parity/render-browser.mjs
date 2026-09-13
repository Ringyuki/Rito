// Renders every paint-parity fixture through the browser blitter (the
// oracle) into out/browser/<name>.png: the engine's lowered `RITODL1`
// bytes for the fixture (written by rito-core's
// lower_paint_parity_fixtures into out/lowered/) decoded by the
// production decoder and blitted by the production primitive renderer.
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

const outRoot = process.argv[2] ?? path.join(HERE, 'out');
const browserDir = path.join(outRoot, 'browser');
const bundleDir = path.join(outRoot, 'harness-bundle');
const loweredDir = path.join(outRoot, 'lowered');
if (!existsSync(loweredDir)) {
  throw new Error(`no lowered fixtures at ${loweredDir}; run the engine lowering first`);
}
mkdirSync(browserDir, { recursive: true });

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

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  });
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: path.join(bundleDir, 'harness.js') });

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

  const lowered = readdirSync(loweredDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of lowered) {
    const meta = JSON.parse(readFileSync(path.join(loweredDir, file), 'utf8'));
    const bytes = readFileSync(path.join(loweredDir, `${meta.name}.ritodl`)).toString('base64');
    const dataUrl = await page.evaluate(
      ([m, b]) => window.__renderLoweredFixture(m, b),
      [meta, bytes],
    );
    const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    writeFileSync(path.join(browserDir, `${meta.name}.png`), png);
    console.log(`browser ${meta.name} ${png.length}B`);
  }
} finally {
  await browser.close();
}
