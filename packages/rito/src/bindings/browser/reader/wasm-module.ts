import { decodeRitoFrameCommandBuffer, normalizeRitoCoreWasmError } from '../core-contracts';
import type { BrowserReaderBindingModule } from './types';

let runtimeModulePromise: Promise<BrowserReaderBindingModule> | undefined;
let fullModulePromise: Promise<BrowserReaderBindingModule> | undefined;

const decoderRuntimeModule = {
  decodeRitoFrameCommandBuffer,
  normalizeRitoCoreWasmError,
} satisfies BrowserReaderBindingModule;

export function loadRuntimeCoreModule(): Promise<BrowserReaderBindingModule> {
  runtimeModulePromise ??= loadRuntimeModuleForEnvironment();
  return runtimeModulePromise;
}

export function loadFullCoreModule(): Promise<BrowserReaderBindingModule> {
  fullModulePromise ??= import('@ritojs/core-wasm').then(
    ({ decodeRitoFrameCommandBuffer, initRitoCoreWasmEngine, normalizeRitoCoreWasmError }) => ({
      decodeRitoFrameCommandBuffer,
      initRitoCoreWasmEngine,
      normalizeRitoCoreWasmError,
    }),
  );
  return fullModulePromise;
}

async function loadRuntimeModuleForEnvironment(): Promise<BrowserReaderBindingModule> {
  if (typeof Worker !== 'undefined') {
    return decoderRuntimeModule;
  }
  return loadFullCoreModule();
}
