import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'worker-entry': 'src/bindings/browser/reader/worker-main.ts',
    'reader-v1-worker-entry': 'src/bindings/browser/reader-v1-worker.ts',
  },
  format: 'esm',
  // The package ships browser code end to end: resolve dependencies via
  // their browser condition (fflate's node ESM entry probes
  // worker_threads through createRequire, which breaks vite consumers).
  platform: 'browser',
  // keep the historical .mjs artifact names the exports map points at
  fixedExtension: true,
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  deps: {
    alwaysBundle: [/^@ritojs\/core-wasm(?:\/.*)?$/, 'saxes', 'xmlchars'],
    onlyBundle: false,
  },
});
