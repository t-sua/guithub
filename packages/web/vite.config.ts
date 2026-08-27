import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * GuitHub renders scores but never plays them, so alphaTab's bundled soundfont is
 * 2.3 MB of dead weight in the output. The fonts it copies alongside are required —
 * Bravura is what the notation is drawn with — so asset copying stays on and only
 * the soundfont is removed afterwards.
 */
function dropSoundfont(): Plugin {
  return {
    name: 'guithub:drop-soundfont',
    apply: 'build',
    async closeBundle() {
      await rm(resolve(import.meta.dirname, 'dist', 'soundfont'), {
        recursive: true,
        force: true
      });
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    // Audio worklets exist only for playback, which is disabled.
    alphaTab({ audioWorklets: false }),
    dropSoundfont()
  ],
  server: {
    port: 5173,
    // The API and the UI share an origin in production; in development Vite proxies
    // to the running server so the session cookie behaves identically.
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } }
  },
  build: { outDir: 'dist', sourcemap: true }
});
