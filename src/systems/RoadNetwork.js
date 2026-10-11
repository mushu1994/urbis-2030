import { SIM } from '../simulation/config.js';
import { ROAD_REACH } from '../world/Grid.js';
import { TERRAIN } from '../world/Terrain.js';

/**
 * Graphe routier construit à partir des cases de route.
 * Chaque nœud est une case de route (« segment ») ; deux nœuds sont reliés s'ils sont voisins
 * et que la dénivellation ne dépasse pas un niveau.
 * Représentation compacte (CSR) pour des parcours rapides et sans allocation.
 */
export class RoadNetwork {
  /** @param {import('../data/Catalog.js').Catalog} catalog */
  constructor(catalog) {
    this.catalog = catalog;
    this.version = 0;
    this.n = 0;
    this.nodes = new Int32Array(0);
    this.nodeOf = new Int32Array(0);
    this.adjStart = new Int32Array(1);
    this.adj = new Int32Array(0);
    this.component = new Int32Array(0);
    this.capacity = new Float32Array(0);
    this.baseMinutes = new Float32Array(0);
    this.roadCode = new Uint8Array(0);
    this.componentSize = [];
    this.outsideComponents = new Set();
    this.entryNodes = [];
  }

  /** Reconstruit le graphe à partir de la grille. */
  rebuild(state) {
    const g = state.grid;
    const nodes = [];
    for (let i = 0; i < g.size; i++) if (g.road[i]) nodes.push(i);
    const n = nodes.length;
    const nodeOf = new Int32Array(g.size).fill(-1);
    for (let k = 0; k < n; k++) nodeOf[nodes[k]] = k;

    const adjStart = new Int32Array(n + 1);
    const tmp = [];
    const nb = new Int32Array(4);
    for (let k = 0; k < n; k++) {
      adjStart[k] = tmp.length;
      const i = nodes[k];
      const c = g.neighbors4(i, nb);
      for (let j = 0; j < c; j++) {
        const o = nb[j];
        const m = nodeOf[o];
        if (m >= 0 && Math.abs(g.surfaceAlt(o) - g.surfaceAlt(i)) <= 1) tmp.push(m);
      }
    }
    adjStart[n] = tmp.length;

    const capacity = new Float32Array(n);
    const baseMinutes = new Float32Array(n);
    const roadCode = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const road = this.catalog.roadByCode(g.road[nodes[k]]);
      roadCode[k] = road.code;
      capacity[k] = road.capacity;
      baseMinutes[k] = (SIM.TILE_KM / road.speedKmh) * 60;
    }

    // Composantes connexes
    const component = new Int32Array(n).fill(-1);
    const componentSize = [];
    const stack = new Int32Array(Math.max(1, n));
    let comp = 0;
    for (let s = 0; s < n; s++) {
      if (component[s] >= 0) continue;
      let top = 0;
      stack[top++] = s;
      component[s] = comp;
      let size = 0;
      while (top > 0) {
        const k = stack[--top];
        size++;
        for (let e = adjStart[k]; e < adjStart[k + 1]; e++) {
          const m = tmp[e];
          if (component[m] < 0) {
            component[m] = comp;
            stack[top++] = m;
          }
        }
      }
      componentSize.push(size);
      comp++;
    }

    this.n = n;
    this.nodes = Int32Array.from(nodes);
    this.nodeOf = nodeOf;
    this.adjStart = adjStart;
    this.adj = Int32Array.from(tmp);
    this.component = component;
    this.componentSize = componentSize;
    this.capacity = capacity;
    this.baseMinutes = baseMinutes;
    this.roadCode = roadCode;
    this.entryNodes = state.entries.map((i) => nodeOf[i]).filter((k) => k >= 0);
    this.outsideComponents = new Set(this.entryNodes.map((k) => component[k]));
    this.version++;
  }

  /** Composante connexe de la route desservant une case (ou -1). */
  componentOfTile(i) {
    const k = i >= 0 ? this.nodeOf[i] : -1;
    return k >= 0 ? this.component[k] : -1;
  }

  isConnectedToOutside(tileIndex) {
    const c = this.componentOfTile(tileIndex);
    return c >= 0 && this.outsideComponents.has(c);
  }

  /** Description d'un segment (inspecteur, tests). */
  segment(state, tileIndex) {
    const k = this.nodeOf[tileIndex];
    if (k < 0) return null;
    const road = this.catalog.roadByCode(this.roadCode[k]);
    const bridge = !!state.grid.bridge[tileIndex];
    const neighbors = [];
    for (let e = this.adjStart[k]; e < this.adjStart[k + 1]; e++) neighbors.push(this.nodes[this.adj[e]]);
    return {
      tile: tileIndex,
      category: road.id,
      name: bridge ? `Pont (${road.name.toLowerCase()})` : road.name,
      bridge,
      deckAltitude: bridge ? state.grid.bridge[tileIndex] - 1 : null,
      capacity: this.capacity[k] * (state.modifiers.roadCapacityMult ?? 1),
      speedKmh: road.speedKmh,
      upkeepCents: bridge ? road.bridgeUpkeepCents : road.upkeepCents,
      flow: state.grid.traffic[tileIndex],
      congestion: state.grid.congestion[tileIndex],
      neighbors,
      component: this.component[k],
      connectedToOutside: this.outsideComponents.has(this.component[k])
    };
  }

  /**
   * Distance (en cases, ≤ ROAD_REACH) de chaque case à la route la plus proche, et route correspondante.
   * Les parcelles zonées ne se développent que si elles sont à portée d'une route.
   */
  computeReach(state) {
    const g = state.grid;
    g.roadDist.fill(255);
    g.nearestRoad.fill(-1);
    let queue = [];
    for (let i = 0; i < g.size; i++) {
      if (g.road[i]) {
        g.roadDist[i] = 0;
        g.nearestRoad[i] = i;
        // Un pont ne dessert pas les parcelles des berges : il n'est pas une source de desserte.
        if (!g.bridge[i]) queue.push(i);
      }
    }
    const nb = new Int32Array(4);
    for (let d = 1; d <= ROAD_REACH; d++) {
      const next = [];
      for (const i of queue) {
        const c = g.neighbors4(i, nb);
        for (let j = 0; j < c; j++) {
          const o = nb[j];
          if (g.roadDist[o] !== 255 || g.terrain[o] === TERRAIN.WATER) continue;
          if (Math.abs(g.altitude[o] - g.altitude[i]) > 1) continue;
          g.roadDist[o] = d;
          g.nearestRoad[o] = g.nearestRoad[i];
          next.push(o);
        }
      }
      queue = next;
    }
  }
}
