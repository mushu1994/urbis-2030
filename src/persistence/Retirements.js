import { removeBuilding } from '../systems/BuildingFactory.js';

/**
 * v1.4 : les lignes électriques disparaissent du jeu (routes et bâtiments contigus conduisent déjà le courant).
 * Dans une ancienne partie, une chaîne de pylônes est retirée si elle ne relie pas deux réseaux distincts ;
 * une chaîne qui fait vraiment la jonction entre deux réseaux est conservée (elle n'est simplement plus constructible).
 * @param {import('../app/GameState.js').GameState} state
 * @returns {number} nombre de pylônes retirés
 */
export function retireUselessPowerLines(state) {
  const g = state.grid;
  const pylon = new Uint8Array(g.size);
  const lines = [];
  for (const b of state.buildings.values()) {
    if (b.defId !== 'power_line') continue;
    lines.push(b);
    pylon[g.idx(b.x, b.y)] = 1;
  }
  if (!lines.length) return 0;
  // Réseaux électriques sans les pylônes (routes et bâtiments contigus)
  const comp = new Int32Array(g.size).fill(-1);
  const conducts = (i) => !pylon[i] && (g.road[i] > 0 || g.building[i] > 0);
  const nb = new Int32Array(4);
  const stack = [];
  let n = 0;
  for (let s = 0; s < g.size; s++) {
    if (comp[s] >= 0 || !conducts(s)) continue;
    comp[s] = n;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      const c = g.neighbors4(i, nb);
      for (let k = 0; k < c; k++) {
        const o = nb[k];
        if (comp[o] < 0 && conducts(o)) {
          comp[o] = n;
          stack.push(o);
        }
      }
    }
    n++;
  }
  // Chaînes de pylônes : utiles seulement si elles touchent au moins deux réseaux différents
  const seen = new Uint8Array(g.size);
  const byTile = new Map(lines.map((b) => [g.idx(b.x, b.y), b]));
  let removed = 0;
  for (const start of byTile.keys()) {
    if (seen[start]) continue;
    const chain = [];
    const nets = new Set();
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      chain.push(i);
      const c = g.neighbors4(i, nb);
      for (let k = 0; k < c; k++) {
        const o = nb[k];
        if (pylon[o]) {
          if (!seen[o]) {
            seen[o] = 1;
            stack.push(o);
          }
        } else if (comp[o] >= 0) nets.add(comp[o]);
      }
    }
    if (nets.size >= 2) continue;
    for (const i of chain) {
      const b = byTile.get(i);
      const k = state.economy.assets.findIndex((a) => a.id === b.assetId);
      if (k >= 0) state.economy.assets.splice(k, 1);
      removeBuilding(state, b);
      removed++;
    }
  }
  return removed;
}
