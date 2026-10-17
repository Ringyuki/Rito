// A sharded publication in the real reader: real worker, real wasm engine,
// real canvas. The shards are packed by the repository's own @ritojs/pack
// (its built `rito-pack` command) and served through an intercepted route the test controls, so the network
// can be held, failed or released at will. Every page is compared pixel for
// pixel with the same book opened from its archive in a second tab.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import {
  currentSpread,
  readerCanvasChecksum,
  readerNumberAttribute,
  stableReaderCanvasChecksum,
  waitForReaderTransitionEnd,
} from './reader-page-harness';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const BOOK = resolve(REPO, 'packages/rito/tests/fixtures/books/book-10.epub');
const LOAD_TIMEOUT_MS = 90_000;
const VIEWPORT = { width: 900, height: 700 };
const SPREADS_COMPARED = 10;

interface PackedBook {
  readonly archive: string;
  readonly skeleton: string;
  readonly skeletonKey: string;
  readonly shards: ReadonlyMap<number, { readonly bytes: Buffer; readonly key: string }>;
}

/** What the intercepted shard route does with each request. */
class ShardNetwork {
  mode: 'hold' | 'serve' | 'fail' = 'serve';
  /** How long a served shard takes to arrive. */
  latencyMs = 0;
  readonly requested: number[] = [];
  readonly served: number[] = [];
  private held: (() => Promise<void>)[] = [];

  constructor(private readonly book: PackedBook) {}

  async install(page: Page): Promise<void> {
    await page.route('**/__rito-shards/*', async (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').pop());
      this.requested.push(id);
      const respond = (): Promise<void> => this.respond(route, id);
      if (this.mode === 'hold') {
        this.held.push(respond);
        return;
      }
      await respond();
    });
  }

  /** Answers every held request and every later one as `mode` says. */
  async settle(mode: 'serve' | 'fail'): Promise<void> {
    this.mode = mode;
    const held = this.held;
    this.held = [];
    await Promise.all(held.map((respond) => respond()));
  }

  get heldCount(): number {
    return this.held.length;
  }

  private async respond(route: Route, id: number): Promise<void> {
    if (this.mode === 'fail') {
      await route.fulfill({ status: 503, body: 'shard server down' });
      return;
    }
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    const shard = this.book.shards.get(id);
    if (!shard) {
      await route.fulfill({ status: 404, body: `no shard ${String(id)}` });
      return;
    }
    this.served.push(id);
    await route.fulfill({
      status: 200,
      body: shard.bytes,
      headers: { 'content-type': 'application/octet-stream', 'x-shard-key': shard.key },
    });
  }
}

let book: PackedBook;
let packDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  packDir = mkdtempSync(join(tmpdir(), 'rito-e2e-shards-'));
  // Built with the rest of the workspace (`pnpm run build`).
  execFileSync(
    process.execPath,
    [resolve(REPO, 'packages/pack/dist/cli.mjs'), BOOK, packDir, '--encrypt'],
    { cwd: REPO, stdio: 'inherit' },
  );
  const manifest = JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8')) as {
    readonly shards: readonly { readonly id: number; readonly file: string }[];
  };
  const keys = (
    JSON.parse(readFileSync(join(packDir, 'keys.json'), 'utf8')) as {
      readonly keys: Readonly<Record<string, string>>;
    }
  ).keys;
  book = {
    archive: readFileSync(BOOK).toString('base64'),
    skeleton: readFileSync(join(packDir, 'skeleton.rshd')).toString('base64'),
    skeletonKey: keys['0'] ?? '',
    shards: new Map(
      manifest.shards.map((shard) => [
        shard.id,
        { bytes: readFileSync(join(packDir, shard.file)), key: keys[String(shard.id)] ?? '' },
      ]),
    ),
  };
});

test.afterAll(() => {
  rmSync(packDir, { recursive: true, force: true });
});

