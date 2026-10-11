/**
 * Point d'entrée du Web Worker de simulation : toute la simulation tourne ici, hors du fil d'affichage.
 * Le fil principal garde une réplique de l'état, mise à jour par instantanés (voir SimSync.js).
 */
import { createDefaultCatalog } from '../data/defaultData.js';
import { SimWorkerCore } from './SimWorkerCore.js';

const core = new SimWorkerCore({
  catalog: createDefaultCatalog(),
  post: (msg, transfer) => self.postMessage(msg, transfer ?? [])
});

self.onmessage = (e) => core.handle(e.data);
self.postMessage({ type: 'hello' });
