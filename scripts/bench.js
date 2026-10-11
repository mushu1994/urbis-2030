/**
 * Mesure des performances de la simulation (hors rendu) sur des cartes de 64×64 et 128×128.
 * Usage : npm run bench
 * Les villes sont construites avec les commandes du jeu (mêmes règles et coûts que le joueur),
 * avec une trésorerie augmentée pour pouvoir couvrir la carte.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { Catalog } from '../src/data/Catalog.js';
import { GameSession } from '../src/app/GameSession.js';
import { buildStarterTown, placeNear, roadLine } from '../src/app/scenarios.js';
import { serializeState } from '../src/persistence/SaveService.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const catalog = new Catalog(load('buildings.json'), load('technologies.json'), load('policies.json'));

function bigCity(size) {
  const s = GameSession.newGame({ catalog, seed: 2030, width: size, height: size, name: `Bench ${size}` });
  s.state.economy.treasury += 2_000_000_00;
  buildStarterTown(s, { size: "large" });
  // Extension en damier sur toute la partie terrestre accessible
  const margin = 3;
  for (let x = 8; x < size - margin; x += 5) roadLine(s, x, margin, x, size - margin);
  for (let y = margin; y < size - margin; y += 5) roadLine(s, 8, y, size - margin, y);
  const zones = ['R_LOW', 'R_HIGH', 'C', 'R_LOW', 'O', 'I'];
  let k = 0;
  for (let y = margin; y < size - margin; y += 10) {
    for (let x = 9; x < size - margin; x += 10) {
      s.execute({ type: 'zone', zoneId: zones[k++ % zones.length], rect: { x0: x, y0: y, x1: x + 8, y1: y + 8 } });
    }
  }
  const plants = Math.ceil((size * size) / 1500);
  for (let p = 0; p < plants; p++) placeNear(s, 'power_gas', 10 + ((p * 23) % (size - 20)), 6 + ((p * 37) % (size - 12)));
  for (let w = 0; w < plants * 4; w++) placeNear(s, 'water_tower', 12 + ((w * 19) % (size - 24)), 8 + ((w * 29) % (size - 16)));
  for (let w = 0; w < plants; w++) placeNear(s, 'sewage_plant', 14 + ((w * 41) % (size - 24)), 10 + ((w * 13) % (size - 16)));
  return s;
}

function bench(size, months) {
  const t0 = performance.now();
  const s = bigCity(size);
  const tBuild = performance.now() - t0;
  // Préchauffage puis mesure
  s.run(60);
  for (const id of ['police', 'fire', 'school', 'clinic', 'police', 'fire', 'school']) placeNear(s, id, Math.floor(size / 2), Math.floor(size / 2));
  const ticks = months * 30;
  const durations = [];
  for (let k = 0; k < ticks; k++) {
    const a = performance.now();
    s.sim.step(s.state);
    durations.push(performance.now() - a);
  }
  durations.sort((a, b) => a - b);
  const avg = durations.reduce((x, v) => x + v, 0) / durations.length;
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const max = durations.at(-1);
  const t1 = performance.now();
  const payload = JSON.stringify(serializeState(s.state));
  const tSave = performance.now() - t1;
  return {
    carte: `${size}×${size}`,
    'construction (ms)': Math.round(tBuild),
    bâtiments: s.state.buildings.size,
    habitants: s.state.stats.population,
    'routes (cases)': s.sim.network.n,
    'tick moyen (ms)': avg.toFixed(2),
    'tick p95 (ms)': p95.toFixed(2),
    'tick max (ms)': max.toFixed(2),
    'sauvegarde (Ko)': Math.round(payload.length / 1024),
    'sérialisation (ms)': Math.round(tSave),
    'détail (ms/exécution)': Object.fromEntries(Object.entries(s.sim.timings).map(([k, v]) => [k, Number(v.toFixed(2))]))
  };
}

console.log(`Machine : ${os.cpus()[0]?.model ?? 'inconnue'} · ${os.cpus().length} cœurs · Node ${process.version}`);
for (const [size, months] of [[64, 12], [128, 6]]) {
  console.log(bench(size, months));
}