test.describe('reader with a sharded publication', () => {
  test('opens and turns pages while no shard can arrive, text pages already exact', async ({
    browser,
  }) => {
    const { context, sharded, archive, network } = await openPair(browser, 'hold');
    try {
      // Opened, and every page with no image is already the archive's page.
      const total = await readerNumberAttribute(sharded, 'data-total-spreads');
      expect(total).toBeGreaterThan(SPREADS_COMPARED);
      let exact = 0;
      for (let index = 0; index < SPREADS_COMPARED; index += 1) {
        const expected = await spreadChecksum(archive, index);
        if ((await spreadChecksum(sharded, index)) === expected) exact += 1;
      }
      expect(exact).toBeGreaterThan(0);
      expect(network.served).toEqual([]);
      expect(network.heldCount).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('draws every page exactly as the archive once its shards arrive', async ({ browser }) => {
    const { context, sharded, archive } = await openPair(browser, 'serve');
    try {
      for (let index = 0; index < SPREADS_COMPARED; index += 1) {
        const expected = await spreadChecksum(archive, index);
        await expectSpreadToBecome(sharded, index, expected);
      }
    } finally {
      await context.close();
    }
  });

  test('an image page shows its loading placeholder, its broken placeholder when the network fails, and the image once it is back', async ({
    browser,
  }) => {
    const { context, sharded, archive, network } = await openPair(browser, 'hold');
    try {
      const imageSpread = await firstSpreadAwaitingImages(sharded, archive);
      const expected = await spreadChecksum(archive, imageSpread);
      await sharded.waitForTimeout(1_300);
      const loading = await stableReaderCanvasChecksum(sharded);
      expect(loading, 'past a second the loading placeholder shows').not.toBe(expected);

      await network.settle('fail');
      await expect.poll(() => readerCanvasChecksum(sharded), { timeout: 15_000 }).not.toBe(loading);
      const broken = await stableReaderCanvasChecksum(sharded);
      expect(broken, 'the broken placeholder replaces the loading one').not.toBe(expected);

      // The network is back: the page, still shown, reads its image again.
      network.mode = 'serve';
      await expect
        .poll(() => readerCanvasChecksum(sharded), {
          timeout: 30_000,
          message: 'the shown page recovers its image',
        })
        .toBe(expected);
    } finally {
      await context.close();
    }
  });

  test('the page shown at open draws its image when the shard arrives after the whole book is laid out', async ({
    browser,
  }) => {
    // The first page reads its image while only its chapter is laid out;
    // the whole-book layout replaces that page before the slow shard
    // arrives, and the page now shown must still get its image.
    const { context, sharded, archive } = await openPair(browser, 'serve', 1_000);
    try {
      const expected = await spreadChecksum(archive, 0);
      expect(await currentSpread(sharded)).toBe(0);
      await expect
        .poll(() => readerCanvasChecksum(sharded), {
          timeout: 30_000,
          message: 'the first page draws its image',
        })
        .toBe(expected);
      const failures = await sharded.evaluate(
        () => (globalThis as { __ritoImageFailures?: unknown[] }).__ritoImageFailures ?? [],
      );
      expect(failures).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('a layout change while shards are on their way still lands on the archive pages', async ({
    browser,
  }) => {
    const { context, sharded, archive, network } = await openPair(browser, 'hold');
    try {
      await spreadChecksum(sharded, 2);
      const before = await readerNumberAttribute(sharded, 'data-total-spreads');
      const resized = { width: 760, height: 620 };
      await sharded.setViewportSize(resized);
      await archive.setViewportSize(resized);
      // The new layout lands while every shard is still on its way.
      await waitForRelayout(sharded, before);
      await waitForRelayout(archive, before);
      expect(network.heldCount).toBeGreaterThan(0);
      await network.settle('serve');
      for (let index = 0; index < SPREADS_COMPARED; index += 1) {
        const expected = await spreadChecksum(archive, index);
        await expectSpreadToBecome(sharded, index, expected);
      }
    } finally {
      await context.close();
    }
  });
});

const T0 = Date.now();
const trace = (m: string): void => {
  console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);
};
async function openPair(
  browser: Browser,
  networkMode: 'hold' | 'serve',
  latencyMs = 0,
): Promise<{
  readonly context: BrowserContext;
  readonly sharded: Page;
  readonly archive: Page;
  readonly network: ShardNetwork;
}> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const network = new ShardNetwork(book);
  network.mode = networkMode;
  network.latencyMs = latencyMs;
  const archive = await freshReader(context);
  await archive.evaluate(async (archiveBase64) => {
    const bytes = Uint8Array.from(atob(archiveBase64), (char) => char.charCodeAt(0));
    await (window as unknown as { __ritoLoad: (data: ArrayBuffer) => Promise<void> }).__ritoLoad(
      bytes.buffer,
    );
  }, book.archive);
  trace('archive load called');
  await waitForLoaded(archive);
  trace('archive loaded');
  const sharded = await freshReader(context);
  await network.install(sharded);
  await sharded.evaluate(
    async ({ skeleton, skeletonKey }) => {
      const fromBase64 = (value: string): Uint8Array =>
        Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
      const fromHex = (value: string): Uint8Array =>
        Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
      const load = (window as unknown as { __ritoLoad: (data: unknown) => Promise<void> })
        .__ritoLoad;
      await load({
        skeleton: fromBase64(skeleton).buffer,
        key: fromHex(skeletonKey),
        loadShards: (ids: readonly number[]) =>
          Promise.all(
            ids.map(async (id) => {
              const response = await fetch(`/__rito-shards/${String(id)}`);
              if (!response.ok) throw new Error(`shard ${String(id)}: ${String(response.status)}`);
              return {
                id,
                bytes: new Uint8Array(await response.arrayBuffer()),
                key: fromHex(response.headers.get('x-shard-key') ?? ''),
              };
            }),
          ),
      });
    },
    { skeleton: book.skeleton, skeletonKey: book.skeletonKey },
  );
  trace('sharded load called');
  await waitForLoaded(sharded);
  trace('sharded loaded');
  return { context, sharded, archive, network };
}

async function freshReader(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(page.getByTestId('reader-empty')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => typeof (window as { __ritoLoad?: unknown }).__ritoLoad))
    .toBe('function');
  return page;
}

async function waitForLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-loaded', 'true', {
    timeout: LOAD_TIMEOUT_MS,
  });
  await waitForLayout(page);
}

