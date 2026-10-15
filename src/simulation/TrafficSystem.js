import { SIM } from './config.js';
import { Pathfinder } from '../systems/Pathfinding.js';
import { BUS_ROAD_FACTOR } from './TransitSystem.js';

/** Facteur de congestion de type BPR : temps = temps libre × (1 + 0,15 (v/c)^4), borné. */
export function bpr(vc) {
  return Math.min(6, 1 + 0.15 * Math.pow(vc, 4));
}

/**
 * Simulation agrégée des déplacements.
 * Les déplacements domicile-travail, achats et livraisons sont affectés au réseau routier sous forme de flux
 * journaliers (véhicules/jour) le long des plus courts chemins (Dijkstra pondéré par la congestion du cycle précédent),
 * avec une distribution gravitaire des destinations.
 *
 * Le calcul est incrémental : quelques origines sont traitées à chaque tick ; à la fin d'un cycle complet
 * les flux sont publiés, la congestion recalculée et un nouveau cycle commence.
 * Aucun trajet n'est recalculé à chaque image.
 */
export class TrafficSystem {
  /**
   * @param {{catalog:any, network: import('../systems/RoadNetwork.js').RoadNetwork, transport: import('../systems/TransportService.js').TransportService, bus?: any}} deps
   */
  constructor({ catalog, network, transport, bus }) {
    this.catalog = catalog;
    this.network = network;
    this.transport = transport;
    this.bus = bus;
    this.pf = new Pathfinder(network);
    this.flowAt = new Float64Array(0);
  }

  /** Coût d'entrée de chaque nœud (minutes), selon la congestion publiée. */
  buildCost(state) {
    const net = this.network;
    const g = state.grid;
    const cost = new Float64Array(net.n);
    const ttm = state.modifiers.travelTimeMult ?? 1;
    for (let k = 0; k < net.n; k++) cost[k] = net.baseMinutes[k] * ttm * bpr(g.congestion[net.nodes[k]]);
    return cost;
  }

