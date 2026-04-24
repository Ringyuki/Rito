import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

export interface PixelRenderServer {
  readonly origin: string;
  registerReferenceBook(bookId: string, bookBytes: Buffer): Promise<PixelReferenceBook>;
  close(): Promise<void>;
}

export interface PixelReferenceBook {
  readonly bookId: string;
  referenceUrl(chapterHref: string): string;
}

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = resolve(HELPER_DIR, '../../../dist');
const PIXEL_REVIEW_REFERENCE_ROOT = resolve(
  HELPER_DIR,
  '../../../test-results/pixel-review/reference-books',
);
const require = createRequire(import.meta.url);
const FFLATE_ROOT = dirname(dirname(require.resolve('fflate/browser')));
const VENDOR_MODULES = new Map([
  ['css-line-break.js', require.resolve('css-line-break/dist/css-line-break.es5.js')],
  ['fflate/browser.js', resolve(FFLATE_ROOT, 'esm/browser.js')],
]);

export async function startPixelRenderServer(): Promise<PixelRenderServer> {
  const referenceRoots = new Map<string, string>();
  const server = createServer((request, response) => {
    void handleRequest(request, response, referenceRoots);
  });

  await new Promise<void>((resolveServer, rejectServer) => {
    const handleError = (error: Error): void => {
      server.off('listening', handleListening);
      rejectServer(error);
    };
    const handleListening = (): void => {
      server.off('error', handleError);
      resolveServer();
    };
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', handleListening);
  });

  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Failed to start pixel render server');
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    registerReferenceBook: async (bookId, bookBytes) =>
      await registerReferenceBook(bookId, bookBytes, referenceRoots, address.port),
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  referenceRoots: ReadonlyMap<string, string>,
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/render.html') {
    sendHtml(response, renderHtml());
    return;
  }
  if (pathname.startsWith('/dist/')) {
    await sendDistFile(response, pathname.slice('/dist/'.length));
    return;
  }
  if (pathname.startsWith('/vendor/')) {
    await sendVendorFile(response, pathname.slice('/vendor/'.length));
    return;
  }
  if (pathname.startsWith('/reference/')) {
    await sendReferenceFile(response, referenceRoots, pathname.slice('/reference/'.length));
    return;
  }
  response.writeHead(404).end('Not found');
}

async function registerReferenceBook(
  bookId: string,
  bookBytes: Buffer,
  referenceRoots: Map<string, string>,
  port: number,
): Promise<PixelReferenceBook> {
  const root = resolve(PIXEL_REVIEW_REFERENCE_ROOT, safePathPart(bookId));
  if (!referenceRoots.has(bookId)) {
    await extractEpub(bookBytes, root);
    referenceRoots.set(bookId, root);
  }
  const referenceContext = await resolveReferenceContext(root);
  return {
    bookId,
    referenceUrl: (chapterHref) =>
      `http://127.0.0.1:${String(port)}/reference/${encodeURIComponent(bookId)}/${encodePath(
        resolveReferenceDocumentHref(referenceContext, chapterHref),
      )}`,
  };
}

async function sendDistFile(response: ServerResponse, relativePath: string): Promise<void> {
  const path = resolve(DIST_ROOT, relativePath);
  if (!path.startsWith(`${DIST_ROOT}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': contentType(path) }).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

async function sendVendorFile(response: ServerResponse, relativePath: string): Promise<void> {
  const path = VENDOR_MODULES.get(relativePath);
  if (!path) {
    response.writeHead(404).end('Not found');
    return;
  }

  try {
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': contentType(path) }).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

async function sendReferenceFile(
  response: ServerResponse,
  referenceRoots: ReadonlyMap<string, string>,
  relativePath: string,
): Promise<void> {
  const slashIndex = relativePath.indexOf('/');
  if (slashIndex <= 0) {
    response.writeHead(404).end('Not found');
    return;
  }
  const bookId = decodeURIComponent(relativePath.slice(0, slashIndex));
  const root = referenceRoots.get(bookId);
  if (!root) {
    response.writeHead(404).end('Not found');
    return;
  }
  const pathPart = decodeURIComponent(relativePath.slice(slashIndex + 1));
  const path = resolve(root, pathPart);
  if (!isInside(root, path)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': contentType(path) }).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
    case '.htm':
    case '.xhtml':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
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

async function extractEpub(bookBytes: Buffer, extractedDir: string): Promise<void> {
  await rm(extractedDir, { recursive: true, force: true });
  await mkdir(extractedDir, { recursive: true });
  const files = unzipSync(normalizedZipBytes(bookBytes));
  await Promise.all(
    Object.entries(files).map(async ([name, bytes]) => {
      if (name.endsWith('/')) return;
      const path = resolve(extractedDir, name);
      if (!isInside(extractedDir, path)) throw new Error(`Path escapes EPUB root: ${name}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }),
  );
}

