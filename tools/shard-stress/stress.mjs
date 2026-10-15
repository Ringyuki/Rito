// Randomized stress for sharded publications on the real wasm engine.
//
// Two reader sessions run in lockstep over the same book: one opened from
// its archive, one from encrypted shards whose loader misbehaves at random
// (fast, slow, failing, stalling). Every navigation step is applied to both
// and must draw the same page; on the sharded side it must also finish
// within a deadline whatever the loader is doing. Image reads made during
// the chaos either return the archive's bytes or fail with the loader's
// fault. Then the loader turns healthy and every image read must succeed
// with the archive's bytes, and after disposal every outstanding read must
// have settled.
//
// Usage: node stress.mjs [steps=400] [seed=1] [book=packages/rito/tests/fixtures/books/book-10.epub]
// Packs with the built @ritojs/pack (`pnpm --filter @ritojs/pack build`).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const CORE_WASM = join(REPO, 'packages/rito-core-wasm');
const { initSync, RitoReaderSession } = await import(join(CORE_WASM, 'dist/rito_wasm.js'));
const { createRitoCoreWasmReaderSessionWorkerClient } = await import(
  join(CORE_WASM, 'src/reader-session-worker-client-runtime.js')
);
const { createRitoCoreWasmReaderSessionWorkerHandler } = await import(
  join(CORE_WASM, 'src/reader-session-worker-runtime.js')
);
const { preparePinnedFontPolicyOpen } = await import(
  join(CORE_WASM, 'src/pinned-font-policy-runtime.js')
);
const { packPublication } = await import(join(REPO, 'packages/pack/dist/index.mjs'));

const STEPS = Number(process.argv[2] ?? 400);
const SEED = Number(process.argv[3] ?? 1);
const BOOK = resolve(REPO, process.argv[4] ?? 'packages/rito/tests/fixtures/books/book-10.epub');
const NAVIGATION_DEADLINE_MS = 3_000;
const SETTLE_DEADLINE_MS = 15_000;

