import { TERRAIN } from '../world/Terrain.js';

/**
 * Contrôles de cohérence de l'état du jeu (outil de débogage et tests de non-régression).
 * Retourne la liste des anomalies détectées (vide = état cohérent).
 * @param {import('../app/GameState.js').GameState} state
 * @param {import('../data/Catalog.js').Catalog} catalog
 * @returns {string[]}
 */
export function checkInvariants(state, catalog) {
  const errors = [];
  const g = state.grid;
  const add = (m) => {
    if (errors.length < 50) errors.push(m);
  };

  // 1. Grille ↔ bâtiments : chaque case porte le bon identifiant, aucune case orpheline ni chevauchement
  const counted = new Map();
  for (let i = 0; i < g.size; i++) {
    const id = g.building[i];
    if (!id) continue;
    const b = state.buildings.get(id);
    if (!b) {
      add(`Case ${g.xOf(i)},${g.yOf(i)} : bâtiment ${id} inexistant`);
      continue;
    }
    const x = g.xOf(i);
    const y = g.yOf(i);
    if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) add(`Case ${x},${y} hors de l'emprise du bâtiment ${id}`);
    counted.set(id, (counted.get(id) ?? 0) + 1);
    if (g.road[i]) add(`Case ${x},${y} : route et bâtiment superposés`);
  }
  for (const b of state.buildings.values()) {
    const def = catalog.buildings.get(b.defId);
    if (!def) {
      add(`Bâtiment ${b.id} : définition « ${b.defId} » inconnue`);
      continue;
    }
    if ((counted.get(b.id) ?? 0) !== b.w * b.h) add(`Bâtiment ${b.id} (${def.name}) : ${counted.get(b.id) ?? 0} cases au lieu de ${b.w * b.h}`);
    if (def.capacity.residents && b.residents > def.capacity.residents) add(`Bâtiment ${b.id} : ${b.residents} habitants pour ${def.capacity.residents} places`);
    if (b.jobsFilled > def.capacity.jobs) add(`Bâtiment ${b.id} : ${b.jobsFilled} emplois pourvus pour ${def.capacity.jobs}`);
    if (b.employed > b.workforce) add(`Bâtiment ${b.id} : plus d'actifs occupés que d'actifs`);
    const ups = b.upgrades ?? [];
    if (new Set(ups).size !== ups.length) add(`Bâtiment ${b.id} : amélioration installée deux fois`);
    for (const u of ups) {
      if (!catalog.upgradeById.get(u)?.appliesTo.includes(b.defId)) add(`Bâtiment ${b.id} (${def.name}) : amélioration « ${u} » invalide`);
    }
    for (const k of ['residents', 'jobsFilled', 'satisfaction', 'rent', 'commute']) {
      if (typeof b[k] === 'number' && !Number.isFinite(b[k])) add(`Bâtiment ${b.id} : valeur non numérique (${k})`);
    }
  }
  if (state.nextBuildingId <= Math.max(0, ...state.buildings.keys())) add('Compteur d\'identifiants de bâtiments en retard');

  // 2. Routes : un pont n'existe que sur l'eau et porte une route ; pas de route sur l'eau sans pont
  for (let i = 0; i < g.size; i++) {
    const water = g.terrain[i] === TERRAIN.WATER;
    if (g.road[i] && water && !g.bridge[i]) add(`Case ${g.xOf(i)},${g.yOf(i)} : route sur l'eau sans pont`);
    if (g.bridge[i] && (!g.road[i] || !water)) add(`Case ${g.xOf(i)},${g.yOf(i)} : pont invalide`);
    if (g.zone[i] && (g.road[i] || water)) add(`Case ${g.xOf(i)},${g.yOf(i)} : zonage sur une route ou sur l'eau`);
  }

  // 3. Finances : montants entiers et trésorerie égale au cumul du journal (tant qu'il est complet)
  const eco = state.economy;
  if (!Number.isInteger(eco.treasury)) add('Trésorerie non entière');
  const complete = eco.ledger.length === 0 || eco.ledger[0].id === 1;
  if (complete && Number.isInteger(eco.opening)) {
    const sum = eco.ledger.reduce((s, t) => s + t.amount, 0);
    if (eco.opening + sum !== eco.treasury) add(`Trésorerie ${eco.treasury} ≠ ouverture ${eco.opening} + journal ${sum}`);
  }
  for (const t of eco.ledger) {
    if (!Number.isInteger(t.amount)) {
      add(`Transaction ${t.id} : montant non entier`);
      break;
    }
  }

  // 4. Indicateurs agrégés
  for (const [k, v] of Object.entries(state.stats)) {
    if (typeof v === 'number' && !Number.isFinite(v)) add(`Indicateur non numérique : ${k}`);
  }
  for (const [k, v] of Object.entries(state.demand)) {
    if (!(v >= -100 && v <= 100)) add(`Demande hors bornes : ${k} = ${v}`);
  }
  return errors;
}
