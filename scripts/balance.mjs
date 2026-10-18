/**
 * Mesure de l'équilibrage économique (spécification v1.x, § 2.1 et § 10.3).
 * Usage : npm run balance [-- années]   (défaut : 15 ans, environ 1 min 30)
 *
 * Construit une « ville planifiée » sur 96 × 96 (graine 2030) avec les commandes du jeu : quadrillage complet,
 * une couronne de zones de plus chaque année, réseaux ajoutés dès 85 % de charge, services posés là où la
 * couverture est la plus faible. La trésorerie est illimitée : on mesure l'épargne brute (recettes − charges
 * d'exploitation), c'est-à-dire ce qu'un joueur peut réinvestir, indépendamment de son talent.
 */
import { readFileSync } from 'node:fs';
import { Catalog } from '../src/data/Catalog.js';
import { GameSession } from '../src/app/GameSession.js';
import { buildStarterTown, placeNear, roadLine } from '../src/app/scenarios.js';
import { EconomySystem } from '../src/simulation/EconomySystem.js';
import { isUnlocked } from '../src/systems/ConstructionService.js';

const years = Number(process.argv[2] ?? 15);
const load = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const catalog = new Catalog(load('buildings.json'), load('technologies.json'), load('policies.json'));

const size = 96;
const s = GameSession.newGame({ catalog, seed: 2030, width: size, height: size, name: 'Équilibrage' });
const st = s.state;
st.economy.treasury += 500_000_000_00;
buildStarterTown(s, { size: 'large' });
const margin = 3;
for (let x = 8; x < size - margin; x += 5) roadLine(s, x, margin, x, size - margin);
for (let y = margin; y < size - margin; y += 5) roadLine(s, 8, y, size - margin, y);

const zones = ['R_LOW', 'R_HIGH', 'C', 'R_LOW', 'O', 'I', 'R_HIGH', 'C'];
const cells = [];
for (let y = margin; y < size - margin; y += 10) for (let x = 9; x < size - margin; x += 10) cells.push({ x, y, d: Math.hypot(x - 10, y - 48) });
cells.sort((a, b) => a.d - b.d);
let k = 0;
const zoneCells = (n) => {
  for (let c = 0; c < n && cells.length; c++) {
    const { x, y } = cells.shift();
    s.execute({ type: 'zone', zoneId: zones[k++ % zones.length], rect: { x0: x, y0: y, x1: x + 8, y1: y + 8 } });
  }
};
zoneCells(6);

const placed = {};
const place = (id, x, y, r = 12) => {
  const res = placeNear(s, id, x, y, { maxRadius: r });
  if (res.ok) placed[id] = (placed[id] ?? 0) + 1;
  return res.ok;
};
// Bâtiments débloqués : on suit les règles du jeu (seuils de population aujourd'hui, paliers demain)
const can = (id) => isUnlocked(st, catalog.building(id).unlock).ok;
const peak = () => st.stats.peakPopulation ?? 0;

const log = [];
for (let m = 0; m < years * 12; m++) {
  if (m % 12 === 0 && m > 0) zoneCells(6);
  const u = st.utilities;
  if (u.power.demand > 0.85 * u.power.capacity) place(peak() >= 4000 && can('power_nuclear') ? 'power_nuclear' : 'power_gas', 20 + ((m * 7) % 60), 10 + ((m * 13) % 70), 30);
  if (u.water.demand > 0.85 * u.water.capacity) place(peak() >= 6000 && can('water_plant') ? 'water_plant' : 'water_tower', 20 + ((m * 11) % 60), 10 + ((m * 17) % 70), 40);
  if ((u.water.untreatedShare ?? 0) > 0.03) place(peak() >= 6000 && can('sewage_big') ? 'sewage_big' : 'sewage_plant', 20 + ((m * 5) % 60), 10 + ((m * 19) % 70), 40);
  const w = st.waste.stats ?? {};
  if ((w.collectionRate ?? 1) < 0.92) place(peak() >= 400 && can('recycling') ? 'recycling' : 'landfill', 20 + ((m * 23) % 60), 10 + ((m * 29) % 70), 30);
  if (m % 3 === 0 && st.stats.population > 300) {
    let worst = null;
    for (const b of st.buildings.values()) {
      if (!b.residents) continue;
      const i = st.grid.idx(b.x, b.y);
      const c = st.grid.coverPolice[i] + st.grid.coverEducation[i] + st.grid.coverHealth[i] + st.grid.coverFire[i];
      if (!worst || c < worst.c) worst = { c, x: b.x, y: b.y };
    }
    if (worst && worst.c < 2) for (const id of ['police', 'fire', 'school', 'clinic', 'park']) place(id, worst.x, worst.y);
    const need = (id, per) => (placed[id] ?? 0) < Math.floor(st.stats.population / per);
    if (worst && peak() >= 2500 && need('hospital', 20000)) place('hospital', worst.x, worst.y, 20);
    if (worst && peak() >= 1500 && need('high_school', 8000)) place('high_school', worst.x, worst.y, 20);
    if (worst && peak() >= 2000 && need('bus_depot', 6000)) {
      place('bus_depot', worst.x, worst.y, 20);
      for (let j = 0; j < 6; j++) place('bus_stop', worst.x + j * 4 - 12, worst.y + (j % 2) * 6 - 3, 6);
    }
  }
  s.run(30);
  const sm = EconomySystem.summarize(st.economy.periods.at(-1));
  // Les recettes exceptionnelles (dotations de palier, catégorie `grant`) sont exclues de l'épargne brute
  const grant = (st.economy.periods.at(-1).revenue.grant ?? 0) / 100;
  log.push({ pop: st.stats.population, rev: sm.revenues / 100 - grant, opex: sm.opex / 100 });
}

const fmt = (v) => Math.round(v).toLocaleString('fr-FR');
console.log('an | habitants | recettes/mois | charges/mois | épargne brute | taux | cumul');
let cumul = 0;
for (let y = 1; y <= years; y++) {
  const sl = log.slice((y - 1) * 12, y * 12);
  const rev = sl.reduce((a, r) => a + r.rev, 0) / sl.length;
  const op = sl.reduce((a, r) => a + r.opex, 0) / sl.length;
  cumul += sl.reduce((a, r) => a + r.rev - r.opex, 0);
  console.log(`${String(y).padStart(2)} | ${fmt(sl.at(-1).pop).padStart(9)} | ${fmt(rev).padStart(13)} | ${fmt(op).padStart(12)} | ${fmt(rev - op).padStart(13)} | ${String(Math.round((1 - op / rev) * 100)).padStart(3)} % | ${fmt(cumul)}`);
}
