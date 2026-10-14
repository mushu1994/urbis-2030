import { EnvironmentSystem } from './EnvironmentSystem.js';
import { isOperational } from './Modifiers.js';

/** Parts modales maximales (avant limitation par la capacité). */
const MAX_SHARE = { bus: 0.32, metro: 0.5, rail: 0.55, railLocal: 0.3 };
/** Déplacements quotidiens vers la région par habitant (études, loisirs, achats, démarches), hors navettes de travail. */
export const REGIONAL_TRIP_RATE = 0.25;
/** Part des navetteurs entrants qui prennent le train quand leur emploi est près d'une gare. */
const INBOUND_RAIL_SHARE = 0.6;
/** Une partie du trajet en bus reste sur la route : un bus remplace environ 16 voitures. */
export const BUS_ROAD_FACTOR = 0.06;

/** Coût d'exploitation par voyageur (euros) : conducteurs, énergie, maintenance du matériel roulant. */
export const OPERATING_COST = { bus: 1.3, metro: 0.8, rail: 1.0 };

/** Fréquentation en fonction du prix du billet (en euros). */
export function fareElasticity(fare) {
  return Math.max(0.4, Math.min(1.3, 1.25 - 0.2 * fare));
}

export const TRANSIT_LABELS = { bus: 'Bus', metro: 'Métro', rail: 'Train et hyperboucle' };

/** Bonus de capacité d'une gare reliée par les rails au réseau régional (bord de la carte). */
export const RAIL_LINK_BONUS = 1.5;

