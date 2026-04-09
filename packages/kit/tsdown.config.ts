import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/keyboard.ts', 'src/storage.ts'],
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  external: ['rito'],
});
