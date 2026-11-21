/**
 * Page turns move by the engine (`@ritojs/core`'s turn motion), as they do
 * once a reader has opened: the engine built for the browser is loaded
 * here, before any test makes a controller or a driver.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTurnMotion } from '@ritojs/core';
import { initRitoCoreWasmSync } from '@ritojs/core-wasm';

// A path, not a URL: a test on happy-dom has the page's URL, which the file system refuses.
const WASM = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../rito-core-wasm/dist/rito_wasm_bg.wasm',
);

initRitoCoreWasmSync({ module: readFileSync(WASM) });
await loadTurnMotion();
