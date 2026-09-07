// Paint-parity instrument driver: renders the fixture corpus through
// both pens, semantic and lowered, and diffs the bitmaps.
//
//   node tools/paint-parity/run.mjs [outRoot]
//
// Lowering:    cargo test rito-core lower_paint_parity_fixtures → <outRoot>/lowered/*.ritodl
// Flutter pen: flutter test packages/rito_flutter/test/paint_parity_render_test.dart
//              (semantic → flutter/, lowered → flutter-lowered/)
// Browser pen: tools/paint-parity/render-browser.mjs (Playwright Chromium; the
//              semantic render is the oracle, the lowered render a lane)
// Verdict:     <outRoot>/report.md via diff.mjs, one section per lane
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
