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
