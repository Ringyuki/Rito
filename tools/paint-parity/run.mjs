// Paint-parity instrument driver: lowers the fixture corpus in the
// engine, blits the bytes through both production pens, and diffs the
// bitmaps.
//
//   node tools/paint-parity/run.mjs [outRoot]
//
// Lowering:    cargo test rito-core lower_paint_parity_fixtures → <outRoot>/lowered/*.ritodl
// Flutter pen: flutter test packages/rito_flutter/test/paint_parity_render_test.dart → flutter/
// Browser pen: tools/paint-parity/render-browser.mjs (Playwright Chromium) → browser/,
//              the oracle
// Verdict:     <outRoot>/report.md via diff.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const outRoot = process.argv[2] ?? path.join(HERE, 'out');
const fixtureDir = path.join(HERE, 'fixtures');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
  }
}

run(
  'cargo',
  ['test', '-p', 'rito-core', '--lib', 'lower_paint_parity_fixtures', '--', '--nocapture'],
  {
    cwd: REPO,
    env: {
      ...process.env,
      RITO_PAINT_PARITY_OUT: outRoot,
      RITO_PAINT_PARITY_FIXTURES: fixtureDir,
    },
  },
);
run('flutter', ['test', 'test/paint_parity_render_test.dart', '--reporter', 'compact'], {
  cwd: path.join(REPO, 'packages/rito_flutter'),
  env: {
    ...process.env,
    RITO_PAINT_PARITY_OUT: outRoot,
    RITO_PAINT_PARITY_FIXTURES: fixtureDir,
  },
});
run(process.execPath, [path.join(HERE, 'render-browser.mjs'), outRoot]);
run(process.execPath, [path.join(HERE, 'diff.mjs'), outRoot]);
