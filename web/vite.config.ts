import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:4280', changeOrigin: true }, '/open': { target: 'http://127.0.0.1:4280', changeOrigin: true } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'] },
});