async function waitForLayout(page: Page): Promise<void> {
  trace(`layout? total=${String(await readerNumberAttribute(page, 'data-total-spreads'))}`);
  await expect
    .poll(() => readerNumberAttribute(page, 'data-total-spreads'), { timeout: LOAD_TIMEOUT_MS })
    .toBeGreaterThan(SPREADS_COMPARED);
  await waitForReaderTransitionEnd(page);
}

async function waitForRelayout(page: Page, previousTotal: number): Promise<void> {
  await expect
    .poll(() => readerNumberAttribute(page, 'data-total-spreads'), { timeout: LOAD_TIMEOUT_MS })
    .not.toBe(previousTotal);
  await waitForReaderTransitionEnd(page);
}

async function spreadChecksum(page: Page, index: number): Promise<string> {
  trace(`spread ${String(index)} start`);
  await page.evaluate((target) => {
    (
      window as unknown as { __ritoController: { goToSpread(index: number): void } }
    ).__ritoController.goToSpread(target);
  }, index);
  const arrived = await expect
    .poll(() => currentSpread(page), { timeout: 8_000 })
    .toBe(index)
    .then(
      () => true,
      () => false,
    );
  if (!arrived) {
    const dump = await page.evaluate(async (target) => {
      const diag = (
        globalThis as { __ritoReaderDiagnostics?: Record<string, (...a: unknown[]) => unknown> }
      ).__ritoReaderDiagnostics;
      const frame = await Promise.race([
        Promise.resolve(diag?.['frame']?.(target)).then((f) => (f ? 'loaded' : 'undefined')),
        new Promise((r) =>
          setTimeout(() => {
            r('frame load STILL PENDING');
          }, 3000),
        ),
      ]);
      const scope = globalThis as Record<string, unknown>;
      return {
        frame,
        current: document
          .querySelector('[data-testid=reader-shell]')
          ?.getAttribute('data-current-spread'),
        transitioning: document
          .querySelector('[data-testid=reader-shell]')
          ?.getAttribute('data-transitioning'),
        decode: scope['__ritoFrameDecodeFailures'],
        windowFaults: scope['__ritoFrameWindowFaults'],
        renderFailures: scope['__ritoRenderFailures'],
        degraded: (scope['__ritoDegradedSpreadPaints'] as unknown[] | undefined)?.slice(-3),
      };
    }, index);
    trace(`spread ${String(index)} DID NOT ARRIVE ${JSON.stringify(dump)}`);
    throw new Error(`spread ${String(index)} did not arrive`);
  }
  await waitForReaderTransitionEnd(page);
  trace(`spread ${String(index)} arrived`);
  return stableReaderCanvasChecksum(page);
}

async function expectSpreadToBecome(page: Page, index: number, expected: string): Promise<void> {
  await spreadChecksum(page, index);
  await expect
    .poll(() => readerCanvasChecksum(page), {
      timeout: 30_000,
      message: `spread ${String(index)} matches the archive`,
    })
    .toBe(expected);
}

/** The first spread that, with no shard delivered, differs from the archive. */
async function firstSpreadAwaitingImages(sharded: Page, archive: Page): Promise<number> {
  for (let index = 0; index < SPREADS_COMPARED; index += 1) {
    const expected = await spreadChecksum(archive, index);
    if ((await spreadChecksum(sharded, index)) !== expected) return index;
  }
  throw new Error('no spread in range draws an image');
}
