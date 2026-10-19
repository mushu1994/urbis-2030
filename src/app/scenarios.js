import { TERRAIN } from '../world/Terrain.js';

/**
 * Scénarios de départ construits exclusivement via les commandes du jeu (mêmes règles, mêmes coûts
 * que pour le joueur). Utilisés pour le mode « bourg existant », les tests d'intégration et les mesures.
 */

/** Cherche, en spirale autour d'un point, le premier emplacement valide pour un bâtiment. */
export function placeNear(session, defId, cx, cy, { rot = 0, maxRadius = 30 } = {}) {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        // v1.4 : les scénarios ne démolissent jamais de maisons pour poser un équipement
        const cmd = { type: 'building', defId, x: cx + dx, y: cy + dy, rot, keepZoned: true };
        const pv = session.preview(cmd);
        if (pv.ok) return session.execute(cmd);
      }
    }
  }
  return { ok: false };
}

/**
 * Pose une route case par case en ignorant les cases impossibles (pente, bâtiment). v1.4 : une rivière étroite
 * est franchie par un pont (un seul tracé de la rive à la rive) au lieu d'arrêter la route.
 */
export function roadLine(session, x0, y0, x1, y1, roadId = 'road_street') {
  const g = session.state.grid;
  let built = 0;
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  const water = (tx, ty) => g.inBounds(tx, ty) && g.terrain[g.idx(tx, ty)] === TERRAIN.WATER;
  const step = (p) => (p.x !== x1 ? { x: p.x + sx, y: p.y } : { x: p.x, y: p.y + sy });
  let p = { x: x0, y: y0 };
  let prev = null;
  for (;;) {
    if (g.inBounds(p.x, p.y)) {
      if (water(p.x, p.y) && prev) {
        // Pont : de la case de terre précédente à la première case de terre après l'eau
        let e = p;
        while (water(e.x, e.y) && !(e.x === x1 && e.y === y1)) e = step(e);
        if (!water(e.x, e.y) && session.execute({ type: 'road', roadId, from: prev, to: e }).ok) built++;
        p = e;
      } else if (!water(p.x, p.y) && session.execute({ type: 'road', roadId, from: p, to: p }).ok) built++;
      if (!water(p.x, p.y)) prev = p;
    }
    if (p.x === x1 && p.y === y1) break;
    p = step(p);
  }
  return built;
}

/**
 * Limite est du bourg sur une ligne : la première étendue d'eau infranchissable. v1.4 : une rivière de 12 cases
 * au plus est franchie par un pont (auparavant, une rivière proche de l'autoroute empêchait de bâtir le bourg).
 */
function eastLimit(g, row, fromX) {
  for (let x = fromX; x < g.width; x++) {
    if (g.terrain[g.idx(x, row)] !== TERRAIN.WATER) continue;
    let e = x;
    while (e < g.width && g.terrain[g.idx(e, row)] === TERRAIN.WATER) e++;
    if (e - x > 12 || e >= g.width - 4) return x - 2;
    x = e;
  }
  return g.width - 2;
}

/**
 * Bourg de départ : axe principal relié à l'autoroute, quadrillage de rues, zonage mixte,
 * centrale, eau, épuration et services de base.
 * @param {import('./GameSession.js').GameSession} session
 * @param {{size?: 'small'|'large'}} [opts]
 */
export function buildStarterTown(session, { size = 'small' } = {}) {
  const s = session.state;
  // Le bourg a été bâti par l'équipe précédente : le statut actuel de la ville ne limite pas ce qu'elle a construit
  const wasPreparing = s.meta.preparing;
  s.meta.preparing = true;
  try {
    return buildTown(session, size);
  } finally {
    if (wasPreparing) s.meta.preparing = true;
    else delete s.meta.preparing;
  }
}

function buildTown(session, size) {
  const s = session.state;
  const g = s.grid;
  const entry = s.entries[0];
  const row = g.yOf(entry);
  const startX = 3;
  const limit = eastLimit(g, row, startX);
  const span = size === 'large' ? 14 : 8;
  const xEnd = Math.min(limit, startX + (size === 'large' ? 34 : 22));

  // Axe principal et rues perpendiculaires tous les 5 cases
  roadLine(session, startX, row, xEnd, row);
  const yMin = Math.max(1, row - span);
  const yMax = Math.min(g.height - 2, row + span);
  for (let x = startX + 4; x <= xEnd; x += 5) roadLine(session, x, yMin, x, yMax);
  for (let y = row - 5; y >= yMin; y -= 5) roadLine(session, startX + 4, y, xEnd, y);
  for (let y = row + 5; y <= yMax; y += 5) roadLine(session, startX + 4, y, xEnd, y);

  // Énergie, eau et assainissement à l'ouest (à proximité de l'autoroute)
  placeNear(session, 'power_gas', startX + 1, row + 3);
  for (let k = 0; k < (size === 'large' ? 5 : 3); k++) placeNear(session, 'water_tower', startX + 2, row - 3);

  const zone = (zoneId, x0, y0, x1, y1) => session.execute({ type: 'zone', zoneId, rect: { x0, y0, x1, y1 } });
  const midX = Math.floor((startX + 4 + xEnd) / 2);
  // Commerce le long de l'axe principal, résidentiel de part et d'autre, industrie à l'ouest, bureaux au centre
  zone('C', startX + 5, row - 1, xEnd, row + 1);
  zone('R_LOW', midX, yMin, xEnd, row - 2);
  zone('R_LOW', midX, row + 2, xEnd, yMax);
  zone('R_HIGH', startX + 9, yMin, midX - 1, row - 2);
  zone('I', startX + 5, row + 6, startX + 12, yMax);
  zone('O', startX + 13, row + 2, midX - 1, row + 6);

  placeNear(session, 'sewage_plant', startX + 6, yMax - 1);
  // Déchets : centre de collecte au cœur du bourg, décharge à l'écart
  placeNear(session, 'waste_depot', midX, row + 3);
  placeNear(session, 'landfill', startX + 6, yMin + 1);
  // Police, pompiers et école viennent une fois les premiers habitants installés (comme avant la v1.0)
  if ((s.stats.peakPopulation ?? 0) >= 150) {
    placeNear(session, 'police', midX, row - 3);
    placeNear(session, 'fire', midX + 4, row + 3);
    placeNear(session, 'school', midX + 2, row - 7);
  }
  placeNear(session, 'clinic', midX - 2, row + 4);
  placeNear(session, 'park', midX + 6, row - 4);
  return { row, xEnd };
}

/**
 * v1.4 : le bourg existant a été bâti par l'équipe précédente ; le nouveau maire ne doit pas hériter d'une caisse
 * vide (cartes où une rivière impose des ponts coûteux). La trésorerie est complétée jusqu'à `euros` par une
 * dotation de l'État, inscrite au journal.
 * @returns {number} montant versé (centimes)
 */
export function ensureStartingCash(session, euros = 60000) {
  const s = session.state;
  const missing = euros * 100 - s.economy.treasury;
  if (missing <= 0) return 0;
  session.sim.economy.post(s, { kind: 'grant', category: 'grant', label: 'Dotation de l\'État : reprise du bourg', amount: missing });
  return missing;
}
