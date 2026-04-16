import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/advanced.ts',
    'src/selection.ts',
    'src/search.ts',
    'src/annotations.ts',
    'src/position.ts',
    'src/a11y.ts',
    'src/dom.ts',
  ],
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
});
