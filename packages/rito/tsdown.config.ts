import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/advanced.ts'],
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
});
