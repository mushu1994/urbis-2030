import { Pathfinder } from './Pathfinding.js';
import { SIM } from '../simulation/config.js';
import { bpr } from '../simulation/TrafficSystem.js';

const MAX_ENTRIES = 256;

/**
 * Itinéraires ponctuels (inspecteur, outils, tests) avec cache.
 * - Les coûts tiennent compte de la congestion publiée par le dernier cycle de trafic.
 * - Le cache est invalidé quand le réseau change (révision) ou qu'un nouveau cycle de trafic est publié.
 * - Un trajet impossible est signalé explicitement, avec la raison.
 */
export class RouteService {
  /** @param {{network: import('./RoadNetwork.js').RoadNetwork}} deps */
  constructor({ network }) {
    this.network = network;
    this.pf = new Pathfinder(network);
    this.cache = new Map();
    this.key = '';
    this.cost = null;
    this.hits = 0;
    this.misses = 0;
  }

  #prepare(state) {
    const key = `${this.network.version}:${state.traffic?.cycle ?? 0}`;
    if (key === this.key && this.cost) return;
    this.key = key;
    this.cache.clear();
    const net = this.network;
    const g = state.grid;
    const ttm = state.modifiers?.travelTimeMult ?? 1;
    this.cost = new Float64Array(net.n);
    this.minCost = Infinity;
    for (let k = 0; k < net.n; k++) {
      this.cost[k] = net.baseMinutes[k] * ttm * bpr(g.congestion[net.nodes[k]]);
      if (net.baseMinutes[k] * ttm < this.minCost) this.minCost = net.baseMinutes[k] * ttm;
    }
    this.pf.setGridWidth(g.width);
  }

  /**
   * @param {number} fromTile case de route de départ
   * @param {number} toTile case de route d'arrivée
   * @returns {{ok:true, tiles:number[], minutes:number, km:number, cached:boolean} | {ok:false, reason:string, cached:boolean}}
   */
  route(state, fromTile, toTile) {
    this.#prepare(state);
    const ck = `${fromTile}>${toTile}`;
    const hit = this.cache.get(ck);
    if (hit) {
      this.hits++;
      return { ...hit, cached: true };
    }
    this.misses++;
    const net = this.network;
    const a = fromTile >= 0 ? net.nodeOf[fromTile] : -1;
    const b = toTile >= 0 ? net.nodeOf[toTile] : -1;
    let result;
    if (a < 0 || b < 0) {
      result = { ok: false, reason: 'Le départ ou l\'arrivée n\'est pas sur une route' };
    } else if (net.component[a] !== net.component[b]) {
      result = { ok: false, reason: 'Aucun itinéraire : les deux points ne sont pas reliés par la route' };
    } else {
      const r = this.pf.aStar(a, b, this.cost, this.minCost);
      result = r
        ? { ok: true, tiles: r.path.map((k) => net.nodes[k]), minutes: r.cost, km: (r.path.length - 1) * SIM.TILE_KM }
        : { ok: false, reason: 'Aucun itinéraire trouvé' };
    }
    if (this.cache.size >= MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(ck, result);
    return { ...result, cached: false };
  }

  /** Trajet d'une case de route jusqu'à l'accès autoroutier le plus proche. */
  routeToHighway(state, fromTile) {
    let best = null;
    for (const e of state.entries) {
      const r = this.route(state, fromTile, e);
      if (r.ok && (!best || r.minutes < best.minutes)) best = r;
      if (!best && !r.ok) best = r;
    }
    return best ?? { ok: false, reason: 'La carte n\'a pas d\'accès autoroutier', cached: false };
  }
}
