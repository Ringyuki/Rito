import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const base = process.env['RITO_READER_BASE'] ?? (process.env['GITHUB_ACTIONS'] ? '/Rito/' : '/');

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), tsconfigPaths()],
});
