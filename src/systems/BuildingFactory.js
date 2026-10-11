import { TERRAIN } from '../world/Terrain.js';
import { footprintOf, findAccess } from '../world/PlacementSystem.js';

/**
 * Création et suppression des bâtiments dans l'état du monde.
 * Ces fonctions ne valident rien : elles sont appelées par les services qui ont déjà validé l'action.
 */

/**
 * @param {import('../app/GameState.js').GameState} state
 * @param {import('../data/Catalog.js').BuildingDef} def
 * @param {'player'|'growth'} origin
 * @returns {import('../app/GameState.js').Building}
 */
export function createBuilding(state, def, x, y, rot, origin) {
  const g = state.grid;
  const { w, h } = footprintOf(def, rot);
  const id = state.nextBuildingId++;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = g.idx(x + dx, y + dy);
      g.building[i] = id;
      if (g.terrain[i] === TERRAIN.FOREST) g.terrain[i] = TERRAIN.GRASS;
      g.touch(i);
    }
  }
  const b = {
    id,
    defId: def.id,
    x,
    y,
    w,
    h,
    rot,
    origin,
    builtTick: state.time.tick,
    incomeClass: def.capacity.residents ? def.capacity.incomeClass : null,
    residents: 0,
    workforce: 0,
    employed: 0,
    qualification: def.capacity.residents ? 0 : def.capacity.qualification,
    jobsFilled: 0,
    satisfaction: 60,
    rent: 0,
    powered: false,
    watered: false,
    access: findAccess(state, x, y, w, h),
    abandoned: false,
    counters: {},
    commute: 0,
    logisticsHandled: 0,
    assetId: 0
  };
  state.buildings.set(id, b);
  markNetworksDirty(state);
  return b;
}

/** Retire un bâtiment de la grille et de l'état. */
export function removeBuilding(state, b) {
  const g = state.grid;
  for (let dy = 0; dy < b.h; dy++) {
    for (let dx = 0; dx < b.w; dx++) {
      const i = g.idx(b.x + dx, b.y + dy);
      if (g.building[i] === b.id) g.building[i] = 0;
      g.touch(i);
    }
  }
  state.buildings.delete(b.id);
  markNetworksDirty(state);
}

/** Remplace la définition d'un bâtiment (évolution ou déclin de niveau) en conservant ses occupants. */
export function changeBuildingDef(state, b, def) {
  b.defId = def.id;
  if (def.capacity.residents) {
    b.incomeClass = def.capacity.incomeClass;
    b.residents = Math.min(b.residents, def.capacity.residents);
  }
  b.jobsFilled = Math.min(b.jobsFilled, def.capacity.jobs);
  b.counters = {};
  const g = state.grid;
  for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) g.touch(g.idx(b.x + dx, b.y + dy));
  state.dirty.utilities = true;
}

export function markNetworksDirty(state) {
  state.dirty.utilities = true;
  state.dirty.environment = true;
  state.dirty.modifiers = true;
}