  #startCycle(state) {
    const net = this.network;
    const t = state.traffic;
    const cat = this.catalog;
    t.origins = [...state.buildings.values()]
      .filter((b) => b.residents > 0 && b.access >= 0 && net.nodeOf[b.access] >= 0)
      .map((b) => b.id)
      .sort((a, b) => a - b);
    t.cursor = 0;
    t.acc = new Float32Array(state.grid.size);
    t.cost = this.buildCost(state);
    t.jobW = new Float64Array(net.n);
    t.shopW = new Float64Array(net.n);
    for (const b of state.buildings.values()) {
      if (b.access < 0 || b.abandoned) continue;
      const k = net.nodeOf[b.access];
      if (k < 0) continue;
      const def = cat.buildingFor(b);
      if (b.jobsFilled) t.jobW[k] += b.jobsFilled;
      if (def.category === 'commerce') t.shopW[k] += b.jobsFilled + 1;
    }
    t.revision = state.revisions.roads;
    t.trips = 0;
    t.commuteSum = 0;
    t.commuteWeight = 0;
    t.unreachable = 0;
  }

  /** Traite une partie des origines (appelé à chaque tick). */
  step(state) {
    const net = this.network;
    const t = state.traffic;
    if (net.n === 0) {
      this.#publishEmpty(state);
      return;
    }
    if (!t.acc || t.revision !== state.revisions.roads || t.acc.length !== state.grid.size) this.#startCycle(state);
    if (this.flowAt.length !== net.n) this.flowAt = new Float64Array(net.n);
    this.pf.setGridWidth(state.grid.width);

    // Budget de calcul constant : moins d'origines par tick sur les grands réseaux.
    const perTick = Math.max(4, Math.min(SIM.FREQ.trafficOriginsPerTick, Math.floor(SIM.FREQ.trafficNodeBudget / Math.max(1, net.n))));
    const end = Math.min(t.origins.length, t.cursor + perTick);
    for (; t.cursor < end; t.cursor++) {
      const b = state.buildings.get(t.origins[t.cursor]);
      if (b) this.#assignResidential(state, b);
    }
    if (t.cursor >= t.origins.length) {
      this.#assignFreight(state);
      this.#publish(state);
      this.#startCycle(state);
    }
  }

  #assignResidential(state, b) {
    const net = this.network;
    const t = state.traffic;
    const o = net.nodeOf[b.access];
    if (o < 0) return;
    const pf = this.pf;
    pf.dijkstra([o], t.cost, 40);
    const dist = pf.dist;
    const order = pf.order;
    const count = pf.orderCount;
    const flow = this.flowAt;

    const s = state.stats;
    const outShare = s.employed > 0 ? Math.min(0.8, s.commutersOut / s.employed) : 0;
    // Les voyageurs des transports en commun laissent leur voiture (un bus reste un peu sur la route).
    const tr = b.transit ?? { bus: 0, metro: 0, rail: 0, regional: 0 };
    const transitShare = Math.min(0.95, tr.bus * (1 - BUS_ROAD_FACTOR) + tr.metro + (tr.rail ?? 0) + (tr.tram ?? 0));
    const workV = this.transport.vehicleTrips(state, b.employed * SIM.TRIPS_PER_WORKER) * (1 - transitShare);
    const shopV = this.transport.vehicleTrips(state, b.residents * SIM.TRIPS_PER_RESIDENT) * (1 - transitShare * 0.6);

    let sumJ = 0;
    let sumS = 0;
    let commute = 0;
    let entry = -1;
    for (let c = 0; c < count; c++) {
      const k = order[c];
      const d = dist[k];
      if (t.jobW[k]) {
        const w = t.jobW[k] * Math.exp(-d / 18);
        sumJ += w;
        commute += w * d;
      }
      if (t.shopW[k]) sumS += t.shopW[k] * Math.exp(-d / 10);
      if (entry < 0 && net.entryNodes.includes(k)) entry = k;
    }
    const localWork = workV * (1 - (entry >= 0 ? outShare : 0));
    if (sumJ > 0) {
      for (let c = 0; c < count; c++) {
        const k = order[c];
        if (t.jobW[k]) flow[k] += (localWork * t.jobW[k] * Math.exp(-dist[k] / 18)) / sumJ;
      }
    } else {
      t.unreachable += localWork;
    }
    if (sumS > 0) {
      for (let c = 0; c < count; c++) {
        const k = order[c];
        if (t.shopW[k]) flow[k] += (shopV * t.shopW[k] * Math.exp(-dist[k] / 10)) / sumS;
      }
    }
    // Navetteurs vers la région : le train et l'hyperboucle les retirent de la route
    if (entry >= 0) flow[entry] += (workV - localWork) * (1 - (tr.regional ?? 0));
    this.#pushTree(state, count);

    const carAvg = sumJ > 0 ? commute / sumJ + 4 : entry >= 0 ? 25 : 45;
    // Temps moyen tous modes : métro plus rapide, bus plus lent (attente comprise)
    const rl = tr.rail ?? 0;
    const avg = carAvg * (1 - tr.bus - tr.metro - rl) + tr.bus * (carAvg * 1.15 + 6) + tr.metro * (carAvg * 0.6 + 4) + rl * (carAvg * 0.7 + 6);
    b.commute = Math.round(avg * 10) / 10;
    t.trips += workV + shopV;
    t.commuteSum += avg * b.employed;
    t.commuteWeight += b.employed;
  }

  /** Remonte les flux des destinations vers l'origine le long de l'arbre des plus courts chemins. */
  #pushTree(state, count) {
    const net = this.network;
    const flow = this.flowAt;
    const order = this.pf.order;
    const prev = this.pf.prev;
    const acc = state.traffic.acc;
    for (let c = count - 1; c >= 0; c--) {
      const k = order[c];
      const f = flow[k];
      if (f === 0) continue;
      acc[net.nodes[k]] += f;
      const p = prev[k];
      if (p >= 0) flow[p] += f;
      flow[k] = 0;
    }
  }

  #assignFreight(state) {
    const net = this.network;
    const routes = state.logistics.routes ?? [];
    const peak = state.modifiers.freightPeakMult ?? 1;
    const t = state.traffic;
    for (const r of routes) {
      const o = net.nodeOf[r.from];
      if (o < 0) continue;
      this.pf.dijkstra([o], t.cost, 90);
      const count = this.pf.orderCount;
      for (const [tile, trips] of r.dests) {
        const k = net.nodeOf[tile];
        if (k >= 0 && Number.isFinite(this.pf.dist[k])) this.flowAt[k] += trips * SIM.FREIGHT_PCU * peak;
      }
      this.#pushTree(state, count);
    }
  }

  #publish(state) {
    const net = this.network;
    const g = state.grid;
    const t = state.traffic;
    const capMult = state.modifiers.roadCapacityMult ?? 1;
    for (let i = 0; i < g.size; i++) {
      if (!g.road[i]) {
        g.traffic[i] = 0;
        g.congestion[i] = 0;
      }
    }
    let vkt = 0;
    let congested = 0;
    let used = 0;
    let vcSum = 0;
    const top = [];
    for (let k = 0; k < net.n; k++) {
      const i = net.nodes[k];
      const f = t.acc[i];
      // Lissage avec le cycle précédent pour éviter les oscillations de la congestion.
      const old = g.traffic[i];
      const flow = old > 0 ? (f + old) / 2 : f;
      g.traffic[i] = flow;
      const vc = flow / (net.capacity[k] * capMult);
      g.congestion[i] = vc;
      vkt += flow * SIM.TILE_KM;
      if (flow > 1) {
        used++;
        vcSum += vc;
      }
      if (vc > 0.9) congested++;
      if (flow > 20) top.push({ tile: i, flow, vc });
    }
    top.sort((a, b) => b.vc - a.vc || a.tile - b.tile);

    // Accessibilité : temps d'accès depuis le réseau régional
    const cost = this.buildCost(state);
    g.accessibility.fill(0);
    if (net.entryNodes.length) {
      this.pf.dijkstra(net.entryNodes, cost, Infinity);
      for (let k = 0; k < net.n; k++) g.accessibility[net.nodes[k]] = Number.isFinite(this.pf.dist[k]) ? this.pf.dist[k] : 999;
    }

    t.cycle++;
    t.stats = {
      vehicleTrips: Math.round(t.trips),
      vkt: Math.round(vkt),
      avgCommute: t.commuteWeight ? t.commuteSum / t.commuteWeight : 0,
      congestedTiles: congested,
      roadTiles: net.n,
      avgCongestion: used ? vcSum / used : 0,
      unreachableTrips: Math.round(t.unreachable),
      topAxes: top.slice(0, 8).map((x) => ({ x: g.xOf(x.tile), y: g.yOf(x.tile), flow: Math.round(x.flow), vc: Math.round(x.vc * 100) / 100 })),
      cycle: t.cycle
    };
    this.bus?.emit('fields:updated', { fields: ['traffic', 'congestion', 'accessibility'] });
  }

  #publishEmpty(state) {
    state.traffic.stats = { vehicleTrips: 0, vkt: 0, avgCommute: 0, congestedTiles: 0, roadTiles: 0, avgCongestion: 0, unreachableTrips: 0, topAxes: [], cycle: state.traffic.cycle };
  }
}
