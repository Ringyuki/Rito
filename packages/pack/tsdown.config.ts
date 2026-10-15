import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    worker: 'src/worker.ts',
    cli: 'src/cli.ts',
  },
  format: 'esm',
  platform: 'node',
  fixedExtension: true,
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  deps: {
    alwaysBundle: [/^@ritojs\/core-wasm(?:\/.*)?$/],
    onlyBundle: false,
  },
});
