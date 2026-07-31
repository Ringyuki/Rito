import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const packageRoot = resolve(repositoryRoot, 'packages/rito_flutter');
const outputRoot = resolve(packageRoot, 'native');
const stagingRoot = resolve(packageRoot, `.native-stage-${process.pid}`);

function run(command, arguments_) {
  return execFileSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function localPackageClosure(metadata, rootName) {
  const byDirectory = new Map(
    metadata.packages.map((package_) => [dirname(resolve(package_.manifest_path)), package_]),
  );
  const rootPackage = metadata.packages.find((package_) => package_.name === rootName);
  if (rootPackage === undefined) {
    throw new Error(`Cargo metadata does not contain ${rootName}.`);
  }

  const pending = [rootPackage];
  const closure = new Map();
  while (pending.length > 0) {
    const package_ = pending.pop();
    if (package_ === undefined || closure.has(package_.manifest_path)) {
      continue;
    }
    closure.set(package_.manifest_path, package_);
    for (const dependency of package_.dependencies) {
      if (typeof dependency.path !== 'string') {
        continue;
      }
      const localPackage = byDirectory.get(resolve(dependency.path));
      if (localPackage === undefined) {
        throw new Error(`Local dependency ${dependency.name} is absent from Cargo metadata.`);
      }
      pending.push(localPackage);
    }
  }
  return [...closure.values()];
}

function repositoryPath(path) {
  const absolutePath = resolve(path);
  const repositoryRelativePath = relative(repositoryRoot, absolutePath);
  if (repositoryRelativePath.startsWith(`..${sep}`) || isAbsolute(repositoryRelativePath)) {
    throw new Error(`Refusing to package a path outside the repository: ${path}`);
  }
  return repositoryRelativePath.split(sep).join('/');
}

function vendoredWorkspaceManifest(cratePaths) {
  const source = readFileSync(resolve(repositoryRoot, 'Cargo.toml'), 'utf8');
  const members = cratePaths.map((path) => `  "${path}",`).join('\n');
  const replacement = `members = [\n${members}\n]`;
  const pattern = /members = \[[\s\S]*?\n\]/;
  if (!pattern.test(source)) {
    throw new Error('Unable to locate the root Cargo workspace members.');
  }
  return source.replace(pattern, replacement);
}

function trackedFiles(cratePaths) {
  const output = run('git', ['ls-files', '-z', '--', ...cratePaths]);
  return output.split('\0').filter((path) => path.length > 0);
}

function copyRepositoryFile(path, targetRoot) {
  const source = resolve(repositoryRoot, path);
  const target = resolve(targetRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function prepare() {
  const metadata = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--no-deps']));
  const packages = localPackageClosure(metadata, 'rito-ffi');
  const cratePaths = packages
    .map((package_) => repositoryPath(dirname(package_.manifest_path)))
    .sort();
  const files = trackedFiles(cratePaths);
  if (files.length === 0) {
    throw new Error('The rito-ffi source closure contains no tracked files.');
  }

  rmSync(stagingRoot, { force: true, recursive: true });
  mkdirSync(stagingRoot, { recursive: true });
  try {
    writeFileSync(resolve(stagingRoot, 'Cargo.toml'), vendoredWorkspaceManifest(cratePaths));
    for (const path of ['Cargo.lock', 'rust-toolchain.toml', 'LICENSE']) {
      copyRepositoryFile(path, stagingRoot);
    }
    for (const path of files) {
      copyRepositoryFile(path, stagingRoot);
    }

    const manifestPath = resolve(stagingRoot, 'Cargo.toml');
    run('cargo', ['metadata', '--format-version', '1', '--manifest-path', manifestPath]);
    run('cargo', [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--manifest-path',
      manifestPath,
    ]);

    rmSync(outputRoot, { force: true, recursive: true });
    renameSync(stagingRoot, outputRoot);
    copyFileSync(resolve(repositoryRoot, 'LICENSE'), resolve(packageRoot, 'LICENSE'));
  } catch (error) {
    rmSync(stagingRoot, { force: true, recursive: true });
    throw error;
  }

  process.stdout.write(
    `Prepared rito_flutter ${packages.length}-crate Rust closure ` +
      `(${files.length} tracked files).\n`,
  );
}

prepare();
