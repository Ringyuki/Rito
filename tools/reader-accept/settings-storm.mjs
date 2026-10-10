// Settings storm: changes the font size in bursts at every spacing from
// "same task" to "after the book is laid out", with page turns in between,
// and then asks whether the reader ended where it was told to. It passes when
// no session request was refused, the committed size is the last one asked
// for, the layout covers the whole book again, and no call on an artifact
// was sent while another was unanswered.
//
//   BOOK=/path/to.epub URL=http://127.0.0.1:5173/ node settings-storm.mjs
//
// Exits 1 when it does not pass. DUMP=file also writes the reader's debug log.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/reader/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const READER_URL = process.env.URL ?? 'http://127.0.0.1:4317/';
const BOOK = process.env.BOOK;
const VIEW = process.env.VIEW ?? 'desktop';
const viewport =
  VIEW === 'phone' ? { width: 393, height: 760, dsf: 3 } : { width: 1462, height: 749, dsf: 2 };
/** Milliseconds between two changes of one burst. */
const GAPS = (process.env.GAPS ?? '0,4,16,40,90,160,260,400').split(',').map(Number);
const BURST = Number(process.env.BURST ?? 6);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: viewport.width, height: viewport.height },
  deviceScaleFactor: viewport.dsf,
});
await page.goto(READER_URL);
// Without a book, the demo's own one, opened from its shards.
if (BOOK) await page.locator('input[type=file][accept=".epub"]').first().setInputFiles(BOOK);
else await page.getByTestId('load-sharded-demo-button').first().click();
await page.waitForFunction(() => window.__ritoController?.reader?.layoutScope === 'book', null, {
  timeout: 60000,
});
await page.evaluate(() => {
  const c = window.__ritoController;
  c.jumpToSpread(Math.floor(c.reader.totalSpreads * 0.45));
});
await page.waitForTimeout(1500);

let size = 16;
const rounds = [];
for (const gap of GAPS) {
  for (let step = 0; step < BURST; step += 1) {
    size = size >= 26 ? 15 : size + 1;
    await page.evaluate(
      ({ size, turn }) => {
        const c = window.__ritoController;
        c.setTypography({ fontSize: size });
        // Every third change is followed by a page turn, as a reader dragging
        // a slider and then tapping would do.
        if (turn) c.jumpToSpread(Math.min(c.currentSpread + 1, c.reader.totalSpreads - 1));
      },
      { size, turn: step % 3 === 2 },
    );
    if (gap > 0) await page.waitForTimeout(gap);
  }
  // The burst is over: the reader has to arrive at the last size asked for.
  const asked = size;
  const settled = await page
    .waitForFunction(
      (asked) => {
        const reader = window.__ritoController?.reader;
        return reader?.layoutScope === 'book' && reader.getLayoutGeometry().rootFontSize === asked;
      },
      asked,
      { timeout: 15000 },
    )
    .then(
      () => true,
      () => false,
    );
  const state = await page.evaluate(() => {
    const reader = window.__ritoController.reader;
    return { scope: reader.layoutScope, committed: reader.getLayoutGeometry().rootFontSize };
  });
  rounds.push({ gap, asked, settled, ...state });
}

// At rest: what is still unanswered after this is a request that hung, not
// a neighbour being loaded.
await page
  .waitForFunction(
    () => !(window.__ritoReaderDiagnostics?.log?.() ?? []).some((entry) => entry.pending),
    null,
    { timeout: 10000 },
  )
  .catch(() => undefined);
const log = await page.evaluate(() => window.__ritoReaderDiagnostics?.log?.() ?? []);
const refused = log.filter((entry) => entry.failed === true);
const unanswered = log.filter((entry) => entry.pending === true);
const warnings = log.filter((entry) => entry.kind === 'warn' || entry.kind === 'error');
const byRefusal = new Map();
for (const entry of refused) {
  const key = `${entry.kind}: ${String(entry.result).slice(0, 90)}`;
  byRefusal.set(key, (byRefusal.get(key) ?? 0) + 1);
}
// One operation on artifacts at a time: a call that creates, adopts,
// commits or releases an artifact is never sent while another is
// unanswered (releases may be sent together).
const OWNING = new Set([
  'requestArtifact',
  'adoptForegroundCandidate',
  'adoptBackgroundCandidate',
  'advanceBackgroundOnce',
  'peekSpread',
  'commitPeekedArtifact',
  'release',
]);
const owning = log
  .filter((entry) => OWNING.has(entry.kind) && entry.ms !== undefined)
  .map((entry) => ({ kind: entry.kind, from: entry.at, to: entry.at + entry.ms }))
  .sort((a, b) => a.from - b.from);
const interleaved = [];
owning.forEach((call, index) => {
  for (const later of owning.slice(index + 1)) {
    // Timestamps are kept to a tenth of a millisecond.
    if (later.from >= call.to - 0.3) break;
    if (call.kind === 'release' && later.kind === 'release') continue;
    interleaved.push(`${later.kind} at ${String(later.from)} inside ${call.kind}`);
  }
});
const ok =
  rounds.every((round) => round.settled) &&
  refused.length === 0 &&
  unanswered.length === 0 &&
  warnings.length === 0 &&
  interleaved.length === 0;
console.log(
  JSON.stringify(
    {
      ok,
      url: READER_URL,
      view: VIEW,
      requests: log.length,
      refused: refused.length,
      unanswered: unanswered.length,
      warnings: warnings.length,
      artifactCalls: owning.length,
      interleaved: interleaved.length,
      refusals: Object.fromEntries(byRefusal),
      interleavings: interleaved.slice(0, 10),
      rounds,
    },
    null,
    2,
  ),
);
if (process.env.DUMP) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.DUMP, await page.evaluate(() => window.__ritoDebugReport?.() ?? ''));
}
await browser.close();
process.exit(ok ? 0 : 1);
