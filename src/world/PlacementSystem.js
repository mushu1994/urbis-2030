import { isOwnedIndex, fullyOwned } from './Land.js';
import { TERRAIN, roadAllowedOn, zoneAllowedOn, hasDeposit, hasForest, ZONE_EXTRACT, ZONE_FOREST, CLEARING_COST_EUROS, ROCK_CLEARING_COST_EUROS, LEVELING_COST_EUROS } from './Terrain.js';

/** Messages d'explication des refus de placement (affichés au joueur). */
export const REASONS = {
  bounds: 'Hors de la carte',
  occupied: 'Emprise occupée',
  road: 'Une route occupe l\'emprise',
  terrain: 'Terrain incompatible',
  water: 'Impossible de construire sur l\'eau',
  slope: 'Terrain non plat',
  levelTooHigh: 'Dénivelé trop important (2 niveaux au plus pour un nivellement automatique)',
  steep: 'Pente trop forte',
  noRoad: 'Absence de raccordement routier',
  needWater: 'Doit être construit au bord de l\'eau',
  bridgeEnds: 'Un pont doit relier deux rives',
  bridgeStraight: 'Un pont doit être rectiligne',
  bridgeLong: 'Pont trop long (16 cases au maximum)',
  noBridge: 'Ce type de voie ne peut pas franchir l\'eau',
  unique: 'Bâtiment unique déjà construit',
  locked: 'Non débloqué',
  budget: 'Budget insuffisant',
  highway: 'L\'accès autoroutier ne peut pas être modifié',
  nothing: 'Rien à faire ici',
  noZone: 'Zonage impossible sur cette case',
  noDeposit: 'Aucun gisement (roche) à moins de 2 cases',
  noForest: 'Aucune forêt à moins de 2 cases',
  notOwned: 'Parcelle non achetée (Ville → Territoire)'
};

/** Dimensions effectives selon la rotation. */
export function footprintOf(def, rot = 0) {
  return rot % 2 === 0 ? { w: def.footprint.w, h: def.footprint.h } : { w: def.footprint.h, h: def.footprint.w };
}

/**
 * Vérifie l'emprise d'un bâtiment à poser (sans effet de bord).
 * @param {import('../app/GameState.js').GameState} state
 * @param {import('../data/Catalog.js').BuildingDef} def
 * Forêt et roche ne bloquent plus : elles sont défrichées ou dérochées (coût ajouté par le service de construction).
 * Un bâtiment « autoLevel » (port, pompe…) accepte un terrain inégal : il est nivelé à l'altitude la plus basse.
 * @returns {{ok:boolean, reasons:string[], tiles:number[], forestTiles:number[], rockTiles:number[], level:{target:number, units:number}|null, access:number, w:number, h:number}}
 */
export function checkBuildingPlacement(state, def, x, y, rot = 0) {
  const g = state.grid;
  const { w, h } = footprintOf(def, rot);
  const reasons = new Set();
  const tiles = [];
  const forestTiles = [];
  const rockTiles = [];
  let alt = -1;
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  const checkOwned = !fullyOwned(state);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!g.inBounds(tx, ty)) {
        reasons.add('bounds');
        continue;
      }
      const i = g.idx(tx, ty);
      tiles.push(i);
      if (checkOwned && !isOwnedIndex(state, i)) reasons.add('notOwned');
      const terr = g.terrain[i];
      if (g.building[i]) reasons.add('occupied');
      if (g.road[i]) reasons.add('road');
      if (terr === TERRAIN.WATER) reasons.add('water');
      else if (terr === TERRAIN.FOREST) forestTiles.push(i);
      else if (terr === TERRAIN.ROCK && !def.placement.terrainCodes.includes(terr)) rockTiles.push(i);
      else if (!def.placement.terrainCodes.includes(terr)) reasons.add('terrain');
      if (terr !== TERRAIN.WATER) {
        minAlt = Math.min(minAlt, g.altitude[i]);
        maxAlt = Math.max(maxAlt, g.altitude[i]);
      }
      if (alt < 0) alt = g.altitude[i];
      else if (def.placement.flat && !def.placement.autoLevel && g.altitude[i] !== alt) reasons.add('slope');
    }
  }
  let level = null;
  if (def.placement.autoLevel && maxAlt > minAlt) {
    if (maxAlt - minAlt > 2) reasons.add('levelTooHigh');
    else {
      let units = 0;
      for (const i of tiles) if (g.terrain[i] !== TERRAIN.WATER) units += g.altitude[i] - minAlt;
      level = { target: minAlt, units };
    }
  }
  const access = findAccess(state, x, y, w, h);
  if (def.placement.requiresRoadAccess && access < 0 && !reasons.has('bounds')) reasons.add('noRoad');
  if (def.placement.adjacentToTerrainCode >= 0 && !reasons.has('bounds')) {
    if (!touchesTerrain(state, x, y, w, h, def.placement.adjacentToTerrainCode)) reasons.add('needWater');
  }
  if (def.placement.unique) {
    for (const b of state.buildings.values()) if (b.defId === def.id) reasons.add('unique');
  }
  return { ok: reasons.size === 0, reasons: [...reasons], tiles, forestTiles, rockTiles, level, access, w, h };
}

