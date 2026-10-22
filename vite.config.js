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
  // Applications Android et iOS (Capacitor, v1.7–1.8) : pas de service worker, le jeu est déjà dans l'application
  // (un cache hors ligne risquerait de servir l'ancienne version après une mise à jour)
  plugins: mode === 'single' ? [viteSingleFile()] : mode === 'android' || mode === 'ios' ? [] : [serviceWorker()],
  worker: { format: 'es' },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    // v1.6 : pas de cartes de sources publiées (le code d'origine n'est pas exposé avec le jeu)
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    setupFiles: ['tests/setup.js']
  }
}));
