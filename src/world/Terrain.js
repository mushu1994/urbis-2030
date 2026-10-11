/** Types de terrain (codes stockés dans la grille). L'ordre correspond à TERRAIN_NAMES. */
export const TERRAIN = Object.freeze({ GRASS: 0, WATER: 1, FOREST: 2, SAND: 3, ROCK: 4 });

export const TERRAIN_LABELS = ['Prairie', 'Eau', 'Forêt', 'Sable', 'Roche'];

/** Coût de défrichement d'une case de forêt avant construction (euros). */
export const CLEARING_COST_EUROS = 15;

export const MAX_ALTITUDE = 4;

export function isWater(code) {
  return code === TERRAIN.WATER;
}

/** Une route peut-elle être posée sur ce terrain ? */
export function roadAllowedOn(code) {
  return code !== TERRAIN.WATER;
}

/** Une zone peut-elle être tracée sur ce terrain ? */
export function zoneAllowedOn(code) {
  return code === TERRAIN.GRASS || code === TERRAIN.SAND || code === TERRAIN.FOREST;
}