async function resolveReferenceContext(
  extractedDir: string,
): Promise<{ readonly opfDirRelative: string }> {
  const fallbackOpfPath = resolve(extractedDir, 'content.opf');
  const containerPath = resolve(extractedDir, 'META-INF/container.xml');
  let opfPath = fallbackOpfPath;

  try {
    const containerXml = await readFile(containerPath, 'utf8');
    const rootfilePath = parseRootfilePath(containerXml);
    if (rootfilePath) opfPath = resolve(extractedDir, rootfilePath);
  } catch {
    // Fall back to the package root for simple fixtures without a container file.
  }

  if (!isInside(extractedDir, opfPath)) throw new Error(`Path escapes EPUB root: ${opfPath}`);
  return { opfDirRelative: toPosixRelative(extractedDir, dirname(opfPath)) };
}

function parseRootfilePath(containerXml: string): string | undefined {
  const match = containerXml.match(/<rootfile\b[^>]*\bfull-path=(["'])([^"']+)\1/i);
  return match?.[2];
}

function resolveReferenceDocumentHref(
  referenceContext: { readonly opfDirRelative: string },
  chapterHref: string,
): string {
  const normalized = chapterHref.replaceAll('\\', '/');
  const opfDirRelative = referenceContext.opfDirRelative;
  if (!opfDirRelative || normalized.startsWith(`${opfDirRelative}/`)) return normalized;
  return `${opfDirRelative}/${normalized}`;
}

function normalizedZipBytes(bookBytes: Buffer): Uint8Array {
  const localFileHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const start = bookBytes.indexOf(localFileHeader);
  if (start < 0) throw new Error('No ZIP local file header found in EPUB input');
  return new Uint8Array(bookBytes.subarray(start));
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function toPosixRelative(root: string, path: string): string {
  const pathRelative = relative(root, path);
  if (!pathRelative) return '';
  return pathRelative.split(sep).join('/');
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function renderHtml(): string {
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

  window.renderRitoPixelReady = 'loading';

  import('/dist/index.mjs')
    .then(({ createReader }) => {
      window.renderRitoPixelReady = 'ready';
      window.renderRitoPixelRun = async (testRun, bookBase64) => {
        const canvas = document.getElementById('canvas');
        const reader = await createReader(base64ToArrayBuffer(bookBase64), canvas, {
          width: testRun.profile.width,
          height: testRun.profile.height,
          margin: testRun.profile.margin,
          spread: testRun.profile.spread,
          spreadGap: testRun.profile.spreadGap,
          lineBreaking: testRun.lineBreaking,
          devicePixelRatio: testRun.profile.devicePixelRatio,
          backgroundColor: '#ffffff',
          logLevel: 'silent',
        });

        const totalSpreads = reader.totalSpreads;
        const spreadIndexes = spreadIndexesForRun(testRun, totalSpreads);
        const invalidSpread = spreadIndexes.find((spreadIndex) => spreadIndex >= totalSpreads);
        if (invalidSpread !== undefined) {
          reader.dispose();
          throw new Error(
            \`Spread \${invalidSpread} is outside totalSpreads=\${totalSpreads}\`,
          );
        }

        const spreads = [];
        for (const spreadIndex of spreadIndexes) {
          reader.renderSpread(spreadIndex);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const dataUrl = canvas.toDataURL('image/png');
          spreads.push({
            spreadIndex,
            pngBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
            reference: referenceHint(reader, testRun.profile.spread, reader.spreads[spreadIndex]),
          });
        }
        const diagnostics = await collectRenderDiagnostics();
        reader.dispose();
        return { totalSpreads, spreads, diagnostics };
      };
    })
    .catch((error) => {
      console.error(error);
      window.renderRitoPixelReady = String(error && (error.stack || error.message || error));
    });

  function spreadIndexesForRun(testRun, totalSpreads) {
    const selection = testRun.spreadSelection || { mode: 'all' };
    if (selection.mode === 'explicit') return selection.indexes || [];
    if (selection.mode === 'curated') {
      return curatedSpreadIndexes(selection.frontmatterSpreadCount || 0, totalSpreads);
    }
    if (selection.mode === 'key') {
      return keySpreadIndexes(selection.frontmatterSpreadCount || 0, totalSpreads);
    }
    return Array.from({ length: totalSpreads }, (_, spreadIndex) => spreadIndex);
  }

  function curatedSpreadIndexes(frontmatterSpreadCount, totalSpreads) {
    const frontmatter = Array.from(
      { length: Math.min(frontmatterSpreadCount, totalSpreads) },
      (_, spreadIndex) => spreadIndex,
    );
    const bodyStart = Math.min(frontmatterSpreadCount, totalSpreads - 1);
    const bodyMiddle = Math.floor((bodyStart + totalSpreads - 1) / 2);
    const tailStart = Math.max(bodyStart, totalSpreads - 2);
    return uniqueValidSpreadIndexes(
      [...frontmatter, bodyStart, bodyStart + 1, bodyMiddle, tailStart, totalSpreads - 1],
      totalSpreads,
    );
  }

  function uniqueValidSpreadIndexes(spreadIndexes, totalSpreads) {
    return [...new Set(spreadIndexes)].filter(
      (spreadIndex) => spreadIndex >= 0 && spreadIndex < totalSpreads,
    );
  }

  function keySpreadIndexes(frontmatterSpreadCount, totalSpreads) {
    const lastFrontmatter = Math.min(frontmatterSpreadCount - 1, totalSpreads - 1);
    const bodyStart = Math.min(frontmatterSpreadCount, totalSpreads - 1);
    const bodyMiddle = Math.floor((bodyStart + totalSpreads - 1) / 2);
    return uniqueValidSpreadIndexes(
      [0, 1, 2, lastFrontmatter, bodyStart, bodyMiddle, totalSpreads - 1],
      totalSpreads,
    );
  }

  function referenceHint(reader, spreadMode, spread) {
    const page = spreadPage(spread, spreadMode);
    if (!page) return undefined;
    return {
      pageIndex: page.index,
      chapterHref: chapterHrefForPage(reader, page.index),
      textPreview: pageTextPreview(page),
    };
  }

  function spreadPage(spread, spreadMode) {
    if (!spread) return undefined;
    if (spreadMode === 'double') return spread.left;
    return spread.left || spread.right;
  }

  function chapterHrefForPage(reader, pageIndex) {
    for (const [idref, range] of reader.chapterMap || []) {
      if (pageIndex >= range.startPage && pageIndex <= range.endPage) {
        return reader.manifestHrefMap?.get(idref);
      }
    }
    return undefined;
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
      textMetrics: collectTextMetricDiagnostics(),
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

  function collectTextMetricDiagnostics() {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return [];
    return [
      measureDiagnosticText(context, '16px serif', '制作信息'),
      measureDiagnosticText(context, '16px serif', 'www.tsdm.net'),
      measureDiagnosticText(context, '16px serif', '────────────────────────'),
      measureDiagnosticText(context, '16px sans-serif', '制作信息'),
      measureDiagnosticText(context, '16px sans-serif', '────────────────────────'),
      measureDiagnosticText(context, '16px "Hiragino Sans"', '制作信息'),
      measureDiagnosticText(context, '16px "Hiragino Mincho ProN"', '制作信息'),
      measureDiagnosticText(context, '16px "Songti SC"', '制作信息'),
    ];
  }

  function measureDiagnosticText(context, font, sample) {
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
  }
</script>`;
}
