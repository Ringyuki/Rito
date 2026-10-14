// Opens a book on the WASM module the build just produced, through the
// session worker's handler and its client wired together on this thread:
// what a page does, without a browser. Fails the build that ships a module
// the runtime beside it cannot drive.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const repo = new URL('../../../', import.meta.url);
const { initSync, RitoReaderSession } = await import(new URL('rito_wasm.js', dist).href);
const {
  createRitoCoreWasmReaderSessionWorkerClient,
  createRitoCoreWasmReaderSessionWorkerHandler,
} = await import(new URL('decoder.mjs', dist).href);

initSync({ module: readFileSync(new URL('rito_wasm_bg.wasm', dist)) });

const font = new Uint8Array(
  readFileSync(new URL('apps/reader/src/assets/fonts/Tinos-Regular.ttf', repo)),
);
const policy = {
  metadataJson: JSON.stringify({
    schemaVersion: 1,
    faces: [
      { expectedSha256: createHash('sha256').update(font).digest('hex'), genericRole: 'serif' },
    ],
  }),
  faces: [font],
};
const book = readFileSync(new URL('packages/rito/tests/fixtures/books/book-10.epub', repo));
const layout = {
  renderRatio: 1,
  viewportWidth: 420,
  viewportHeight: 640,
  marginTop: 24,
  marginRight: 24,
  marginBottom: 24,
  marginLeft: 24,
  spreadMode: 'single',
  firstPageAlone: true,
  spreadGap: 0,
  rootFontSize: 16,
};

const client = createRitoCoreWasmReaderSessionWorkerClient(connectedWorker());
const opened = await client.open(
  book.buffer.slice(book.byteOffset, book.byteOffset + book.byteLength),
  { layout, locator: { href: '' }, textProfile: 'platform-string-runs' },
  policy,
);
await client.adoptForegroundCandidate(undefined, opened.artifactId);
const publication = await client.readPublication();
const page = await client.navigation({ kind: 'layout', artifactId: opened.artifactId });
if (
  publication.spine.length === 0 ||
  page.kind !== 'layout' ||
  page.layout.pageCount === 0 ||
  opened.displayList.commandCount === 0
) {
  throw new Error('The built WASM module opened a book without a page to show');
}
await client.dispose();
console.log(
  `wasm smoke: ${String(publication.spine.length)} spine items, first chapter ` +
    `${String(page.layout.pageCount)} pages, ${String(opened.displayList.commandCount)} commands`,
);

/** A client transport wired straight into a real worker handler on this thread. */
function connectedWorker() {
  const listeners = new Map();
  const scope = {
    addEventListener(type, listener) {
      if (type === 'message') scope.listener = listener;
    },
    postMessage(message) {
      queueMicrotask(() => listeners.get('message')?.({ data: message }));
    },
  };
  createRitoCoreWasmReaderSessionWorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSession,
  });
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    postMessage(message) {
      queueMicrotask(() => scope.listener({ data: message }));
    },
    terminate() {},
  };
}
