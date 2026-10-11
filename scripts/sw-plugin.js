import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Plugin Vite : génère `sw.js` (service worker) à la construction, avec la liste exacte des fichiers du jeu.
 * - Fichiers à nom haché (assets/) : servis depuis le cache, jamais redemandés.
 * - Page d'accueil : réseau d'abord (on récupère la dernière version en ligne), cache hors connexion.
 * - Chaque construction a sa version : l'ancien cache est supprimé à l'activation.
 */
export function serviceWorker({ publicDir = 'public' } = {}) {
  return {
    name: 'urbis-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const extra = [];
      const walk = (dir) => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (!/README\.md$|^_headers$/i.test(f)) extra.push(relative(publicDir, p).split('\\').join('/'));
        }
      };
      walk(publicDir);
      const all = [...new Set(['./', ...files, ...extra])].sort();
      const hash = createHash('sha256');
      for (const f of files) {
        const item = bundle[f];
        hash.update(f);
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      for (const f of extra) hash.update(readFileSync(join(publicDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: template(version, all) });
    }
  };
}

function template(version, files) {
  return `/* URBIS 2030 — service worker généré à la construction (version ${version}). */
const CACHE = 'urbis-2030-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('urbis-2030-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Page : réseau d'abord (mise à jour), cache si hors connexion
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./', { ignoreVary: true }).then((r) => r || caches.match('index.html', { ignoreVary: true })))
    );
    return;
  }
  // Ressources : cache d'abord
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
`;
}
