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
const VENDOR_MODULES = new Map([['fflate/browser.js', resolve(FFLATE_ROOT, 'esm/browser.js')]]);

export async function startPixelRenderServer(): Promise<PixelRenderServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolveServer) => {
    server.listen(0, '127.0.0.1', resolveServer);
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
      window.renderRitoPixelCase = async (testCase, bookBase64) => {
        const canvas = document.getElementById('canvas');
        const reader = await createReader(base64ToArrayBuffer(bookBase64), canvas, {
          width: testCase.width,
          height: testCase.height,
          margin: testCase.margin,
          spread: 'single',
          lineBreaking: testCase.lineBreaking,
          devicePixelRatio: testCase.devicePixelRatio,
          backgroundColor: '#ffffff',
          logLevel: 'silent',
        });

        if (testCase.spreadIndex >= reader.totalSpreads) {
          const total = reader.totalSpreads;
          reader.dispose();
          throw new Error(\`Spread \${testCase.spreadIndex} is outside totalSpreads=\${total}\`);
        }

        reader.renderSpread(testCase.spreadIndex);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const dataUrl = canvas.toDataURL('image/png');
        reader.dispose();
        return dataUrl.slice(dataUrl.indexOf(',') + 1);
      };
    })
    .catch((error) => {
      console.error(error);
      window.renderRitoPixelReady = String(error && (error.stack || error.message || error));
    });
</script>`;
}
