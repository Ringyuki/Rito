import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { Worker } from 'node:worker_threads';
import { strToU8, zipSync } from 'fflate';

const REFERENCE_BUILD_URL = new URL('../.output/reference-build/', import.meta.url);
const FORBIDDEN_XML_DOM_RE = /\b(?:DOMParser|XMLSerializer)\b|@xmldom/;
const MODULE_IMPORT_RE = /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g;
const NODE_BUILTIN_MODULES = new Set(
  builtinModules.map((specifier) => specifier.replace(/^node:/, '').split('/')[0]),
);
const WORKER_TIMEOUT_MS = 15_000;

function buildEpub() {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OPS/package.opf': strToU8(PACKAGE_XML),
    'OPS/nav.xhtml': strToU8(NAV_XHTML),
    'OPS/chapter.xhtml': strToU8(CHAPTER_XHTML),
  });
}

const CONTAINER_XML = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles>
</container>`;

const PACKAGE_XML = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Worker EPUB</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier>worker-test</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`;

const NAV_XHTML = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body>
</html>`;

const CHAPTER_XHTML = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><style><![CDATA[p { line-height: 1.4; }]]></style></head>
  <body><p>DOM-free &amp; worker-safe.</p></body>
</html>`;

await assertReferenceGraph(new URL('reference/index.mjs', REFERENCE_BUILD_URL), true);
await assertReferenceGraph(new URL('compatibility/web.mjs', REFERENCE_BUILD_URL), false);

const epubBytes = buildEpub();
const epub = epubBytes.buffer.slice(
  epubBytes.byteOffset,
  epubBytes.byteOffset + epubBytes.byteLength,
);
const worker = new Worker(new URL('./dom-free-dist-worker.mjs', import.meta.url), {
  workerData: {
    moduleUrl: new URL('../.output/reference-build/reference/index.mjs', import.meta.url).href,
    epub,
  },
  transferList: [epub],
});

let timeout;
try {
  const completion = Promise.all([once(worker, 'message'), once(worker, 'exit')]);
  const [[result], [exitCode]] = await Promise.race([
    completion,
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`DOM-free worker verification timed out after ${WORKER_TIMEOUT_MS}ms`));
      }, WORKER_TIMEOUT_MS);
    }),
  ]);

  assert.equal(exitCode, 0);
  assert.deepEqual(
    {
      hasDomParser: result.hasDomParser,
      title: result.title,
      toc: result.toc,
    },
    {
      hasDomParser: false,
      title: 'Worker EPUB',
      toc: [{ label: 'Chapter', href: 'chapter.xhtml', children: [] }],
    },
  );
  assert.ok(Number.isInteger(result.pageCount) && result.pageCount > 0);
} finally {
  clearTimeout(timeout);
  await worker.terminate();
}

async function assertReferenceGraph(entryUrl, forbidXmlDom) {
  const pending = [entryUrl];
  const visited = new Set();

  while (pending.length > 0) {
    const moduleUrl = pending.pop();
    if (!moduleUrl || visited.has(moduleUrl.href)) continue;
    visited.add(moduleUrl.href);

    const source = await readFile(moduleUrl, 'utf8');
    const moduleName = moduleUrl.pathname.split('/').at(-1) ?? moduleUrl.href;
    if (forbidXmlDom) {
      assert.doesNotMatch(source, FORBIDDEN_XML_DOM_RE, `${moduleName} bundles an XML DOM parser`);
    }

    for (const match of source.matchAll(MODULE_IMPORT_RE)) {
      const specifier = match[1];
      if (!specifier) continue;
      assert.equal(
        isNodeBuiltinSpecifier(specifier),
        false,
        `${moduleName} imports Node builtin ${specifier}`,
      );
      if (
        specifier.endsWith('.mjs') &&
        (specifier.startsWith('./') || specifier.startsWith('../'))
      ) {
        pending.push(new URL(specifier, moduleUrl));
      }
    }
  }
}

function isNodeBuiltinSpecifier(specifier) {
  const bareSpecifier = specifier.replace(/^node:/, '');
  return NODE_BUILTIN_MODULES.has(bareSpecifier.split('/')[0]);
}
