import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'worker-entry': 'src/bindings/browser/reader/worker-main.ts',
    'reader-v1-worker-entry': 'src/bindings/browser/reader-v1-worker.ts',
    // 0.13 compatibility subpath entries (legacy TS-core presets), kept
    // so published consumers of @ritojs/core/web etc. keep resolving.
    web: 'src/compatibility/web.ts',
    advanced: 'src/compatibility/advanced.ts',
    selection: 'src/compatibility/selection.ts',
    search: 'src/compatibility/search.ts',
    annotations: 'src/compatibility/annotations.ts',
    position: 'src/compatibility/position.ts',
    a11y: 'src/compatibility/a11y.ts',
    dom: 'src/compatibility/dom.ts',
  },
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  deps: {
    alwaysBundle: [/^@ritojs\/core-wasm(?:\/.*)?$/, 'saxes', 'xmlchars'],
    onlyBundle: false,
  },
});
