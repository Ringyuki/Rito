#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { unzipSync } from 'fflate';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');
const DIST_ROOT = resolve(PACKAGE_ROOT, 'dist');
const REFERENCE_DIST_ROOT = resolve(PACKAGE_ROOT, '.output/reference-build');
const CORE_WASM_DIST_ROOT = resolve(PACKAGE_ROOT, '../rito-core-wasm/dist');
const CASE_ROOT = resolve(PACKAGE_ROOT, 'test-results/render-diagnostics/cases');
const require = createRequire(import.meta.url);
const FFLATE_ROOT = dirname(dirname(require.resolve('fflate/browser')));
const FFLATE_BROWSER_PATH = resolve(FFLATE_ROOT, 'esm/browser.js');
const CSS_LINE_BREAK_PATH = require.resolve('css-line-break/dist/css-line-break.es5.js');
const COMPARISON_THRESHOLD = 0.1;
const ENGINE_CONFIGS = new Map([
  ['production', { id: 'production', label: 'Rust production', importPath: '/dist/index.mjs' }],
  [
    'reference',
    {
      id: 'reference',
      label: 'TypeScript reference',
      importPath: '/reference-dist/tooling/web.mjs',
    },
  ],
]);

const PROFILES = new Map([
  [
    'single-default',
    { id: 'single-default', width: 600, height: 800, margin: 40, spread: 'single', spreadGap: 0 },
  ],
  [
    'single-narrow',
    { id: 'single-narrow', width: 360, height: 640, margin: 28, spread: 'single', spreadGap: 0 },
  ],
  [
    'single-wide',
    { id: 'single-wide', width: 900, height: 1200, margin: 64, spread: 'single', spreadGap: 0 },
  ],
  [
    'double-default',
    { id: 'double-default', width: 1200, height: 800, margin: 40, spread: 'double', spreadGap: 32 },
  ],
]);

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}

