import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const eslint = resolve(root, 'node_modules/eslint/bin/eslint.js');
const extraArgs = parseArgs(process.argv.slice(2));
// benchmarks/ is a local-only spike tree that is not committed; lint it
// when present so clean clones (CI) do not fail on the missing pattern.
const scopes = [
  [
    'eslint.config.mjs',
    'scripts',
    ...(existsSync(resolve(root, 'benchmarks')) ? ['benchmarks'] : []),
  ],
  ['packages/rito'],
  ['packages/rito-core-wasm'],
  ['packages/kit'],
  ['packages/react'],
  ['apps/reader'],
];

for (const [index, scope] of scopes.entries()) {
  process.stderr.write(`[eslint ${index + 1}/${scopes.length}] ${scope.join(' ')}\n`);
  const result = await runScope(scope);
  if (result !== 0) {
    process.exitCode = result;
    break;
  }
}

function runScope(scope) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=2304', eslint, ...scope, ...extraArgs],
      { cwd: root, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolveProcess(code ?? (signal ? 1 : 0));
    });
  });
}

function parseArgs(values) {
  if (values.length === 0) return [];
  if (values.length === 1 && values[0] === '--fix') return values;
  throw new Error('usage: node scripts/run-eslint-bounded.mjs [--fix]');
}
