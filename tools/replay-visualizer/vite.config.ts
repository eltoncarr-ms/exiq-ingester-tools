/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  // react-draggable's debug logger reads process.env.DRAGGABLE_DEBUG, which throws
  // "process is not defined" in the browser and aborts drag/resize. Replace it at build.
  define: {
    'process.env.DRAGGABLE_DEBUG': 'false',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});