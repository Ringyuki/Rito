import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packDir =
  process.env.RITO_PACK_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'rito-pack-check-'));
const pnpmExecPath = process.env.npm_execpath;
const privateWorkspacePackages = findPrivateWorkspacePackages();
const packedPackages = new Map();

const publicPackages = [
  { name: '@ritojs/core', dir: path.join(workspaceRoot, 'packages/rito') },
  { name: '@ritojs/kit', dir: path.join(workspaceRoot, 'packages/kit') },
  { name: '@ritojs/react', dir: path.join(workspaceRoot, 'packages/react') },
];
const dependencyFields = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'devDependencies',
];
const runtimeDependencyFields = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const coreWasmImportPattern =
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']@ritojs\/core-wasm(?:\/[^"']*)?["']/;

mkdirSync(packDir, { recursive: true });

for (const pkg of publicPackages) {
  const before = new Set(readdirSync(packDir).filter((entry) => entry.endsWith('.tgz')));
  runPnpm(['pack', '--pack-destination', packDir], pkg.dir);

  const tarballPath = findNewTarball(before);
  const contents = listTarball(tarballPath);
  validateRequiredFiles(pkg.name, contents);

  const packedManifest = JSON.parse(readTarText(tarballPath, 'package/package.json'));
  validateDependencyProtocols(pkg.name, packedManifest);
  validatePrivateRuntimeDependencies(pkg.name, packedManifest);

  if (pkg.name === '@ritojs/core') validatePackedCore(tarballPath, contents);

  packedPackages.set(pkg.name, tarballPath);
  console.log(`${pkg.name}: ok (${path.basename(tarballPath)})`);
}

const packedCore = packedPackages.get('@ritojs/core');
if (!packedCore) throw new Error('The @ritojs/core tarball was not produced');
smokeInstallPackedCore(packedCore);

console.log(`Packed tarballs written to ${packDir}`);

function validateRequiredFiles(packageName, contents) {
  if (!contents.includes('package/README.md')) {
    throw new Error(`${packageName}: packed tarball is missing README.md`);
  }
  if (!contents.includes('package/package.json')) {
    throw new Error(`${packageName}: packed tarball is missing package.json`);
  }
  if (!contents.some((entry) => entry.startsWith('package/dist/'))) {
    throw new Error(`${packageName}: packed tarball is missing dist output`);
  }
}

function validateDependencyProtocols(packageName, manifest) {
  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        throw new Error(
          `${packageName}: ${field}.${name} still uses ${spec} in packed package.json`,
        );
      }
    }
  }
}

function validatePrivateRuntimeDependencies(packageName, manifest) {
  for (const field of runtimeDependencyFields) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    for (const name of Object.keys(dependencies)) {
      if (privateWorkspacePackages.has(name)) {
        throw new Error(`${packageName}: ${field}.${name} points to a private workspace package`);
      }
    }
  }
}

function validatePackedCore(tarballPath, contents) {
  const wasmEntry = 'package/dist/rito_wasm_bg.wasm';
  if (!contents.includes(wasmEntry)) {
    throw new Error('@ritojs/core: packed tarball is missing dist/rito_wasm_bg.wasm');
  }
  assertWasm(readTarBuffer(tarballPath, wasmEntry), '@ritojs/core packed artifact');

  const workerEntry = 'package/dist/worker-entry.mjs';
  if (!contents.includes(workerEntry)) {
    throw new Error('@ritojs/core: packed tarball is missing dist/worker-entry.mjs');
  }
  const staticWorkerPattern =
    /new Worker\(new URL\(["']\.\/worker-entry\.mjs["'],\s*import\.meta\.url\)/;
  const workerClients = contents
    .filter(isJavaScriptModule)
    .filter((entry) => staticWorkerPattern.test(readTarText(tarballPath, entry)));
  if (workerClients.length !== 1 || !/^package\/dist\/[^/]+\.mjs$/.test(workerClients[0] ?? '')) {
    throw new Error(
      `@ritojs/core: expected one root dist chunk beside worker-entry.mjs, got ${workerClients.join(', ') || 'none'}`,
    );
  }

  const externalImports = [];
  for (const entry of contents.filter(isJavaScriptModule)) {
    if (coreWasmImportPattern.test(readTarText(tarballPath, entry))) externalImports.push(entry);
  }
  if (externalImports.length > 0) {
    throw new Error(
      `@ritojs/core: packed dist imports private @ritojs/core-wasm modules: ${externalImports.join(', ')}`,
    );
  }
}

function smokeInstallPackedCore(tarballPath) {
  const smokeDir = mkdtempSync(path.join(os.tmpdir(), 'rito-core-install-'));
  try {
    writeFileSync(
      path.join(smokeDir, 'package.json'),
      JSON.stringify({ name: 'rito-core-pack-smoke', private: true, type: 'module' }),
    );
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], smokeDir);

    run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "const core = await import('@ritojs/core');",
          "if (typeof core.createReader !== 'function') throw new Error('missing createReader');",
          "if (typeof core.preloadReaderRuntime !== 'function') throw new Error('missing preloadReaderRuntime');",
          'await core.preloadReaderRuntime();',
        ].join('\n'),
      ],
      smokeDir,
    );

    const installedWasm = path.join(smokeDir, 'node_modules/@ritojs/core/dist/rito_wasm_bg.wasm');
    if (!existsSync(installedWasm)) {
      throw new Error('@ritojs/core: isolated install is missing dist/rito_wasm_bg.wasm');
    }
    assertWasm(readFileSync(installedWasm), '@ritojs/core isolated install');
    smokeBuildPackedCoreWithVite(smokeDir);
    console.log('@ritojs/core: isolated npm install and import ok');
  } finally {
    rmSync(smokeDir, { recursive: true, force: true });
  }
}

