import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PixelRenderServer {
  readonly origin: string;
  close(): Promise<void>;
}

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = resolve(HELPER_DIR, '../../../dist');

/**
 * Serves the built `@ritojs/core` package (`/dist/`) and a blank page
 * (`/production-parity.html`) so a Playwright test can import the
 * production reader module same-origin and drive it in a real browser.
 */
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
  if (pathname === '/production-parity.html') {
    sendHtml(response, productionPageHtml());
    return;
  }
  if (pathname === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  if (pathname.startsWith('/dist/')) {
    await sendDistFile(response, pathname.slice('/dist/'.length));
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

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

function productionPageHtml(): string {
  return `<!doctype html>
<meta charset="utf-8" />
<style>
  html,
  body {
    margin: 0;
    background: #fff;
  }
</style>`;
}
