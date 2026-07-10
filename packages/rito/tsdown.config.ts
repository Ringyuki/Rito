import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'worker-entry': 'src/bindings/browser/reader/worker-main.ts',
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
