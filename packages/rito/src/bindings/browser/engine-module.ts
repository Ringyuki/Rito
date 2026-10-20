import { initRitoCoreWasm } from '@ritojs/core-wasm';

let ready: Promise<unknown> | undefined;

/**
 * The engine's module, instantiated once for the page: every session and
 * every page turn runs on the one instance. Two instantiations started
 * together would each replace the module the bindings call into, and what
 * one had made would be read in the other's memory.
 */
export function engineModuleReady(): Promise<unknown> {
  ready ??= initRitoCoreWasm().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
