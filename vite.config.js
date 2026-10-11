import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { serviceWorker } from './scripts/sw-plugin.js';

/**
 * Configuration Vite.
 * - mode "development"/"production" : build classique (dist/ avec assets séparés).
 * - mode "single" : build autonome en un seul fichier HTML (démo partageable, hébergement statique minimal).
 * Le build classique produit aussi l'application installable (manifeste, icônes, service worker hors ligne).
 */
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [serviceWorker()],
  worker: { format: 'es' },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    sourcemap: mode !== 'single',
    chunkSizeWarningLimit: 1500
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    setupFiles: ['tests/setup.js']
  }
}));
