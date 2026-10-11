import { MinHeap } from '../util/MinHeap.js';

/**
 * Recherche de chemins sur le graphe routier.
 * Le coût d'un arc est le coût d'entrée dans le nœud d'arrivée (`nodeCost[k]`, en minutes),
 * ce qui permet d'intégrer la congestion sans dupliquer les arcs.
 */
export class Pathfinder {
  /** @param {import('./RoadNetwork.js').RoadNetwork} net */
  constructor(net) {
    this.net = net;
    this.heap = new MinHeap(1024);
    this.dist = new Float64Array(0);
    this.prev = new Int32Array(0);
    this.closed = new Uint8Array(0);
  }

  #ensure() {
    const n = this.net.n;
    if (this.dist.length !== n) {
      this.dist = new Float64Array(n).fill(Infinity);
      this.prev = new Int32Array(n).fill(-1);
      this.closed = new Uint8Array(n);
      this.order = new Int32Array(n);
      this.touched = new Int32Array(n);
      this.touchedCount = 0;
    }
  }

  /**
   * Dijkstra multi-sources. Résultats dans `this.dist` (Infinity si inaccessible) et `this.prev`.
   * @param {number[]} sources nœuds de départ
   * @param {Float32Array|Float64Array} nodeCost coût d'entrée de chaque nœud
   * @param {number} [maxCost] arrêt au-delà de ce coût
   */
  dijkstra(sources, nodeCost, maxCost = Infinity) {
    this.#ensure();
    const { adjStart, adj } = this.net;
    const dist = this.dist;
    const prev = this.prev;
    // Réinitialisation limitée aux nœuds atteints lors de l'appel précédent (pas de parcours complet).
    const touched = this.touched;
    for (let k = 0; k < this.touchedCount; k++) {
      dist[touched[k]] = Infinity;
      prev[touched[k]] = -1;
    }
    let nTouched = 0;
    const heap = this.heap;
    heap.clear();
    for (const s of sources) {
      if (s < 0 || dist[s] === 0) continue;
      dist[s] = 0;
      touched[nTouched++] = s;
      heap.push(s, 0);
    }
    // `order` reçoit les nœuds dans l'ordre de fixation (distances croissantes) : permet de
    // remonter des flux le long de l'arbre des plus courts chemins en un seul passage.
    const order = this.order;
    let count = 0;
    while (heap.size) {
      const k = heap.pop();
      const d = heap.lastPrio;
      if (d > dist[k]) continue;
      if (d > maxCost) break;
      order[count++] = k;
      for (let e = adjStart[k]; e < adjStart[k + 1]; e++) {
        const m = adj[e];
        const nd = d + nodeCost[m];
        if (nd < dist[m]) {
          if (dist[m] === Infinity) touched[nTouched++] = m;
          dist[m] = nd;
          prev[m] = k;
          heap.push(m, nd);
        }
      }
    }
    this.orderCount = count;
    this.touchedCount = nTouched;
    // Les nœuds au-delà de maxCost restent marqués inaccessibles.
    if (Number.isFinite(maxCost)) {
      for (let k = 0; k < nTouched; k++) if (dist[touched[k]] > maxCost) dist[touched[k]] = Infinity;
    }
    return dist;
  }

  /**
   * A* entre deux nœuds, heuristique de Manhattan × coût minimal par nœud (admissible).
   * @returns {{path:number[], cost:number} | null} chemin en indices de nœuds (départ inclus)
   */
  aStar(start, goal, nodeCost, minNodeCost) {
    this.#ensure();
    if (start < 0 || goal < 0) return null;
    const net = this.net;
    const { adjStart, adj, nodes } = net;
    const width = this._width;
    const dist = this.dist;
    const prev = this.prev;
    const closed = this.closed;
    dist.fill(Infinity);
    prev.fill(-1);
    closed.fill(0);
    this.touchedCount = 0;
    const gx = nodes[goal] % width;
    const gy = (nodes[goal] / width) | 0;
    const h = (k) => (Math.abs((nodes[k] % width) - gx) + Math.abs(((nodes[k] / width) | 0) - gy)) * minNodeCost;
    const heap = this.heap;
    heap.clear();
    dist[start] = 0;
    heap.push(start, h(start));
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      if (k === goal) break;
      closed[k] = 1;
      for (let e = adjStart[k]; e < adjStart[k + 1]; e++) {
        const m = adj[e];
        if (closed[m]) continue;
        const nd = dist[k] + nodeCost[m];
        if (nd < dist[m]) {
          dist[m] = nd;
          prev[m] = k;
          heap.push(m, nd + h(m));
        }
      }
    }
    let result = null;
    if (Number.isFinite(dist[goal])) {
      const path = [];
      for (let k = goal; k >= 0; k = prev[k]) path.push(k);
      path.reverse();
      result = { path, cost: dist[goal] };
    }
    // Remise à zéro complète pour les appels Dijkstra suivants (qui ne réinitialisent que les nœuds touchés).
    dist.fill(Infinity);
    prev.fill(-1);
    return result;
  }

  /** Largeur de la grille (nécessaire à l'heuristique). */
  setGridWidth(w) {
    this._width = w;
  }
}