/** Surcoût de préparation du terrain d'une emprise (défrichement, dérochage, nivellement), en centimes. */
export function siteWorksCents(check) {
  return Math.round(
    (check.forestTiles.length * CLEARING_COST_EUROS + check.rockTiles.length * ROCK_CLEARING_COST_EUROS + (check.level?.units ?? 0) * LEVELING_COST_EUROS) * 100
  );
}

/** Applique la préparation du terrain (avant la pose) : roche → prairie, nivellement de l'emprise. */
export function prepareSite(state, check) {
  const g = state.grid;
  for (const i of check.rockTiles) g.terrain[i] = TERRAIN.GRASS;
  if (check.level) for (const i of check.tiles) if (g.terrain[i] !== TERRAIN.WATER) g.altitude[i] = check.level.target;
}

/**
 * Case de route adjacente à l'emprise (premier trouvé, ordre déterministe), ou -1.
 */
export function findAccess(state, x, y, w, h) {
  const g = state.grid;
  const candidates = [];
  for (let dx = 0; dx < w; dx++) candidates.push([x + dx, y + h], [x + dx, y - 1]);
  for (let dy = 0; dy < h; dy++) candidates.push([x + w, y + dy], [x - 1, y + dy]);
  for (const [cx, cy] of candidates) {
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    // Un pont ne dessert pas les parcelles riveraines.
    if (g.road[i] && !g.bridge[i]) return i;
  }
  return -1;
}

export const MAX_BRIDGE_LENGTH = 16;

/**
 * Repère les franchissements d'eau d'un tracé et calcule l'altitude de chaque tablier.
 * Un pont est rectiligne, relie deux cases de terre du même tracé et ne dépasse pas MAX_BRIDGE_LENGTH.
 * @param {{x:number,y:number,i:number}[]} pts cases du tracé, dans l'ordre
 * @returns {{deck: Map<number, number>, reasons: Set<string>}}
 */
export function planBridges(state, pts) {
  const g = state.grid;
  const deck = new Map();
  const reasons = new Set();
  const isWater = (p) => g.terrain[p.i] === TERRAIN.WATER;
  let k = 0;
  while (k < pts.length) {
    if (!isWater(pts[k])) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < pts.length && isWater(pts[e + 1])) e++;
    const before = pts[k - 1];
    const after = pts[e + 1];
    const run = pts.slice(k, e + 1);
    k = e + 1;
    if (!before || !after) {
      reasons.add('bridgeEnds');
      continue;
    }
    const line = [before, ...run, after];
    const straight = line.every((p) => p.x === before.x) || line.every((p) => p.y === before.y);
    if (!straight) {
      reasons.add('bridgeStraight');
      continue;
    }
    if (run.length > MAX_BRIDGE_LENGTH) {
      reasons.add('bridgeLong');
      continue;
    }
    const a1 = g.altitude[before.i];
    const a2 = g.altitude[after.i];
    if (Math.abs(a1 - a2) > 1) {
      reasons.add('steep');
      continue;
    }
    const alt = Math.max(1, a1, a2);
    for (const p of run) deck.set(p.i, alt);
  }
  return { deck, reasons };
}

function touchesTerrain(state, x, y, w, h, code) {
  const g = state.grid;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const inside = dx >= 0 && dy >= 0 && dx < w && dy < h;
      if (inside) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (g.inBounds(tx, ty) && g.terrain[g.idx(tx, ty)] === code) return true;
    }
  }
  return false;
}

/**
 * Tracé d'une route en « L » entre deux cases (horizontal puis vertical, ou l'inverse).
 * @returns {{x:number,y:number}[]}
 */
export function roadPath(x0, y0, x1, y1, verticalFirst = false) {
  const pts = [];
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  if (!verticalFirst) {
    for (let x = x0; x !== x1; x += sx) pts.push({ x, y: y0 });
    for (let y = y0; y !== y1; y += sy) pts.push({ x: x1, y });
  } else {
    for (let y = y0; y !== y1; y += sy) pts.push({ x: x0, y });
    for (let x = x0; x !== x1; x += sx) pts.push({ x, y: y1 });
  }
  pts.push({ x: x1, y: y1 });
  return pts;
}

/**
 * Évalue une case pour la pose de route.
 * @returns {{status:'new'|'same'|'upgrade'|'invalid', reason?:string}}
 */
export function checkRoadTile(state, i, roadCode, prevAlt) {
  const g = state.grid;
  if (!fullyOwned(state) && !isOwnedIndex(state, i)) return { status: 'invalid', reason: 'notOwned' };
  if (g.building[i]) return { status: 'invalid', reason: 'occupied' };
  if (!roadAllowedOn(g.terrain[i])) return { status: 'invalid', reason: 'water' };
  if (prevAlt >= 0 && Math.abs(g.altitude[i] - prevAlt) > 1) return { status: 'invalid', reason: 'steep' };
  const existing = g.road[i];
  if (existing === roadCode) return { status: 'same' };
  if (existing) return { status: 'upgrade' };
  return { status: 'new' };
}

export function canZoneTile(state, i, zoneCode = 0, { ignoreBuilding = false } = {}) {
  const g = state.grid;
  if ((g.building[i] && !ignoreBuilding) || g.road[i] || !zoneAllowedOn(g.terrain[i], zoneCode)) return false;
  if (!fullyOwned(state) && !isOwnedIndex(state, i)) return false;
  if (zoneCode === ZONE_FOREST) return hasForest(g, i);
  return zoneCode !== ZONE_EXTRACT || hasDeposit(g, i);
}
