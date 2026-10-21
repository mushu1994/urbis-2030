// Polices embarquées (aucune requête vers un service distant).
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow/latin-800.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';
import './styles/main.css';
import './styles/hud.css';
import './styles/panels.css';
import './styles/mobile.css';
import './styles/features.css';
import './styles/v16.css';
import { createDefaultCatalog } from './data/defaultData.js';
import { GameApp } from './app/GameApp.js';

async function boot() {
  const root = document.getElementById('app');
  try {
    const catalog = createDefaultCatalog();
    const app = new GameApp({ root, catalog });
    await app.init();
    // Point d'accès pour le débogage et les tests de parcours (lecture seule recommandée).
    window.__urbis = app;
  } catch (err) {
    console.error(err);
    const busy = document.getElementById('busy');
    busy.hidden = false;
    busy.textContent = `Impossible de démarrer URBIS 2030 : ${err.message}`;
  }
}

boot();

// Application installable hors ligne : le service worker met le jeu en cache (production uniquement).
const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
// Pas de service worker dans une page intégrée (aperçu, portail de jeux) : il ne s'y enregistre pas.
if ('serviceWorker' in navigator && import.meta.env.PROD && !framed && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker non enregistré :', err));
  });
}
