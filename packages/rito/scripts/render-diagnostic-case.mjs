#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { unzipSync } from 'fflate';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');
const DIST_ROOT = resolve(PACKAGE_ROOT, 'dist');
const CASE_ROOT = resolve(PACKAGE_ROOT, 'test-results/render-diagnostics/cases');
const require = createRequire(import.meta.url);
const FFLATE_ROOT = dirname(dirname(require.resolve('fflate/browser')));
const FFLATE_BROWSER_PATH = resolve(FFLATE_ROOT, 'esm/browser.js');
const CSS_LINE_BREAK_PATH = require.resolve('css-line-break/dist/css-line-break.es5.js');

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
  const ritoDir = resolve(artifactsDir, 'rito');
  const browserDir = resolve(artifactsDir, 'browser');
  const extractedDir = resolve(browserDir, 'extracted');
  const caseConfig = await readCaseConfig(resolve(caseDir, 'case.json'));
  const bookPath = process.env.RITO_DIAG_EPUB
    ? resolve(process.env.RITO_DIAG_EPUB)
    : resolve(caseDir, 'book.epub');
  const bookBytes = await readFile(bookPath);
  const profile = resolveProfile(caseConfig);
  const lineBreaking = resolveLineBreaking(caseConfig);
  const spreadIndex = resolveSpreadIndex(caseConfig);

  await mkdir(ritoDir, { recursive: true });
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
    const ritoResult = await renderRitoSpread(page, server.origin, {
      bookBytes,
      profile,
      lineBreaking,
      spreadIndex,
    });
    await writeFile(resolve(ritoDir, 'actual.png'), ritoResult.png);
    await writeJson(resolve(ritoDir, 'diagnostics.json'), ritoResult.diagnostics);
    await writeJson(resolve(ritoDir, 'page-detail.json'), ritoResult.page);
    await writeJson(resolve(ritoDir, 'summary.json'), {
      caseId,
      bookPath,
      profile,
      lineBreaking,
      spreadIndex,
      totalSpreads: ritoResult.totalSpreads,
      spread: ritoResult.spread,
      chapterMap: ritoResult.chapterMap,
      manifestHrefMap: ritoResult.manifestHrefMap,
    });

    const reference = await captureBrowserReference(
      page,
      server.origin,
      caseConfig,
      browserDir,
      profile,
      referenceContext,
    );
    await writeJson(resolve(artifactsDir, 'report.json'), {
      caseId,
      rito: {
        actual: 'rito/actual.png',
        diagnostics: 'rito/diagnostics.json',
        summary: 'rito/summary.json',
      },
      browser: reference,
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
    async ({ bookBase64, lineBreaking, profile, spreadIndex }) => {
      return window.renderRitoDiagnostic({
        bookBase64,
        lineBreaking,
        profile,
        spreadIndex,
      });
    },
    {
      bookBase64: input.bookBytes.toString('base64'),
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

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
  PLAYWRIGHT_BROWSER_CHANNEL=msedge

Notes:
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
      "fflate": "/vendor/fflate/browser.js"
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

  import('/dist/index.mjs')
    .then(({ createReader }) => {
      window.renderRitoDiagnosticReady = 'ready';
      window.renderRitoDiagnostic = async ({ bookBase64, profile, lineBreaking, spreadIndex }) => {
        const canvas = document.getElementById('canvas');
        const reader = await createReader(base64ToArrayBuffer(bookBase64), canvas, {
          width: profile.width,
          height: profile.height,
          margin: profile.margin,
          spread: profile.spread,
          spreadGap: profile.spreadGap,
          lineBreaking,
          devicePixelRatio: profile.devicePixelRatio,
          backgroundColor: '#ffffff',
          logLevel: 'silent',
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