async function run() {
  const caseId = process.env.RITO_DIAG_CASE;
  if (!caseId) throw new Error('Set RITO_DIAG_CASE=<case-id>');

  const caseDir = resolve(CASE_ROOT, caseId);
  assertInside(CASE_ROOT, caseDir);

  const artifactsDir = resolve(caseDir, 'artifacts');
  const browserDir = resolve(artifactsDir, 'browser');
  const comparisonDir = resolve(artifactsDir, 'comparison');
  const parityDir = resolve(artifactsDir, 'parity');
  const extractedDir = resolve(browserDir, 'extracted');
  const caseConfig = await readCaseConfig(resolve(caseDir, 'case.json'));
  const bookPath = process.env.RITO_DIAG_EPUB
    ? resolve(process.env.RITO_DIAG_EPUB)
    : resolve(caseDir, 'book.epub');
  const bookBytes = await readFile(bookPath);
  const profile = resolveProfile(caseConfig);
  const lineBreaking = resolveLineBreaking(caseConfig);
  const spreadIndex = resolveSpreadIndex(caseConfig);
  const engines = resolveDiagnosticEngines();

  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(browserDir, { recursive: true });
  await extractEpub(bookBytes, extractedDir);
  const referenceContext = await resolveReferenceContext(extractedDir);

  const server = await startDiagnosticServer(extractedDir);
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL }
      : {}),
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.devicePixelRatio,
    });
    const engineResults = {};
    for (const engine of engines) {
      const engineDir = resolve(artifactsDir, engine.id);
      const result = await renderRitoSpread(page, server.origin, {
        engine,
        bookBytes,
        profile,
        lineBreaking,
        spreadIndex,
      });
      engineResults[engine.id] = await writeEngineArtifacts(engineDir, {
        caseId,
        bookPath,
        profile,
        lineBreaking,
        spreadIndex,
        engine,
        result,
      });
    }

    const reference = await captureBrowserReference(
      page,
      server.origin,
      caseConfig,
      browserDir,
      profile,
      referenceContext,
    );
    const primaryEngine = engineResults.production || Object.values(engineResults)[0];
    if (!primaryEngine) throw new Error('No diagnostic engine rendered');
    const comparison = await writeComparisonArtifacts(comparisonDir, artifactsDir, {
      caseId,
      profile,
      lineBreaking,
      spreadIndex,
      actualPng: primaryEngine.png,
      actualLabel: primaryEngine.engine.label,
      actualSummaryPath: `${primaryEngine.engine.id}/summary.json`,
      actualPageDetailPath: `${primaryEngine.engine.id}/page-detail.json`,
      reference,
    });
    const parity =
      engineResults.production && engineResults.reference
        ? await writeParityArtifacts(parityDir, artifactsDir, {
            caseId,
            profile,
            lineBreaking,
            spreadIndex,
            production: engineResults.production,
            reference: engineResults.reference,
          })
        : { skipped: 'Set RITO_DIAG_ENGINE=both to compare production and reference readers' };
    await writeJson(resolve(artifactsDir, 'report.json'), {
      caseId,
      engines: Object.fromEntries(
        Object.keys(engineResults).map((id) => [
          id,
          {
            actual: `${id}/actual.png`,
            diagnostics: `${id}/diagnostics.json`,
            pageDetail: `${id}/page-detail.json`,
            summary: `${id}/summary.json`,
            frameSummary: `${id}/frame-summary.json`,
          },
        ]),
      ),
      browser: reference,
      comparison,
      parity,
    });
    console.log(`Rendering diagnostic artifacts: ${artifactsDir}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function renderRitoSpread(page, origin, input) {
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`page error: ${error.message}`));

  await page.goto(`${origin}/render.html`);
  await waitForRenderApi(page, diagnostics);

  const result = await page.evaluate(
    async ({ bookBase64, engine, lineBreaking, profile, spreadIndex }) => {
      return window.renderRitoDiagnostic({
        bookBase64,
        engine,
        lineBreaking,
        profile,
        spreadIndex,
      });
    },
    {
      bookBase64: input.bookBytes.toString('base64'),
      engine: input.engine.id,
      lineBreaking: input.lineBreaking,
      profile: input.profile,
      spreadIndex: input.spreadIndex,
    },
  );

  return {
    totalSpreads: result.totalSpreads,
    spread: result.spread,
    page: result.page,
    chapterMap: result.chapterMap,
    manifestHrefMap: result.manifestHrefMap,
    png: Buffer.from(result.pngBase64, 'base64'),
    diagnostics: { ...result.diagnostics, pageDiagnostics: diagnostics },
  };
}

async function writeEngineArtifacts(engineDir, input) {
  await mkdir(engineDir, { recursive: true });
  const pngHash = sha256(input.result.png);
  const summary = {
    caseId: input.caseId,
    bookPath: input.bookPath,
    engine: input.engine,
    profile: input.profile,
    lineBreaking: input.lineBreaking,
    spreadIndex: input.spreadIndex,
    totalSpreads: input.result.totalSpreads,
    spread: input.result.spread,
    chapterMap: input.result.chapterMap,
    manifestHrefMap: input.result.manifestHrefMap,
    png: {
      sha256: pngHash,
      byteLength: input.result.png.byteLength,
    },
  };
  const frameSummary = {
    engine: input.engine.id,
    profile: input.profile.id,
    lineBreaking: input.lineBreaking,
    spreadIndex: input.spreadIndex,
    totalSpreads: input.result.totalSpreads,
    canvas: input.result.canvas,
    spread: input.result.spread,
    page: input.result.page,
    chapterMapHash: sha256Json(input.result.chapterMap),
    manifestHrefMapHash: sha256Json(input.result.manifestHrefMap),
    pngHash,
  };
  await writeFile(resolve(engineDir, 'actual.png'), input.result.png);
  await writeJson(resolve(engineDir, 'diagnostics.json'), input.result.diagnostics);
  await writeJson(resolve(engineDir, 'page-detail.json'), input.result.page);
  await writeJson(resolve(engineDir, 'summary.json'), summary);
  await writeJson(resolve(engineDir, 'frame-summary.json'), frameSummary);
  return {
    engine: input.engine,
    png: input.result.png,
    summary,
    frameSummary,
  };
}

async function captureBrowserReference(
  page,
  origin,
  caseConfig,
  browserDir,
  profile,
  referenceContext,
) {
  const location = readRecord(caseConfig.location);
  const chapterHref = readOptionalString(location?.chapterHref);
  if (!chapterHref) return { skipped: 'case.json location.chapterHref is not set' };
  if (profile.spread !== 'single') {
    throw new Error(
      `Browser XHTML reference capture requires a single-page profile; got ${profile.id}. ` +
        'Use double-default only for spread composition and page parity diagnosis.',
    );
  }

  await page.setViewportSize(browserReferenceViewport(profile));
  await page.goto(
    `${origin}/reference/${resolveReferenceDocumentHref(referenceContext, chapterHref)}`,
  );
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  });
  await applyBrowserReferencePageFrame(page, profile);

  const selector = readOptionalString(location?.selector);
  const text = readOptionalString(location?.text);
  await page.evaluate(
    ({ selector, text, margin }) => {
      const target = findReferenceTarget(selector, text);
      if (!target) return;
      const targetTop = Number(target.getBoundingClientRect().top) + window.scrollY;
      const marginPx = Number(margin);
      window.scrollTo({ left: 0, top: Math.max(0, targetTop - marginPx) });

      function findReferenceTarget(selector, text) {
        if (selector) return document.querySelector(selector);
        if (!text) return document.body;
        const candidates = Array.from(document.body.querySelectorAll('*')).filter(
          (element) => element.id !== '__rito_diag_page__' && element.textContent?.includes(text),
        );
        return (
          candidates.find(
            (element) =>
              !Array.from(element.children).some((child) => child.textContent?.includes(text)),
          ) ||
          candidates.at(-1) ||
          document.body
        );
      }
    },
    { selector, text, margin: profile.margin },
  );

  await page.screenshot({ path: resolve(browserDir, 'reference.png') });

  const facts = await page.evaluate(
    ({ selector, text }) => {
      const target = findReferenceTarget(selector, text);
      const elements = target ? [target, ...ancestorElements(target, 4)] : [];
      return {
        url: window.location.href,
        targetFound: Boolean(target),
        elements: elements.map((element) => elementFacts(element)),
        textMetrics: collectReferenceTextMetrics(text || target?.textContent?.trim() || ''),
        fonts: document.fonts
          ? Array.from(document.fonts).map((face) => ({
              family: face.family,
              status: face.status,
              weight: face.weight,
              style: face.style,
            }))
          : [],
      };

      function findReferenceTarget(selector, text) {
        if (selector) return document.querySelector(selector);
        if (!text) return document.body;
        const candidates = Array.from(document.body.querySelectorAll('*')).filter(
          (element) => element.id !== '__rito_diag_page__' && element.textContent?.includes(text),
        );
        return (
          candidates.find(
            (element) =>
              !Array.from(element.children).some((child) => child.textContent?.includes(text)),
          ) ||
          candidates.at(-1) ||
          document.body
        );
      }

      function ancestorElements(element, maxCount) {
        const ancestors = [];
        let current = element.parentElement;
        while (current && ancestors.length < maxCount) {
          ancestors.push(current);
          current = current.parentElement;
        }
        return ancestors;
      }

      function elementFacts(element) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tagName: element.tagName.toLowerCase(),
          id: element.id,
          className: element.getAttribute('class') || '',
          text: element.textContent?.trim().slice(0, 120) || '',
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
          },
          style: {
            display: style.display,
            position: style.position,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            marginTop: style.marginTop,
            marginRight: style.marginRight,
            marginBottom: style.marginBottom,
            marginLeft: style.marginLeft,
            paddingTop: style.paddingTop,
            paddingRight: style.paddingRight,
            paddingBottom: style.paddingBottom,
            paddingLeft: style.paddingLeft,
            textAlign: style.textAlign,
            textIndent: style.textIndent,
            color: style.color,
            transform: style.transform,
            writingMode: style.writingMode,
          },
        };
      }

      function collectReferenceTextMetrics(sample) {
        if (!sample) return [];
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return [];
        return ['16px serif', '16px sans-serif'].map((font) => {
          context.font = font;
          const metrics = context.measureText(sample);
          return {
            font,
            sample,
            width: metrics.width,
            actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
            actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
            fontBoundingBoxAscent: metrics.fontBoundingBoxAscent,
            fontBoundingBoxDescent: metrics.fontBoundingBoxDescent,
          };
        });
      }
    },
    {
      selector,
      text,
    },
  );

  await writeJson(resolve(browserDir, 'computed-style.json'), facts.elements);
  await writeJson(
    resolve(browserDir, 'dom-rects.json'),
    facts.elements.map((element) => ({
      tagName: element.tagName,
      id: element.id,
      className: element.className,
      text: element.text,
      rect: element.rect,
    })),
  );
  await writeJson(resolve(browserDir, 'text-metrics.json'), {
    fonts: facts.fonts,
    textMetrics: facts.textMetrics,
    targetFound: facts.targetFound,
    url: facts.url,
  });

  return {
    reference: 'browser/reference.png',
    computedStyle: 'browser/computed-style.json',
    domRects: 'browser/dom-rects.json',
    textMetrics: 'browser/text-metrics.json',
    viewport: browserReferenceViewport(profile),
    targetFound: facts.targetFound,
  };
}

function browserReferenceViewport(profile) {
  return { width: profile.width, height: profile.height };
}

async function writeComparisonArtifacts(comparisonDir, artifactsDir, input) {
  await mkdir(comparisonDir, { recursive: true });

  const referencePath = readOptionalString(input.reference.reference);
  if (!referencePath) {
    const skipped =
      readOptionalString(input.reference.skipped) || 'browser reference is unavailable';
    await writeComparisonReport(comparisonDir, input, { skipped });
    return {
      report: 'comparison/report.md',
      skipped,
    };
  }

  const referencePng = await readFile(resolve(artifactsDir, referencePath));
  const result = createPngDiff(referencePng, input.actualPng);
  if ('dimensionMismatch' in result) {
    await writeComparisonReport(comparisonDir, input, result);
    return {
      report: 'comparison/report.md',
      dimensionMismatch: result.dimensionMismatch,
    };
  }

  await writeFile(resolve(comparisonDir, 'diff.png'), result.diffPng);
  await writeComparisonReport(comparisonDir, input, result);
  return {
    report: 'comparison/report.md',
    diff: 'comparison/diff.png',
    width: result.width,
    height: result.height,
    diffPixels: result.diffPixels,
    diffRatio: result.diffRatio,
    threshold: COMPARISON_THRESHOLD,
  };
}

async function writeParityArtifacts(parityDir, artifactsDir, input) {
  await rm(parityDir, { recursive: true, force: true });
  await mkdir(parityDir, { recursive: true });
  const result = createPngDiff(input.reference.png, input.production.png);
  const summaryDiff = compareFrameSummaries(
    input.reference.frameSummary,
    input.production.frameSummary,
  );
  await writeJson(resolve(parityDir, 'frame-summary.json'), {
    caseId: input.caseId,
    profile: input.profile,
    lineBreaking: input.lineBreaking,
    spreadIndex: input.spreadIndex,
    reference: input.reference.frameSummary,
    production: input.production.frameSummary,
    diff: summaryDiff,
  });

  if ('dimensionMismatch' in result) {
    await writeParityReport(parityDir, input, result, summaryDiff);
    return {
      report: 'parity/report.md',
      frameSummary: 'parity/frame-summary.json',
      dimensionMismatch: result.dimensionMismatch,
      summaryDiff,
    };
  }

  await writeFile(resolve(parityDir, 'diff.png'), result.diffPng);
  await writeParityReport(parityDir, input, result, summaryDiff);
  return {
    report: 'parity/report.md',
    diff: 'parity/diff.png',
    frameSummary: 'parity/frame-summary.json',
    width: result.width,
    height: result.height,
    diffPixels: result.diffPixels,
    diffRatio: result.diffRatio,
    threshold: COMPARISON_THRESHOLD,
    summaryDiff,
  };
}

function compareFrameSummaries(reference, production) {
  const keys = [
    'totalSpreads',
    'canvas',
    'spread',
    'page',
    'chapterMapHash',
    'manifestHrefMapHash',
    'pngHash',
  ];
  return Object.fromEntries(
    keys
      .map((key) => [key, { reference: reference[key], production: production[key] }])
      .filter(
        ([, values]) => JSON.stringify(values.reference) !== JSON.stringify(values.production),
      ),
  );
}

function createPngDiff(referencePngBytes, actualPngBytes) {
  const reference = PNG.sync.read(referencePngBytes);
  const actual = PNG.sync.read(actualPngBytes);
  if (reference.width !== actual.width || reference.height !== actual.height) {
    return {
      dimensionMismatch: {
        reference: `${String(reference.width)}x${String(reference.height)}`,
        actual: `${String(actual.width)}x${String(actual.height)}`,
      },
    };
  }

  const diff = new PNG({ width: reference.width, height: reference.height });
  const diffPixels = pixelmatch(
    reference.data,
    actual.data,
    diff.data,
    reference.width,
    reference.height,
    { threshold: COMPARISON_THRESHOLD },
  );
  const totalPixels = reference.width * reference.height;
  return {
    width: reference.width,
    height: reference.height,
    diffPixels,
    diffRatio: diffPixels / totalPixels,
    diffPng: PNG.sync.write(diff),
  };
}

async function writeComparisonReport(comparisonDir, input, result) {
  const lines = [
    '# Rendering Diagnostic Comparison',
    '',
    `- Case: \`${input.caseId}\``,
    `- Profile: \`${input.profile.id}\``,
    `- Line breaking: \`${input.lineBreaking}\``,
    `- Spread index: \`${String(input.spreadIndex)}\``,
    '',
    '## Artifacts',
    '',
    `- ${input.actualLabel}: \`../${input.actualSummaryPath.replace('/summary.json', '/actual.png')}\``,
    `- ${input.actualLabel} summary: \`../${input.actualSummaryPath}\``,
    `- ${input.actualLabel} page detail: \`../${input.actualPageDetailPath}\``,
  ];

  if ('skipped' in result) {
    lines.push('', '## Browser Reference', '', `Skipped: ${result.skipped}`);
  } else if ('dimensionMismatch' in result) {
    lines.push(
      '- Browser reference: `../browser/reference.png`',
      '',
      '## Pixel Diff',
      '',
      'Diff image was not generated because screenshot dimensions differ.',
      '',
      `- Reference: \`${result.dimensionMismatch.reference}\``,
      `- Rito actual: \`${result.dimensionMismatch.actual}\``,
    );
  } else {
    lines.push(
      '- Browser reference: `../browser/reference.png`',
      '- Diff: `diff.png`',
      '',
      '## Pixel Diff',
      '',
      `- Size: \`${String(result.width)}x${String(result.height)}\``,
      `- Threshold: \`${String(COMPARISON_THRESHOLD)}\``,
      `- Diff pixels: \`${String(result.diffPixels)}\``,
      `- Diff ratio: \`${result.diffRatio.toFixed(6)}\``,
    );
  }

  await writeFile(resolve(comparisonDir, 'report.md'), `${lines.join('\n')}\n`, 'utf8');
}

