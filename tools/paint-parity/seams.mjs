// Scroll-seam instrument driver: neighbouring scrolled windows, lowered by
// the engine one by one and as one run, rastered by every pen and stacked
// against each other.
//
//   node tools/paint-parity/seams.mjs [outRoot]
//
// Lowering:    cargo test rito-core lower_scroll_seam_fixtures → <outRoot>/lowered/seam-*
// Flutter pen: flutter test packages/rito_flutter/test/paint_parity_render_test.dart → flutter/
// Browser pen: tools/paint-parity/render-browser.mjs → browser*/
// Verdict:     <outRoot>/seam-report.md via seam-diff.mjs
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const outRoot = path.resolve(process.argv[2] ?? path.join(HERE, 'out-seams'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
  }
}

rmSync(outRoot, { recursive: true, force: true });
run(
  'cargo',
  ['test', '-p', 'rito-core', '--lib', 'lower_scroll_seam_fixtures', '--', '--nocapture'],
  { cwd: REPO, env: { ...process.env, RITO_SCROLL_SEAMS_OUT: outRoot } },
);
// The tester talks to its own loopback server, which a proxy must not take.
const loopback = '127.0.0.1,localhost,::1';
run('flutter', ['test', 'test/paint_parity_render_test.dart', '--reporter', 'compact'], {
  cwd: path.join(REPO, 'packages/rito_flutter'),
  env: {
    ...process.env,
    NO_PROXY: loopback,
    no_proxy: loopback,
    RITO_PAINT_PARITY_OUT: outRoot,
  },
});
run(process.execPath, [path.join(HERE, 'render-browser.mjs'), outRoot]);
run(process.execPath, [path.join(HERE, 'seam-diff.mjs'), outRoot]);
