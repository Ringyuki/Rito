import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export interface PixelRenderServer {
  readonly origin: string;
  close(): Promise<void>;
}

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = resolve(HELPER_DIR, '../../../dist');
const require = createRequire(import.meta.url);
const FFLATE_ROOT = dirname(dirname(require.resolve('fflate/browser')));
const VENDOR_MODULES = new Map([
  ['css-line-break.js', require.resolve('css-line-break/dist/css-line-break.es5.js')],
  ['fflate/browser.js', resolve(FFLATE_ROOT, 'esm/browser.js')],
]);

export async function startPixelRenderServer(): Promise<PixelRenderServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response);
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
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      }),
  };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
  response.writeHead(404).end('Not found');
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

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
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