async function writeParityReport(parityDir, input, result, summaryDiff) {
  const lines = [
    '# Reader Parity Diagnostic',
    '',
    `- Case: \`${input.caseId}\``,
    `- Profile: \`${input.profile.id}\``,
    `- Line breaking: \`${input.lineBreaking}\``,
    `- Spread index: \`${String(input.spreadIndex)}\``,
    '',
    '## Artifacts',
    '',
    '- Production actual: `../production/actual.png`',
    '- Production summary: `../production/summary.json`',
    '- Production frame summary: `../production/frame-summary.json`',
    '- Reference actual: `../reference/actual.png`',
    '- Reference summary: `../reference/summary.json`',
    '- Reference frame summary: `../reference/frame-summary.json`',
    '- Frame summary comparison: `frame-summary.json`',
  ];

  if ('dimensionMismatch' in result) {
    lines.push(
      '',
      '## Pixel Diff',
      '',
      'Diff image was not generated because screenshot dimensions differ.',
      '',
      `- Reference: \`${result.dimensionMismatch.reference}\``,
      `- Production: \`${result.dimensionMismatch.actual}\``,
    );
  } else {
    lines.push(
      '- Pixel diff: `diff.png`',
      '',
      '## Pixel Diff',
      '',
      `- Size: \`${String(result.width)}x${String(result.height)}\``,
      `- Threshold: \`${String(COMPARISON_THRESHOLD)}\``,
      `- Diff pixels: \`${String(result.diffPixels)}\``,
      `- Diff ratio: \`${result.diffRatio.toFixed(6)}\``,
    );
  }

  const summaryDiffKeys = Object.keys(summaryDiff);
  lines.push('', '## Frame Summary Diff', '');
  if (summaryDiffKeys.length === 0) {
    lines.push('No frame-summary differences.');
  } else {
    for (const key of summaryDiffKeys) lines.push(`- \`${key}\``);
  }

  await writeFile(resolve(parityDir, 'report.md'), `${lines.join('\n')}\n`, 'utf8');
}

