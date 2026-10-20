import { existsSync, readFileSync } from 'node:fs';

import { loadPaperTurnModel, type PaperTurnModel } from '@ritojs/core';
import { initRitoCoreWasmSync } from '@ritojs/core-wasm';

const WASM = new URL('../../../rito-core-wasm/dist/rito_wasm_bg.wasm', import.meta.url);

/** Whether the engine is built here: the placeholder build has none. */
export const engineBuilt = existsSync(WASM) && readFileSync(WASM).byteLength > 1024;

/** The engine's paper turn model, the engine instantiated from its build as a page would. */
export function paperTurnModel(): Promise<PaperTurnModel> {
  initRitoCoreWasmSync({ module: readFileSync(WASM) });
  return loadPaperTurnModel();
}
