import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  base: process.env['GITHUB_ACTIONS'] ? '/Rito/' : '/',
  plugins: [react(), tailwindcss(), tsconfigPaths()],
});