async function applyBrowserReferencePageFrame(page, profile) {
  if (profile.margin <= 0) return;
  await page.evaluate(
    ({ margin, width, height }) => {
      const existing = document.getElementById('__rito_diag_page__');
      if (existing) return;

      const wrapper = document.createElement('div');
      wrapper.id = '__rito_diag_page__';
      wrapper.style.width = `${String(width - margin * 2)}px`;
      wrapper.style.minHeight = `${String(height - margin * 2)}px`;
      wrapper.style.margin = '0 auto';
      wrapper.style.paddingTop = `${String(margin)}px`;
      wrapper.style.paddingBottom = `${String(margin)}px`;
      wrapper.style.boxSizing = 'border-box';

      while (document.body.firstChild) {
        wrapper.appendChild(document.body.firstChild);
      }
      document.body.appendChild(wrapper);
    },
    {
      margin: profile.margin,
      width: profile.width,
      height: profile.height,
    },
  );
}

async function waitForRenderApi(page, diagnostics) {
  await page.waitForFunction(
    () =>
      typeof window.renderRitoDiagnostic === 'function' ||
      window.renderRitoDiagnosticReady !== 'loading',
    undefined,
    { timeout: 30_000 },
  );
  const status = await page.evaluate(() => window.renderRitoDiagnosticReady);
  if (status !== 'ready') {
    throw new Error(`Rito diagnostic render page failed: ${status}\n${diagnostics.join('\n')}`);
  }
}

