import { access } from 'node:fs/promises';

const packageDist = new URL('../packages/rito-core-wasm/dist/', import.meta.url);
const requiredFiles = [
  'index.mjs',
  'index.d.mts',
  'decoder.mjs',
  'decoder.d.mts',
  'core-wasm-error-runtime.js',
  'reader-compat-runtime.js',
  'reader-worker-client-runtime.js',
  'runtime-bundle-decoder-runtime.js',
  'frame-command-buffer-decoder-constants.js',
  'frame-command-buffer-decoder-records.js',
  'frame-command-buffer-decoder-runtime.js',
  'frame-command-buffer-decoder-validation.js',
];

const missingFiles = [];
for (const filename of requiredFiles) {
  if (!(await exists(new URL(filename, packageDist)))) missingFiles.push(filename);
}

if (missingFiles.length > 0) {
  const hasRealWasm = await exists(new URL('rito_wasm_bg.wasm', packageDist));
  if (hasRealWasm) {
    throw new Error(
      `The @ritojs/core-wasm dist is incomplete (${missingFiles.join(', ')}). ` +
        'Run the real WASM build instead of replacing it with placeholder output.',
    );
  }

  await import('../packages/rito-core-wasm/scripts/build-placeholder.mjs');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
