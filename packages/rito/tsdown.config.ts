import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/advanced.ts', 'src/worker.ts'],
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
});
