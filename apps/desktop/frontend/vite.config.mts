import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    target: 'esnext',
    modulePreload: { polyfill: false },
  },
});
