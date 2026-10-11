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
        const cmd = { type: 'building', defId, x: cx + dx, y: cy + dy, rot };
        const pv = session.preview(cmd);
        if (pv.ok) return session.execute(cmd);
      }
    }
  }
  return { ok: false };
}

/** Pose une route case par case en ignorant les cases impossibles (eau, pente, bâtiment). */
export function roadLine(session, x0, y0, x1, y1, roadId = 'road_street') {
  const g = session.state.grid;
  let built = 0;
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  for (;;) {
    if (g.inBounds(x, y)) {
      const r = session.execute({ type: 'road', roadId, from: { x, y }, to: { x, y } });
      if (r.ok) built++;
    }
    if (x === x1 && y === y1) break;
    if (x !== x1) x += sx;
    else y += sy;
  }
  return built;
}

/** Première colonne d'eau rencontrée vers l'est sur une ligne (limite du bourg). */
function eastLimit(g, row, fromX) {
  for (let x = fromX; x < g.width; x++) if (g.terrain[g.idx(x, row)] === TERRAIN.WATER) return x - 2;
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
  placeNear(session, 'police', midX, row - 3);
  placeNear(session, 'fire', midX + 4, row + 3);
  placeNear(session, 'school', midX + 2, row - 7);
  placeNear(session, 'clinic', midX - 2, row + 4);
  placeNear(session, 'park', midX + 6, row - 4);
  return { row, xEnd };
}
