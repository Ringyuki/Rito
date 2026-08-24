import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';

const HARNESS_PREFIX = '/__rito-pinned-fallback__';
const CORE_PREFIX = `${HARNESS_PREFIX}/core/`;
const HARNESS_URL = `${HARNESS_PREFIX}/index.html`;
const EPUB_URL = `${HARNESS_PREFIX}/fixture.epub`;
const FONT_URL = `${HARNESS_PREFIX}/title.ttf`;
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(TEST_DIR, '../../../..');
const CORE_DIST_ROOT = resolve(REPOSITORY_ROOT, 'packages/rito/dist');
const DEMO_EPUB_PATH = resolve(REPOSITORY_ROOT, 'apps/reader/src/assets/demo.epub');
const DEMO_TITLE_FONT_PATH = 'OEBPS/Fonts/title.ttf';

export const PINNED_FALLBACK_QUERY = '关于我在无意间被';
export const PINNED_FALLBACK_LANGUAGE = 'zh';
export const PINNED_FALLBACK_CORE_URL = `${CORE_PREFIX}index.mjs`;
export const PINNED_FALLBACK_EPUB_URL = EPUB_URL;
export const PINNED_FALLBACK_FONT_URL = FONT_URL;

export interface PinnedFallbackFixture {
  readonly epub: Buffer;
  readonly font: Buffer;
  readonly fontSha256: string;
  readonly familyAlias: string;
}

export async function buildPinnedFallbackProductionCore(): Promise<void> {
  await new Promise<void>((resolveBuild, rejectBuild) => {
    const child = spawn('pnpm', ['--filter', '@ritojs/core', 'build'], {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', rejectBuild);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveBuild();
      else rejectBuild(new Error(`Core build failed with ${String(code ?? signal)}`));
    });
  });
}

type ZipEntry = Uint8Array | [Uint8Array, { readonly level: number }];

interface FflateApi {
  unzipSync(data: Uint8Array): Record<string, Uint8Array>;
  zipSync(files: Record<string, ZipEntry>): Uint8Array;
}

export async function createPinnedFallbackFixture(): Promise<PinnedFallbackFixture> {
  const fflate = loadFflate();
  const demo = await readFile(DEMO_EPUB_PATH);
  const fontBytes = fflate.unzipSync(demo)[DEMO_TITLE_FONT_PATH];
  if (!fontBytes) throw new Error(`Demo EPUB does not contain ${DEMO_TITLE_FONT_PATH}`);
  const font = Buffer.from(fontBytes);
  const epub = Buffer.from(buildNoEmbeddedFontEpub(fflate));
  requireStoredMimetype(epub);
  const embeddedFonts = Object.keys(fflate.unzipSync(epub)).filter((path) =>
    /\.(?:otf|ttf|woff2?)$/i.test(path),
  );
  if (embeddedFonts.length !== 0) {
    throw new Error(
      `Pinned fallback fixture unexpectedly embeds fonts: ${embeddedFonts.join(', ')}`,
    );
  }
  const fontSha256 = createHash('sha256').update(font).digest('hex');
  return {
    epub,
    font,
    fontSha256,
    familyAlias: `__RitoPinned_${fontSha256}`,
  };
}

export async function installPinnedFallbackHarness(
  page: Page,
  fixture: PinnedFallbackFixture,
): Promise<void> {
  await page.route(`**${HARNESS_PREFIX}/**`, async (route) => {
    await handleHarnessRoute(route, fixture);
  });
}

export async function openPinnedFallbackHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
}

async function handleHarnessRoute(route: Route, fixture: PinnedFallbackFixture): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === HARNESS_URL) {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: harnessHtml(),
    });
    return;
  }
  if (pathname === EPUB_URL) {
    await route.fulfill({ status: 200, contentType: 'application/epub+zip', body: fixture.epub });
    return;
  }
  if (pathname === FONT_URL) {
    await route.fulfill({ status: 200, contentType: 'font/ttf', body: fixture.font });
    return;
  }
  if (pathname.startsWith(CORE_PREFIX)) {
    await fulfillCoreFile(route, pathname.slice(CORE_PREFIX.length));
    return;
  }
  await route.fulfill({ status: 404, body: 'Not found' });
}

async function fulfillCoreFile(route: Route, encodedRelativePath: string): Promise<void> {
  const relativePath = decodeURIComponent(encodedRelativePath);
  const path = resolve(CORE_DIST_ROOT, relativePath);
  if (!path.startsWith(`${CORE_DIST_ROOT}${sep}`)) {
    await route.fulfill({ status: 403, body: 'Forbidden' });
    return;
  }
  try {
    await route.fulfill({
      status: 200,
      contentType: contentType(path),
      body: await readFile(path),
    });
  } catch {
    await route.fulfill({ status: 404, body: 'Not found' });
  }
}

function buildNoEmbeddedFontEpub(fflate: FflateApi): Uint8Array {
  const encoder = new TextEncoder();
  const files: Record<string, ZipEntry> = {
    // EPUB requires the first entry to be the uncompressed mimetype payload.
    mimetype: [encoder.encode('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    'OEBPS/content.opf': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Pinned Fallback Worker Fixture</dc:title>
    <dc:language>${PINNED_FALLBACK_LANGUAGE}</dc:language>
    <dc:identifier id="uid">urn:uuid:rito-pinned-fallback-worker</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="book.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
    'OEBPS/Text/chapter.xhtml': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${PINNED_FALLBACK_LANGUAGE}">
  <head><link rel="stylesheet" type="text/css" href="../book.css"/></head>
  <body><p>${PINNED_FALLBACK_QUERY}</p></body>
</html>`),
    'OEBPS/book.css': encoder.encode(`
body {
  margin: 0;
  color: #111;
  font-family: serif;
  font-size: 32px;
  font-style: normal;
  font-weight: 400;
  line-height: 1.5;
}
p { margin: 0; }
`),
  };
  return fflate.zipSync(files);
}

function loadFflate(): FflateApi {
  const requireFromCore = createRequire(resolve(REPOSITORY_ROOT, 'packages/rito/package.json'));
  const value: unknown = requireFromCore('fflate');
  if (value === null || typeof value !== 'object') throw new Error('fflate module is unavailable');
  const candidate = value as Partial<FflateApi>;
  if (typeof candidate.unzipSync !== 'function' || typeof candidate.zipSync !== 'function') {
    throw new Error('fflate module does not expose zipSync and unzipSync');
  }
  return candidate as FflateApi;
}

function requireStoredMimetype(epub: Buffer): void {
  const localFileHeader = epub.readUInt32LE(0);
  const compressionMethod = epub.readUInt16LE(8);
  const fileNameLength = epub.readUInt16LE(26);
  const firstFileName = epub.subarray(30, 30 + fileNameLength).toString('utf8');
  if (localFileHeader !== 0x04034b50 || compressionMethod !== 0 || firstFileName !== 'mimetype') {
    throw new Error('Pinned fallback fixture must start with an uncompressed mimetype entry');
  }
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.mjs':
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function harnessHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Rito pinned fallback harness</title>
    <style>html, body { margin: 0; background: #fff; } canvas { display: block; }</style>
  </head>
  <body></body>
</html>`;
}
