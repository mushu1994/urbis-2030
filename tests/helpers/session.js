import { createDefaultCatalog } from '../../src/data/defaultData.js';
import { GameSession } from '../../src/app/GameSession.js';

let catalog;
export function getCatalog() {
  catalog ??= createDefaultCatalog();
  return catalog;
}

export function newSession(opts = {}) {
  return GameSession.newGame({ catalog: getCatalog(), seed: 2030, width: 64, height: 64, name: 'Test', ...opts });
}

import { Grid } from '../../src/world/Grid.js';
import { GameState } from '../../src/app/GameState.js';
import { createBuilding } from '../../src/systems/BuildingFactory.js';

/**
 * Carte plate (herbe, altitude 1) avec un accès autoroutier à l'ouest sur la ligne `row`.
 * Idéale pour des tests unitaires contrôlés. Tout est débloqué si `unlockAll`.
 */
export function flatSession({ width = 30, height = 30, row = 15, unlockAll = true, catalog = getCatalog() } = {}) {
  const grid = new Grid(width, height);
  grid.altitude.fill(1);
  for (let x = 0; x < 3; x++) grid.road[grid.idx(x, row)] = catalog.road('road_highway').code;
  const state = new GameState({ grid, seed: 11, name: 'Plaine' });
  state.entries = [grid.idx(0, row)];
  if (unlockAll) {
    state.stats.peakPopulation = 1e6;
    state.progression.era = 3;
    for (const t of catalog.technologies) state.tech.researched[t.id] = 0;
  }
  state.economy.treasury = 1e10;
  state.economy.opening = state.economy.treasury;
  return new GameSession({ catalog, state });
}

/** Crée directement un bâtiment (sans coût) pour préparer un scénario de test. */
export function spawn(session, defId, x, y, fields = {}) {
  const b = createBuilding(session.state, session.catalog.building(defId), x, y, 0, 'growth');
  Object.assign(b, fields);
  return b;
}
