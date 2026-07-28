// Renders every paint-parity fixture through the calibrated browser
// painter (the oracle) into out/browser/<name>.png.
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
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const requireRepo = createRequire(`${REPO}package.json`);
const { chromium } = requireRepo('@playwright/test');
const vite = await import(pathToFileURL(requireRepo.resolve('vite')));

const outRoot = process.argv[2] ?? path.join(HERE, 'out');
const browserDir = path.join(outRoot, 'browser');
const bundleDir = path.join(outRoot, 'harness-bundle');
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

const fixtureDir = path.join(HERE, 'fixtures');
const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(fixtureDir, f), 'utf8')));

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

  for (const fixture of fixtures) {
    const dataUrl = await page.evaluate((f) => window.__renderParityFixture(f), fixture);
    const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    writeFileSync(path.join(browserDir, `${fixture.name}.png`), png);
    console.log(`browser ${fixture.name} ${png.length}B`);
  }
} finally {
  await browser.close();
}
