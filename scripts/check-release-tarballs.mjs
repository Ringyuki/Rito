import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packDir =
  process.env.RITO_PACK_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'rito-pack-check-'));
const pnpmExecPath = process.env.npm_execpath;

const publicPackages = [
  { name: '@ritojs/core', dir: path.join(workspaceRoot, 'packages/rito') },
  { name: '@ritojs/kit', dir: path.join(workspaceRoot, 'packages/kit') },
  { name: '@ritojs/react', dir: path.join(workspaceRoot, 'packages/react') },
];

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runPnpm(args, cwd) {
  if (pnpmExecPath) {
    return run(process.execPath, [pnpmExecPath, ...args], cwd);
  }
  return run('pnpm', args, cwd);
}

function findNewTarball(before) {
  const after = new Set(readdirSync(packDir).filter((entry) => entry.endsWith('.tgz')));
  const created = [...after].filter((entry) => !before.has(entry));
  if (created.length !== 1) {
    throw new Error(`Expected exactly one new tarball in ${packDir}, got ${created.length}`);
  }
  return path.join(packDir, created[0]);
}

mkdirSync(packDir, { recursive: true });

for (const pkg of publicPackages) {
  const before = new Set(readdirSync(packDir).filter((entry) => entry.endsWith('.tgz')));
  runPnpm(['pack', '--pack-destination', packDir], pkg.dir);

  const tarballPath = findNewTarball(before);
  const contents = run('tar', ['-tzf', tarballPath], workspaceRoot).split('\n').filter(Boolean);

  if (!contents.includes('package/README.md')) {
    throw new Error(`${pkg.name}: packed tarball is missing README.md`);
  }
  if (!contents.includes('package/package.json')) {
    throw new Error(`${pkg.name}: packed tarball is missing package.json`);
  }
  if (!contents.some((entry) => entry.startsWith('package/dist/'))) {
    throw new Error(`${pkg.name}: packed tarball is missing dist output`);
  }

  const packedManifest = JSON.parse(
    run('tar', ['-xOf', tarballPath, 'package/package.json'], workspaceRoot),
  );
  const dependencyFields = [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
    'devDependencies',
  ];

  for (const field of dependencyFields) {
    const deps = packedManifest[field];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        throw new Error(`${pkg.name}: ${field}.${name} still uses ${spec} in packed package.json`);
      }
    }
  }

  console.log(`${pkg.name}: ok (${path.basename(tarballPath)})`);
}

console.log(`Packed tarballs written to ${packDir}`);