initSync({ module: readFileSync(join(CORE_WASM, 'dist/rito_wasm_bg.wasm')) });

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL ${message}`);
};
process.on('unhandledRejection', (error) => fail(`unhandled rejection: ${String(error)}`));

// Deterministic PRNG so a failing seed reproduces.
let state = SEED >>> 0 || 1;
const random = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
};
const pick = (values) => values[Math.floor(random() * values.length)];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const packed = await pack(BOOK);
const policy = pinnedPolicy();
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

/** The sharded loader's behaviour; `healthy` serves every shard at once. */
const network = { healthy: false, calls: 0, failed: 0, stalled: 0 };
const loadShards = async (ids) => {
  network.calls += 1;
  if (!network.healthy) {
    const roll = random();
    if (roll < 0.15) {
      network.failed += 1;
      await sleep(Math.floor(random() * 50));
      throw new Error(`loader failed for ${ids.join(',')}`);
    }
    if (roll < 0.2) {
      network.stalled += 1;
      await sleep(5_000);
    } else if (roll < 0.45) {
      await sleep(50 + Math.floor(random() * 250));
    }
  }
  return ids.map((id) => ({
    id,
    bytes: packed.shards.get(id).bytes,
    key: packed.shards.get(id).key,
  }));
};

const archive = createRitoCoreWasmReaderSessionWorkerClient(connectedWorker());
let sharded = createRitoCoreWasmReaderSessionWorkerClient(connectedWorker());
const initialRequest = { layout, locator: { href: '' }, textProfile: 'platform-string-runs' };

const archiveBytes = readFileSync(BOOK);
const publicationRequest = (href) => ({ ...initialRequest, locator: { href } });
const firstChapter = firstSpineHref(BOOK);
const archiveOpened = await archive.open(
  archiveBytes.buffer.slice(
    archiveBytes.byteOffset,
    archiveBytes.byteOffset + archiveBytes.byteLength,
  ),
  publicationRequest(firstChapter),
  policy,
);
const spine = (await archive.readPublication()).spine.map((item) => item.href);
await archive.adoptForegroundCandidate(undefined, archiveOpened.artifactId);
const shardOpened = await deadline(
  'open',
  sharded.open(
    { skeleton: packed.skeleton.buffer.slice(0), key: packed.skeletonKey, loadShards },
    publicationRequest(firstChapter),
    policy,
  ),
);
await sharded.adoptForegroundCandidate(undefined, shardOpened.artifactId);
compareDrawn('open', archiveOpened, shardOpened);

const visible = { archive: archiveOpened, sharded: shardOpened };
const reads = [];
const ops = { turn: 0, seek: 0, read: 0, background: 0, reopen: 0 };

for (let step = 0; step < STEPS && failures.length === 0; step += 1) {
  if (step > 0 && step % 60 === 0) {
    await reopen(step);
    continue;
  }
  const roll = random();
  if (roll < 0.5) await turn(step, random() < 0.75 ? 'next' : 'previous');
  else if (roll < 0.65) await seek(step, pick(spine));
  else if (roll < 0.9) readImages(step);
  else await background(step);
}

// The network recovers: every chaos read settles, and every image of the
// page now shown reads with the archive's bytes.
network.healthy = true;
await settleReads('chaos');
for (const href of imageHrefs(visible.sharded)) {
  const read = await deadline(
    `healthy read ${href}`,
    sharded.readResource(visible.sharded.artifactId, 'image', href),
    SETTLE_DEADLINE_MS,
  ).catch((error) => fail(`healthy read ${href} failed: ${String(error)}`));
  if (read) await compareImage(`healthy ${href}`, href, read);
}

// Disposal settles what is still in flight.
readImages('final');
await Promise.all([archive.dispose(), sharded.dispose()]);
await settleReads('disposal');

console.log(
  JSON.stringify({
    seed: SEED,
    steps: STEPS,
    ops,
    loader: network,
    reads: reads.length,
    failures: failures.length,
  }),
);
process.exitCode = failures.length === 0 ? 0 : 1;

/** A fresh sharded session holds no shard: the chaos starts over. */
async function reopen(step) {
  ops.reopen += 1;
  readImages(`${step} before reopen`);
  await sharded.dispose();
  sharded = createRitoCoreWasmReaderSessionWorkerClient(connectedWorker());
  const href = visible.archive.locator.href;
  const [archived, shard] = await Promise.all([
    archive.seek({ href }),
    deadline(
      `step ${step} reopen`,
      sharded.open(
        { skeleton: packed.skeleton.buffer.slice(0), key: packed.skeletonKey, loadShards },
        publicationRequest(href),
        policy,
      ),
    ),
  ]);
  compareDrawn(`step ${step} reopen`, archived, shard);
  const previous = visible.archive;
  await archive.adoptForegroundCandidate(previous.artifactId, archived.artifactId);
  await archive.release(previous.artifactId);
  await sharded.adoptForegroundCandidate(undefined, shard.artifactId);
  visible.archive = archived;
  visible.sharded = shard;
}

async function turn(step, direction) {
  ops.turn += 1;
  const outcome = await Promise.allSettled([
    archive.requestAdjacent(visible.archive.artifactId, direction),
    deadline(`step ${step} turn`, sharded.requestAdjacent(visible.sharded.artifactId, direction)),
  ]);
  await adopt(`step ${step} turn ${direction}`, outcome);
}

async function seek(step, href) {
  ops.seek += 1;
  const outcome = await Promise.allSettled([
    archive.seek({ href }),
    deadline(`step ${step} seek`, sharded.seek({ href })),
  ]);
  await adopt(`step ${step} seek ${href}`, outcome);
}

async function adopt(label, [archived, shard]) {
  if (archived.status !== shard.status) {
    fail(
      `${label}: archive ${archived.status} but shards ${shard.status} (${String(shard.reason ?? archived.reason)})`,
    );
    return;
  }
  if (archived.status === 'rejected') {
    if (archived.reason?.code !== shard.reason?.code) {
      fail(`${label}: archive refused ${archived.reason?.code} but shards ${shard.reason?.code}`);
    }
    return;
  }
  compareDrawn(label, archived.value, shard.value);
  for (const [client, side, candidate] of [
    [archive, 'archive', archived.value],
    [sharded, 'sharded', shard.value],
  ]) {
    const previous = visible[side];
    await client.adoptForegroundCandidate(previous.artifactId, candidate.artifactId);
    visible[side] = candidate;
    await client.release(previous.artifactId);
  }
}

async function background(step) {
  ops.background += 1;
  const [archived, shard] = await Promise.all([
    archive.advanceBackgroundOnce(visible.archive.artifactId, 64),
    deadline(
      `step ${step} background`,
      sharded.advanceBackgroundOnce(visible.sharded.artifactId, 64),
    ),
  ]);
  if (Boolean(archived.artifact) !== Boolean(shard.artifact)) {
    fail(`step ${step} background: candidates differ`);
    return;
  }
  if (!archived.artifact) return;
  compareDrawn(`step ${step} background`, archived.artifact, shard.artifact);
  for (const [client, side, candidate] of [
    [archive, 'archive', archived.artifact],
    [sharded, 'sharded', shard.artifact],
  ]) {
    const previous = visible[side];
    await client.adoptBackgroundCandidate(previous.artifactId, candidate.artifactId);
    visible[side] = candidate;
    await client.release(previous.artifactId);
  }
}

function readImages(step) {
  ops.read += 1;
  const artifactId = visible.sharded.artifactId;
  for (const href of imageHrefs(visible.sharded)) {
    const started = Date.now();
    const read = sharded.readResource(artifactId, 'image', href).then(
      (resource) => compareImage(`step ${step} read ${href}`, href, resource),
      (error) => {
        // A read fails only with the loader's fault, a release or disposal.
        const reason = String(error?.message ?? error);
        if (
          !/loader failed|disposed|not live|unknown-artifact|released|stale/i.test(reason) &&
          !error?.code
        ) {
          fail(`step ${step} read ${href}: unexpected failure ${reason}`);
        }
      },
    );
    reads.push({ read, started, label: `step ${step} read ${href}` });
  }
}

async function settleReads(phase) {
  const pending = reads.splice(0);
  const results = await Promise.race([
    Promise.allSettled(pending.map((entry) => entry.read)).then(() => 'settled'),
    sleep(SETTLE_DEADLINE_MS).then(() => 'timeout'),
  ]);
  if (results === 'timeout')
    fail(`${phase}: ${pending.length} reads did not settle in ${SETTLE_DEADLINE_MS}ms`);
}

async function compareImage(label, href, resource) {
  const expected = packed.images.get(normalizeHref(href));
  if (!expected) return;
  const digest = createHash('sha256').update(resource.bytes).digest('hex');
  if (digest !== expected) fail(`${label}: bytes differ from the archive`);
}

function compareDrawn(label, expected, actual) {
  const drawn = (artifact) =>
    JSON.stringify(
      { locator: artifact.locator, page: artifact.pageIndexes, list: artifact.displayList },
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    );
  if (drawn(expected) !== drawn(actual)) fail(`${label}: pages differ`);
}

function imageHrefs(artifact) {
  return artifact.resources
    .filter((resource) => resource.kind === 'image')
    .map((resource) => resource.href);
}

function normalizeHref(href) {
  return href.replace(/^(\.\.\/)+/, '').replace(/^\//, '');
}

async function deadline(label, promise, ms = NAVIGATION_DEADLINE_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    if (String(error).includes('exceeded')) fail(String(error.message));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function pack(book) {
  const packed = await packPublication(readFileSync(book), { encrypt: true });
  const shards = new Map(
    packed.shards.map((shard) => [shard.id, { bytes: shard.bytes, key: shard.key }]),
  );
  const images = new Map(archiveImageDigests(book));
  return { skeleton: packed.skeleton.bytes, skeletonKey: packed.skeleton.key, shards, images };
}

/** The archive path of the book's first spine document, read from its package document. */
function firstSpineHref(book) {
  const container = execFileSync('unzip', ['-p', book, 'META-INF/container.xml'], {
    encoding: 'utf8',
  });
  const opfPath = /full-path="([^"]+)"/.exec(container)[1];
  const opf = execFileSync('unzip', ['-p', book, opfPath], { encoding: 'utf8' });
  const idref = /<itemref[^>]*idref="([^"]+)"/.exec(opf)[1];
  const item = new RegExp(`<item[^>]*id="${idref}"[^>]*>`).exec(opf)[0];
  const href = /href="([^"]+)"/.exec(item)[1];
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  return `${dir}${href}`;
}

/** Archive path (and its tail after the package directory) to the image's sha256. */
function archiveImageDigests(book) {
  const listing = execFileSync('unzip', ['-Z1', book], { encoding: 'utf8' })
    .split('\n')
    .filter((name) => /\.(jpe?g|png|gif|webp|svg)$/i.test(name));
  const digests = new Map();
  for (const name of listing) {
    const bytes = execFileSync('unzip', ['-p', book, name], { maxBuffer: 1 << 28 });
    const digest = createHash('sha256').update(bytes).digest('hex');
    const parts = name.split('/');
    for (let index = 0; index < parts.length; index += 1) {
      digests.set(parts.slice(index).join('/'), digest);
    }
  }
  return digests;
}

function pinnedPolicy() {
  const font = new Uint8Array(
    readFileSync(join(REPO, 'apps/reader/src/assets/fonts/Tinos-Regular.ttf')),
  );
  const prepared = preparePinnedFontPolicyOpen({
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [
        {
          bytes: font,
          expectedSha256: createHash('sha256').update(font).digest('hex'),
          genericRole: 'serif',
        },
      ],
    },
  });
  return { metadataJson: JSON.stringify(prepared.metadata), faces: prepared.faceBytes };
}

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
