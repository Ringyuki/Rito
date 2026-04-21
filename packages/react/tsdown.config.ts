import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/hooks.ts', 'src/components.ts'],
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  deps: {
    neverBundle: ['@ritojs/core', '@ritojs/kit', 'react', 'react-dom', 'react/jsx-runtime'],
  },
});
