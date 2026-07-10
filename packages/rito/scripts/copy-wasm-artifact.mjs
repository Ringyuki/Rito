import { copyFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = new URL('../../rito-core-wasm/dist/rito_wasm_bg.wasm', import.meta.url);
const target = new URL('../dist/rito_wasm_bg.wasm', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const coreWasmImportPattern =
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']@ritojs\/core-wasm(?:\/[^"']*)?["']/;

await copyFile(source, target);

const [sourceBytes, targetBytes] = await Promise.all([readFile(source), readFile(target)]);
assertWasm(targetBytes);
if (!sourceBytes.equals(targetBytes)) {
  throw new Error('Copied @ritojs/core WASM artifact does not match the core-wasm build output');
}

const modules = await collectModules(dist);
const externalImports = [];
const wasmReferences = [];
for (const moduleUrl of modules) {
  const contents = await readFile(moduleUrl, 'utf8');
  if (coreWasmImportPattern.test(contents)) externalImports.push(relativeToDist(moduleUrl));
  if (contents.includes('rito_wasm_bg.wasm')) wasmReferences.push(relativeToDist(moduleUrl));
}

if (externalImports.length > 0) {
  throw new Error(
    `@ritojs/core dist still imports private @ritojs/core-wasm modules: ${externalImports.join(', ')}`,
  );
}
if (wasmReferences.length === 0) {
  throw new Error('@ritojs/core dist does not reference its copied rito_wasm_bg.wasm artifact');
}

const nestedWasmReferences = wasmReferences.filter((filename) => path.dirname(filename) !== '.');
if (nestedWasmReferences.length > 0) {
  throw new Error(
    `Nested chunks resolve rito_wasm_bg.wasm from the wrong directory: ${nestedWasmReferences.join(', ')}`,
  );
}

async function collectModules(directory) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) {
      modules.push(...(await collectModules(entryUrl)));
    } else if (/\.(?:mjs|js|d\.mts|d\.ts)$/.test(entry.name)) {
      modules.push(entryUrl);
    }
  }
  return modules;
}

function assertWasm(bytes) {
  const expectedMagic = [0x00, 0x61, 0x73, 0x6d];
  if (bytes.length < 8 || expectedMagic.some((value, index) => bytes[index] !== value)) {
    throw new Error('@ritojs/core WASM artifact is missing the WebAssembly magic header');
  }
}

function relativeToDist(moduleUrl) {
  return path.relative(fileURLToPath(dist), fileURLToPath(moduleUrl));
}