/** Cases de voie ferrée reliées (par des rails contigus) à une case de rail au bord de la carte. */
export function linkedRailTiles(g) {
  const seen = new Uint8Array(g.size);
  const queue = [];
  for (let i = 0; i < g.size; i++) {
    if (!g.rail[i]) continue;
    const x = g.xOf(i);
    const y = g.yOf(i);
    if (x === 0 || y === 0 || x === g.width - 1 || y === g.height - 1) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  const nb = new Int32Array(4);
  while (queue.length) {
    const i = queue.pop();
    const n = g.neighbors4(i, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      if (g.rail[j] && !seen[j]) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  return seen;
}

/** La gare touche-t-elle (par un côté de son emprise) une voie reliée ? */
export function touchesRail(g, b, linked) {
  for (let dy = -1; dy <= b.h; dy++) {
    for (let dx = -1; dx <= b.w; dx++) {
      const inside = dx >= 0 && dy >= 0 && dx < b.w && dy < b.h;
      if (inside) continue;
      const x = b.x + dx;
      const y = b.y + dy;
      if (g.inBounds(x, y) && linked[g.idx(x, y)]) return true;
    }
  }
  return false;
}

/**
 * Transports en commun (agrégés, comme le trafic routier).
 * - Bus : un arrêt dessert un rayon de quelques cases s'il est relié par la route à un dépôt ;
 *   la capacité totale est celle des dépôts du même réseau.
 * - Métro : les stations sont reliées entre elles en souterrain (au moins deux stations alimentées).
 * - Train et hyperboucle : relient la ville à la région (navetteurs sortants et entrants, déplacements
 *   régionaux des habitants) et, à partir de deux gares, assurent aussi des trajets internes.
 * Chaque ménage obtient une part modale selon la desserte de son logement et la part des emplois desservis.
 * Les voyageurs en transport en commun ne prennent pas la voiture (TrafficSystem), paient un billet
 * (EconomySystem) et voient leur temps de trajet modifié.
 */
export class TransitSystem {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, network: import('../systems/RoadNetwork.js').RoadNetwork}} deps
   */
  constructor({ catalog, network }) {
    this.catalog = catalog;
    this.network = network;
  }

  /** Prix effectif du billet (politiques comprises). */
  effectiveFare(state) {
    return Math.max(0, (state.economy.tariffs.transit ?? 1.2) * (state.modifiers['transit.fareMult'] ?? 1));
  }

  update(state) {
    const g = state.grid;
    const cat = this.catalog;
    const mods = state.modifiers;
    const net = this.network;
    g.transitBus.fill(0);
    g.transitMetro.fill(0);
    g.transitRail.fill(0);

    // 1. Équipements
    const depotCapByComp = new Map();
    const busStops = [];
    const metroStations = [];
    const railStations = [];
    let metroCap = 0;
    let railCap = 0;
    let depots = 0;
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      const tr = def.capacity.transit;
      if (!tr) continue;
      const ok = isOperational(state, b) && b.access >= 0 && (def.networks.power === 0 || b.powered);
      b.transitActive = false;
      if (!ok) continue;
      const staffing = def.capacity.jobs ? Math.min(1, 0.3 + (b.jobsFilled / def.capacity.jobs) * 0.7) : 1;
      if (tr.mode === 'bus' && tr.depot) {
        const comp = net.componentOfTile(b.access);
        const cap = tr.capacity * staffing * (mods['transit.busCapacityMult'] ?? 1);
        depotCapByComp.set(comp, (depotCapByComp.get(comp) ?? 0) + cap);
        depots++;
        b.transitActive = true;
      } else if (tr.mode === 'bus') busStops.push({ b, tr });
      else if (tr.mode === 'metro') metroStations.push({ b, tr, cap: tr.capacity * staffing });
      else if (tr.mode === 'rail') railStations.push({ b, tr, cap: tr.capacity * staffing });
    }
    const cx = (b) => b.x + (b.w - 1) / 2;
    const cy = (b) => b.y + (b.h - 1) / 2;
    let busCap = 0;
    const servedComps = new Set();
    for (const { b, tr } of busStops) {
      const comp = net.componentOfTile(b.access);
      if (!depotCapByComp.has(comp)) continue; // arrêt sans dépôt joignable par la route
      servedComps.add(comp);
      b.transitActive = true;
      EnvironmentSystem.splat(g, g.transitBus, cx(b), cy(b), 1.4, tr.radius);
    }
    for (const comp of servedComps) busCap += depotCapByComp.get(comp);
    if (metroStations.length >= 2) {
      for (const s of metroStations) {
        s.b.transitActive = true;
        metroCap += s.cap;
        EnvironmentSystem.splat(g, g.transitMetro, cx(s.b), cy(s.b), 1.4, s.tr.radius);
      }
    }
    // Voies ferrées (v0.6) : une gare reliée par les rails au bord de la carte reçoit des trains régionaux (+50 %)
    const linked = railStations.length ? linkedRailTiles(g) : null;
    for (const s of railStations) {
      s.b.railLinked = !!linked && touchesRail(g, s.b, linked);
      if (s.b.railLinked) s.cap *= RAIL_LINK_BONUS;
    }
    for (const s of railStations) {
      s.b.transitActive = true;
      railCap += s.cap;
      EnvironmentSystem.splat(g, g.transitRail, cx(s.b), cy(s.b), 1.4, s.tr.radius);
    }
    for (const f of [g.transitBus, g.transitMetro, g.transitRail]) {
      for (let i = 0; i < g.size; i++) if (f[i] > 1) f[i] = 1;
    }

    // 2. Part des emplois desservis (destinations)
    let jobs = 0;
    let jobsBus = 0;
    let jobsMetro = 0;
    let jobsRail = 0;
    for (const b of state.buildings.values()) {
      if (!b.jobsFilled || b.abandoned) continue;
      const i = g.idx(b.x, b.y);
      jobs += b.jobsFilled;
      jobsBus += b.jobsFilled * g.transitBus[i];
      jobsMetro += b.jobsFilled * g.transitMetro[i];
      jobsRail += b.jobsFilled * g.transitRail[i];
    }
    const fracBus = jobs ? jobsBus / jobs : 0;
    const fracMetro = jobs ? jobsMetro / jobs : 0;
    const fracRail = jobs ? jobsRail / jobs : 0;
    const railLocal = railStations.length >= 2;

    // 3. Parts modales des ménages et demande
    const fare = this.effectiveFare(state);
    const rid = (mods['transit.ridershipMult'] ?? 1) * fareElasticity(fare);
    const s = state.stats;
    const outShare = s.employed > 0 ? Math.min(0.8, s.commutersOut / s.employed) : 0;
    const res = [];
    let dBus = 0;
    let dMetro = 0;
    let dRail = 0;
    let coveredResidents = 0;
    for (const b of state.buildings.values()) {
      if (!b.residents) {
        b.transit = null;
        continue;
      }
      const i = g.idx(b.x, b.y);
      let sb = MAX_SHARE.bus * g.transitBus[i] * (0.3 + 0.7 * fracBus) * rid;
      let sm = MAX_SHARE.metro * g.transitMetro[i] * (0.3 + 0.7 * fracMetro) * rid;
      let sl = railLocal ? MAX_SHARE.railLocal * g.transitRail[i] * (0.3 + 0.7 * fracRail) * rid : 0;
      const total = sb + sm + sl;
      if (total > 0.7) {
        sb *= 0.7 / total;
        sm *= 0.7 / total;
        sl *= 0.7 / total;
      }
      // Part du train pour les déplacements vers la région (navettes sortantes et déplacements régionaux)
      const sr = Math.min(0.8, MAX_SHARE.rail * g.transitRail[i] * rid);
      const trips = b.employed * 2 + b.residents * 0.3;
      const regionalTrips = b.employed * 2 * outShare + b.residents * REGIONAL_TRIP_RATE;
      dBus += trips * sb;
      dMetro += trips * sm;
      dRail += trips * sl + regionalTrips * sr;
      if (g.transitBus[i] > 0.2 || g.transitMetro[i] > 0.2 || g.transitRail[i] > 0.2) coveredResidents += b.residents;
      res.push({ b, sb, sm, sl, sr, trips, regionalTrips });
    }
    // Navetteurs venant de la région : ceux dont l'emploi est près d'une gare arrivent en train
    const inbound = railStations.length ? (s.commutersIn ?? 0) * 2 * fracRail * INBOUND_RAIL_SHARE * Math.min(1, rid) : 0;
    dRail += inbound;

    // 4. Limitation par la capacité
    const kBus = dBus > busCap ? (busCap > 0 ? busCap / dBus : 0) : 1;
    const kMetro = dMetro > metroCap ? (metroCap > 0 ? metroCap / dMetro : 0) : 1;
    const kRail = dRail > railCap ? (railCap > 0 ? railCap / dRail : 0) : 1;
    let tripsAvoided = 0;
    for (const { b, sb, sm, sl, sr, trips, regionalTrips } of res) {
      // rail : part des trajets internes en train ; regional : part des trajets vers la région
      b.transit = { bus: sb * kBus, metro: sm * kMetro, rail: sl * kRail, regional: sr * kRail };
      tripsAvoided += trips * (b.transit.bus * (1 - BUS_ROAD_FACTOR) + b.transit.metro + b.transit.rail) + regionalTrips * b.transit.regional;
    }
    tripsAvoided += inbound * kRail;
    const passengers = { bus: dBus * kBus, metro: dMetro * kMetro, rail: dRail * kRail };
    // Fréquentation de chaque équipement (au prorata de sa capacité dans son mode)
    const activeStops = busStops.filter((x) => x.b.transitActive);
    for (const { b } of activeStops) b.transitPassengers = passengers.bus / activeStops.length;
    for (const { b } of busStops) if (!b.transitActive) b.transitPassengers = 0;
    for (const st of metroStations) st.b.transitPassengers = st.b.transitActive && metroCap ? (passengers.metro * st.cap) / metroCap : 0;
    for (const st of railStations) st.b.transitPassengers = railCap ? (passengers.rail * st.cap) / railCap : 0;
    state.transit.passengersPerDay = passengers.bus + passengers.metro + passengers.rail;
    state.transit.operatingCostPerDay =
      (passengers.bus * OPERATING_COST.bus + passengers.metro * OPERATING_COST.metro + passengers.rail * OPERATING_COST.rail) *
      (mods['upkeep.transport'] ?? 1);
    state.transit.stats = {
      passengers,
      demand: { bus: dBus, metro: dMetro, rail: dRail },
      capacity: { bus: busCap, metro: metroCap, rail: railCap },
      saturation: { bus: busCap ? dBus / busCap : 0, metro: metroCap ? dMetro / metroCap : 0, rail: railCap ? dRail / railCap : 0 },
      stops: busStops.length,
      activeStops: busStops.filter((x) => x.b.transitActive).length,
      depots,
      metroStations: metroStations.length,
      railStations: railStations.length,
      railInbound: inbound * kRail,
      carTripsAvoided: tripsAvoided,
      coveredShare: s.population ? coveredResidents / s.population : 0,
      fare,
      ridershipFactor: rid
    };
  }

  /** Part de voyageurs d'un ménage en transport en commun (pour les trajets internes). */
  static share(b) {
    const t = b.transit;
    return t ? t.bus + t.metro + (t.rail ?? 0) : 0;
  }
}