async function startDiagnosticServer(referenceRoot) {
  const server = createServer((request, response) => {
    void handleDiagnosticRequest(referenceRoot, request.url || '/', response);
  });
  await new Promise((resolveServer, rejectServer) => {
    const handleError = (error) => {
      server.off('listening', handleListening);
      rejectServer(error);
    };
    const handleListening = () => {
      server.off('error', handleError);
      resolveServer();
    };
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', handleListening);
  });

  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('Failed to start diagnostic server');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

async function handleDiagnosticRequest(referenceRoot, requestUrl, response) {
  const pathname = new URL(requestUrl, 'http://127.0.0.1').pathname;
  if (pathname === '/render.html') {
    sendHtml(response, renderHtml());
    return;
  }
  if (pathname.startsWith('/dist/')) {
    await sendStaticFile(response, DIST_ROOT, pathname.slice('/dist/'.length));
    return;
  }
  if (pathname.startsWith('/reference-dist/')) {
    await sendStaticFile(response, REFERENCE_DIST_ROOT, pathname.slice('/reference-dist/'.length));
    return;
  }
  if (pathname.startsWith('/core-wasm/')) {
    await sendStaticFile(response, CORE_WASM_DIST_ROOT, pathname.slice('/core-wasm/'.length));
    return;
  }
  if (pathname === '/vendor/fflate/browser.js') {
    await sendAbsoluteFile(response, FFLATE_BROWSER_PATH);
    return;
  }
  if (pathname === '/vendor/css-line-break.js') {
    await sendAbsoluteFile(response, CSS_LINE_BREAK_PATH);
    return;
  }
  if (pathname.startsWith('/reference/')) {
    await sendStaticFile(response, referenceRoot, pathname.slice('/reference/'.length));
    return;
  }
  response.writeHead(404).end('Not found');
}

async function sendStaticFile(response, root, relativePath) {
  const filePath = resolve(root, decodeURIComponent(relativePath));
  if (!isInside(root, filePath)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  await sendAbsoluteFile(response, filePath);
}

async function sendAbsoluteFile(response, filePath) {
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentType(filePath) }).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

function sendHtml(response, html) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}

function contentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
    case '.htm':
    case '.xhtml':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.otf':
      return 'font/otf';
    case '.ttf':
      return 'font/ttf';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

async function extractEpub(bookBytes, extractedDir) {
  await rm(extractedDir, { recursive: true, force: true });
  await mkdir(extractedDir, { recursive: true });
  const files = unzipSync(normalizedZipBytes(bookBytes));
  await Promise.all(
    Object.entries(files).map(async ([name, bytes]) => {
      if (name.endsWith('/')) return;
      const filePath = resolve(extractedDir, name);
      assertInside(extractedDir, filePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
    }),
  );
}

async function resolveReferenceContext(extractedDir) {
  const fallbackOpfPath = resolve(extractedDir, 'content.opf');
  const containerPath = resolve(extractedDir, 'META-INF/container.xml');
  let opfPath = fallbackOpfPath;

  try {
    const containerXml = await readFile(containerPath, 'utf8');
    const rootfilePath = parseRootfilePath(containerXml);
    if (rootfilePath) opfPath = resolve(extractedDir, rootfilePath);
  } catch {
    // Ignore missing container metadata; fall back to extracted root.
  }

  assertInside(extractedDir, opfPath);
  return {
    opfDirRelative: toPosixRelative(extractedDir, dirname(opfPath)),
  };
}

function parseRootfilePath(containerXml) {
  const match = containerXml.match(/<rootfile\b[^>]*\bfull-path=(["'])([^"']+)\1/i);
  return match?.[2];
}

function resolveReferenceDocumentHref(referenceContext, chapterHref) {
  const normalized = chapterHref.replaceAll('\\', '/');
  const opfDirRelative = referenceContext.opfDirRelative;
  if (!opfDirRelative || normalized.startsWith(`${opfDirRelative}/`)) return normalized;
  return `${opfDirRelative}/${normalized}`;
}

function toPosixRelative(root, path) {
  const pathRelative = relative(root, path);
  if (!pathRelative) return '';
  return pathRelative.split(sep).join('/');
}

function normalizedZipBytes(bookBytes) {
  const localFileHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const start = bookBytes.indexOf(localFileHeader);
  if (start < 0) throw new Error('No ZIP local file header found in EPUB input');
  return new Uint8Array(bookBytes.subarray(start));
}

async function readCaseConfig(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function resolveProfile(caseConfig) {
  const profileId =
    process.env.RITO_DIAG_PROFILE || readOptionalString(caseConfig.profile) || 'single-default';
  const base = PROFILES.get(profileId);
  if (!base) throw new Error(`Unknown diagnostic profile: ${profileId}`);
  const dpr = Number(process.env.RITO_DIAG_DPR || caseConfig.devicePixelRatio || 1);
  if (!Number.isFinite(dpr) || dpr <= 0) throw new Error(`Invalid device pixel ratio: ${dpr}`);
  return { ...base, devicePixelRatio: dpr };
}

function resolveLineBreaking(caseConfig) {
  const value =
    process.env.RITO_DIAG_LINE_BREAKING || readOptionalString(caseConfig.lineBreaking) || 'greedy';
  if (value === 'greedy' || value === 'optimal') return value;
  throw new Error(`Invalid lineBreaking: ${value}`);
}

function resolveSpreadIndex(caseConfig) {
  const location = readRecord(caseConfig.location);
  const value = process.env.RITO_DIAG_SPREAD ?? location?.spreadIndex ?? 0;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`Invalid spread index: ${String(value)}`);
  return parsed;
}

function resolveDiagnosticEngines() {
  const value = process.env.RITO_DIAG_ENGINE || 'production';
  if (value === 'both') return [ENGINE_CONFIGS.get('production'), ENGINE_CONFIGS.get('reference')];
  const engine = ENGINE_CONFIGS.get(value);
  if (!engine) throw new Error(`Invalid diagnostic engine: ${value}`);
  return [engine];
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function readRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function readOptionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function assertInside(root, path) {
  if (!isInside(root, path)) throw new Error(`Path escapes root: ${path}`);
}

function isInside(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function printUsage() {
  console.log(`Usage:
  RITO_DIAG_CASE=<case-id> pnpm diagnose:render

Inputs:
  packages/rito/test-results/render-diagnostics/cases/<case-id>/book.epub
  packages/rito/test-results/render-diagnostics/cases/<case-id>/case.json

Optional environment:
  RITO_DIAG_EPUB=/absolute/path/book.epub
  RITO_DIAG_PROFILE=single-default|single-narrow|single-wide|double-default
  RITO_DIAG_LINE_BREAKING=greedy|optimal
  RITO_DIAG_SPREAD=0
  RITO_DIAG_DPR=1
  RITO_DIAG_ENGINE=production|reference|both
  PLAYWRIGHT_BROWSER_CHANNEL=msedge

Notes:
  Use RITO_DIAG_ENGINE=both, or pnpm diagnose:reader-parity, to compare the
  Rust-backed production reader against the TypeScript reference reader.
  Use a single-page profile for Rito-vs-browser XHTML comparisons.
  Use double-default only for spread composition and page parity diagnosis.
`);
}

function renderHtml() {
  return `<!doctype html>
<meta charset="utf-8" />
<style>
  html,
  body {
    margin: 0;
    background: #fff;
  }
  canvas {
    display: block;
  }
</style>
<canvas id="canvas"></canvas>
<script type="importmap">
  {
    "imports": {
      "css-line-break": "/vendor/css-line-break.js",
      "fflate": "/vendor/fflate/browser.js",
      "@ritojs/core-wasm": "/core-wasm/index.mjs",
      "@ritojs/core-wasm/decoder": "/core-wasm/decoder.mjs"
    }
  }
</script>
<script type="module">
  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  window.renderRitoDiagnosticReady = 'loading';

  const readerModules = new Map();
  const moduleImports = [
    ['production', import('/dist/index.mjs')],
    ['reference', import('/reference-dist/tooling/web.mjs')],
  ];

  Promise.all(moduleImports.map(async ([engine, promise]) => {
    readerModules.set(engine, await promise);
  }))
    .then(() => {
      window.renderRitoDiagnosticReady = 'ready';
      window.renderRitoDiagnostic = async ({ bookBase64, engine, profile, lineBreaking, spreadIndex }) => {
        const module = readerModules.get(engine);
        if (!module || typeof module.createReader !== 'function') {
          throw new Error(\`Unknown diagnostic reader engine: \${engine}\`);
        }
        const canvas = document.getElementById('canvas');
        const originalWorker = globalThis.Worker;
        if (engine === 'production') globalThis.Worker = undefined;
        const reader = await module.createReader(base64ToArrayBuffer(bookBase64), canvas, {
          width: profile.width,
          height: profile.height,
          margin: profile.margin,
          spread: profile.spread,
          spreadGap: profile.spreadGap,
          lineBreaking,
          devicePixelRatio: profile.devicePixelRatio,
          backgroundColor: '#ffffff',
          logLevel: 'silent',
        }).finally(() => {
          globalThis.Worker = originalWorker;
        });

        if (spreadIndex >= reader.totalSpreads) {
          reader.dispose();
          throw new Error(\`Spread \${spreadIndex} is outside totalSpreads=\${reader.totalSpreads}\`);
        }

        reader.renderSpread(spreadIndex);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const dataUrl = canvas.toDataURL('image/png');
        const diagnostics = await collectRenderDiagnostics();
        const totalSpreads = reader.totalSpreads;
        const spread = spreadFacts(reader.spreads[spreadIndex]);
        const page = spreadPage(reader.spreads[spreadIndex], profile.spread);
        const chapterMap = Array.from(reader.chapterMap, ([idref, range]) => ({
          idref,
          startPage: range.startPage,
          endPage: range.endPage,
        }));
        const manifestHrefMap = Array.from(reader.manifestHrefMap, ([idref, href]) => ({
          idref,
          href,
        }));
        reader.dispose();
        return {
          totalSpreads,
          spread,
          page,
          canvas: {
            width: canvas.width,
            height: canvas.height,
            cssWidth: canvas.style.width || '',
            cssHeight: canvas.style.height || '',
          },
          chapterMap,
          manifestHrefMap,
          pngBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
          diagnostics,
        };
      };
    })
    .catch((error) => {
      console.error(error);
      window.renderRitoDiagnosticReady = String(error && (error.stack || error.message || error));
    });

  async function collectRenderDiagnostics() {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready.catch(() => undefined);
    }
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      devicePixelRatio: window.devicePixelRatio,
      fontStatus: document.fonts ? document.fonts.status : 'unsupported',
      fonts: collectFontDiagnostics(),
    };
  }

  function collectFontDiagnostics() {
    if (!document.fonts || !document.fonts[Symbol.iterator]) return [];
    return Array.from(document.fonts).map((face) => ({
      family: face.family,
      status: face.status,
      weight: face.weight,
      style: face.style,
    }));
  }

  function spreadFacts(spread) {
    if (!spread) return undefined;
    return {
      index: spread.index,
      left: pageFacts(spread.left),
      right: pageFacts(spread.right),
    };
  }

  function spreadPage(spread, spreadMode) {
    if (!spread) return undefined;
    if (spreadMode === 'double') return spread.left;
    return spread.left || spread.right;
  }

  function pageFacts(page) {
    if (!page) return undefined;
    return {
      index: page.index,
      textPreview: pageTextPreview(page),
    };
  }

  function pageTextPreview(page) {
    const parts = [];
    for (const block of page.content || []) collectBlockText(block, parts);
    return parts.join('').replace(/\\s+/g, ' ').trim().slice(0, 240);
  }

  function collectBlockText(block, parts) {
    for (const child of block.children || []) {
      if (child.type === 'line-box') {
        for (const run of child.runs || []) {
          if (run.type === 'text-run') parts.push(run.text);
        }
      } else if (child.type === 'layout-block') {
        collectBlockText(child, parts);
      }
    }
  }
</script>`;
}
