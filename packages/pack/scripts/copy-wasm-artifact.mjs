// Copies the pack module next to the bundled entries, which load it and
// their worker relative to their own URL, and checks that it is real.
import { copyFile, readFile } from 'node:fs/promises';

const source = new URL('../../rito-core-wasm/dist/rito_pack_bg.wasm', import.meta.url);
const target = new URL('../dist/rito_pack_bg.wasm', import.meta.url);

try {
  await copyFile(source, target);
} catch (error) {
  throw new Error(
    '@ritojs/pack needs the real pack module: run `pnpm --filter @ritojs/core-wasm build`',
    { cause: error },
  );
}

const bytes = await readFile(target);
const magic = [0x00, 0x61, 0x73, 0x6d];
if (bytes.length < 8 || magic.some((value, index) => bytes[index] !== value)) {
  throw new Error('@ritojs/pack: dist/rito_pack_bg.wasm is not a WebAssembly module');
}
for (const entry of ['index.mjs', 'worker.mjs', 'cli.mjs']) {
  await readFile(new URL(`../dist/${entry}`, import.meta.url));
}
