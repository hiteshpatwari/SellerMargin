import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sites } from './build/sites-vite-plugin.ts';

export default defineConfig({
  plugins: [react(), sites()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
