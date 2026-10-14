/** Types de terrain (codes stockés dans la grille). L'ordre correspond à TERRAIN_NAMES. */
export const TERRAIN = Object.freeze({ GRASS: 0, WATER: 1, FOREST: 2, SAND: 3, ROCK: 4 });

export const TERRAIN_LABELS = ['Prairie', 'Eau', 'Forêt', 'Sable', 'Roche'];

/** Coût de défrichement d'une case de forêt avant construction (euros). */
export const CLEARING_COST_EUROS = 15;

/** Coût de dérochage d'une case de roche avant construction ou zonage (euros). */
export const ROCK_CLEARING_COST_EUROS = 60;

/** Coût du nivellement automatique (euros par case et par niveau déplacé). */
export const LEVELING_COST_EUROS = 600;

export const MAX_ALTITUDE = 4;

export function isWater(code) {
  return code === TERRAIN.WATER;
}

/** Une route peut-elle être posée sur ce terrain ? */
export function roadAllowedOn(code) {
  return code !== TERRAIN.WATER;
}

/** Codes des zones spécialisées (voir buildings.json). */
export const ZONE_AGRI = 6;
export const ZONE_EXTRACT = 7;
export const ZONE_FOREST = 8;

/** Rayon (en cases) autour d'un affleurement rocheux où l'on peut exploiter un gisement. */
export const DEPOSIT_RADIUS = 2;

/**
 * Une zone peut-elle être tracée sur ce terrain ?
 * - agriculture : prairie ou forêt (pas de sable ni de roche) ;
 * - extraction : aussi sur la roche (le gisement lui-même).
 */
export function zoneAllowedOn(code, zoneCode = 0) {
  if (zoneCode === ZONE_EXTRACT) return code !== TERRAIN.WATER;
  if (zoneCode === ZONE_FOREST) return code === TERRAIN.GRASS || code === TERRAIN.FOREST || code === TERRAIN.SAND;
  // v0.5 : la roche n'est plus un obstacle, elle est dérochée (payante) au moment du zonage
  if (zoneCode === ZONE_AGRI) return code === TERRAIN.GRASS || code === TERRAIN.FOREST || code === TERRAIN.ROCK;
  return code !== TERRAIN.WATER;
}

/** La case est-elle à portée d'une forêt exploitable (DEPOSIT_RADIUS cases au plus) ? */
export function hasForest(grid, i) {
  const x = grid.xOf(i);
  const y = grid.yOf(i);
  for (let dy = -DEPOSIT_RADIUS; dy <= DEPOSIT_RADIUS; dy++) {
    for (let dx = -DEPOSIT_RADIUS; dx <= DEPOSIT_RADIUS; dx++) {
      if (grid.inBounds(x + dx, y + dy) && grid.terrain[grid.idx(x + dx, y + dy)] === TERRAIN.FOREST) return true;
    }
  }
  return false;
}

/** La case est-elle à portée d'un gisement (roche à DEPOSIT_RADIUS cases au plus) ? */
export function hasDeposit(grid, i) {
  const x = grid.xOf(i);
  const y = grid.yOf(i);
  for (let dy = -DEPOSIT_RADIUS; dy <= DEPOSIT_RADIUS; dy++) {
    for (let dx = -DEPOSIT_RADIUS; dx <= DEPOSIT_RADIUS; dx++) {
      if (grid.inBounds(x + dx, y + dy) && grid.terrain[grid.idx(x + dx, y + dy)] === TERRAIN.ROCK) return true;
    }
  }
  return false;
}