function smokeBuildPackedCoreWithVite(smokeDir) {
  writeFileSync(
    path.join(smokeDir, 'index.html'),
    '<!doctype html><script type="module" src="/main.js"></script>',
  );
  writeFileSync(
    path.join(smokeDir, 'main.js'),
    "import { createReader } from '@ritojs/core';\nglobalThis.ritoCreateReader = createReader;\n",
  );

  const vitePackage = fileURLToPath(import.meta.resolve('vite/package.json'));
  const viteCli = path.join(path.dirname(vitePackage), 'bin/vite.js');
  run(process.execPath, [viteCli, 'build', '--logLevel', 'error'], smokeDir);

  const assetsDir = path.join(smokeDir, 'dist/assets');
  const assets = readdirSync(assetsDir);
  const workerAssets = assets.filter((entry) => /^worker-entry-[\w-]+\.js$/.test(entry));
  if (workerAssets.length !== 1) {
    throw new Error(
      `@ritojs/core: isolated Vite build expected one worker-entry asset, got ${workerAssets.join(', ') || 'none'}`,
    );
  }

  const workerAsset = workerAssets[0];
  const workerSource = readFileSync(path.join(assetsDir, workerAsset), 'utf8');
  const wasmAssets = assets.filter((entry) => /^rito_wasm_bg-[\w-]+\.wasm$/.test(entry));
  if (
    workerSource.length < 1_000 ||
    !workerSource.includes('addEventListener("message"') ||
    wasmAssets.length !== 1 ||
    !workerSource.includes(wasmAssets[0] ?? '')
  ) {
    throw new Error(
      '@ritojs/core: isolated Vite worker is empty or does not reference its handler and WASM asset',
    );
  }

  const consumerModules = assets
    .filter((entry) => entry.endsWith('.js') && entry !== workerAsset)
    .map((entry) => readFileSync(path.join(assetsDir, entry), 'utf8'));
  if (!consumerModules.some((source) => source.includes(workerAsset))) {
    throw new Error('@ritojs/core: isolated Vite build does not reference its worker asset');
  }
  if (
    consumerModules.some(
      (source) =>
        source.includes('bindings/browser/reader/worker-main.mjs') ||
        source.includes('worker-main.ts'),
    )
  ) {
    throw new Error('@ritojs/core: isolated Vite build retained a source/dist fallback worker URL');
  }
}

function findPrivateWorkspacePackages() {
  const names = new Set();
  for (const manifestPath of workspaceManifestPaths()) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.private === true && typeof manifest.name === 'string') names.add(manifest.name);
  }
  return names;
}

function workspaceManifestPaths() {
  const manifests = [path.join(workspaceRoot, 'package.json')];
  for (const directory of ['packages', 'apps']) {
    const root = path.join(workspaceRoot, directory);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(root, entry.name, 'package.json');
      if (existsSync(manifest)) manifests.push(manifest);
    }
  }
  return manifests;
}

function assertWasm(bytes, label) {
  const expectedMagic = [0x00, 0x61, 0x73, 0x6d];
  if (bytes.length < 8 || expectedMagic.some((value, index) => bytes[index] !== value)) {
    throw new Error(`${label}: invalid WebAssembly header`);
  }
}

function isJavaScriptModule(entry) {
  return /\.(?:mjs|js|d\.mts|d\.ts)$/.test(entry);
}

function listTarball(tarballPath) {
  return run('tar', ['-tzf', tarballPath], workspaceRoot).split('\n').filter(Boolean);
}

function readTarText(tarballPath, entry) {
  return readTarBuffer(tarballPath, entry).toString('utf8');
}

function readTarBuffer(tarballPath, entry) {
  return execFileSync('tar', ['-xOf', tarballPath, entry], {
    cwd: workspaceRoot,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? error.stderr : '';
    throw new Error(
      `${command} ${args.join(' ')} failed${stderr ? `:\n${String(stderr).trim()}` : ''}`,
      { cause: error },
    );
  }
}

function runPnpm(args, cwd) {
  if (pnpmExecPath) return run(process.execPath, [pnpmExecPath, ...args], cwd);
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
