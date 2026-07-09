import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const base = process.env['RITO_READER_BASE'] ?? (process.env['GITHUB_ACTIONS'] ? '/Rito/' : '/');

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/packages/rito/src/')) return 'rito-core';
          if (id.includes('/packages/kit/src/')) return 'rito-kit';
          if (id.includes('/packages/react/src/')) return 'rito-react';
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react';
          }
          if (id.includes('/node_modules/motion')) return 'motion';
          if (
            id.includes('/node_modules/radix-ui/') ||
            id.includes('/node_modules/@radix-ui/') ||
            id.includes('/node_modules/cmdk/') ||
            id.includes('/node_modules/vaul/')
          ) {
            return 'ui';
          }
          if (
            id.includes('/node_modules/lucide-react/') ||
            id.includes('/node_modules/@icons-pack/')
          ) {
            return 'icons';
          }
          if (id.includes('/node_modules/')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
