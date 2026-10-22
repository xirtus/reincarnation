import { defineConfig } from 'vite';

// Reincarnation is a single-page WebGPU game. All runtime art lives under
// public/ and is served from the site root; there are no sibling-repo
// dependencies or machine-specific paths.
export default defineConfig({
  resolve: {
    alias: [
      // The renderer is built exclusively on three's WebGPU/TSL entry point.
      { find: /^three$/, replacement: 'three/webgpu' },
    ],
    dedupe: ['three', 'three/webgpu', 'three/tsl'],
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
  },
  preview: {
    host: '127.0.0.1',
    port: 5199,
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    copyPublicDir: true,
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
});
