import { EnvironmentSystem } from './EnvironmentSystem.js';
import { isOperational } from './Modifiers.js';
import { LINE_MODES, lineTiming, serviceQuality } from './LineSystem.js';

/** Parts modales maximales (avant limitation par la capacité). */
const MAX_SHARE = { bus: 0.32, metro: 0.5, rail: 0.55, railLocal: 0.3, tram: 0.42 };
/** Déplacements quotidiens vers la région par habitant (études, loisirs, achats, démarches), hors navettes de travail. */
export const REGIONAL_TRIP_RATE = 0.25;
/** Part des navetteurs entrants qui prennent le train quand leur emploi est près d'une gare. */
const INBOUND_RAIL_SHARE = 0.6;
/** Une partie du trajet en bus reste sur la route : un bus remplace environ 16 voitures. */
export const BUS_ROAD_FACTOR = 0.06;

/** Coût d'exploitation par voyageur (euros) : conducteurs, énergie, maintenance du matériel roulant. */
export const OPERATING_COST = { bus: 1.3, metro: 0.8, rail: 1.0, tram: 0.7 };

/** Fréquentation en fonction du prix du billet (en euros). */
export function fareElasticity(fare) {
  return Math.max(0.4, Math.min(1.3, 1.25 - 0.2 * fare));
}

export const TRANSIT_LABELS = { bus: 'Bus', tram: 'Tramway', metro: 'Métro', rail: 'Train et hyperboucle' };

/**
 * Qualité de desserte d'un arrêt hors ligne quand des lignes de bus existent (v0.8) : le « réseau de base » est assuré
 * par les bus restés au dépôt, moins fréquents qu'une ligne bien dotée (1 = un passage toutes les 6 minutes).
 */
export const BASE_NETWORK_QUALITY = 0.6;

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
    g.transitTram.fill(0);

    // 1. Équipements
    const depotCapByComp = new Map();
    /** Places de véhicules par mode et par réseau routier (lignes tracées, v0.8). */
    const slots = { bus: new Map(), tram: new Map() };
    const busStops = [];
    const tramStops = [];
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
      b.transitPassengers = 0;
      if (tr.mode === 'tram' && tr.stop) tramStops.push({ b, tr, ok });
      if (!ok) continue;
      const staffing = def.capacity.jobs ? Math.min(1, 0.3 + (b.jobsFilled / def.capacity.jobs) * 0.7) : 1;
      if (tr.depot) {
        const comp = net.componentOfTile(b.access);
        const mode = tr.mode === 'tram' ? 'tram' : 'bus';
        slots[mode].set(comp, (slots[mode].get(comp) ?? 0) + LINE_MODES[mode].depotSlots * staffing);
        if (mode === 'bus') {
          const cap = tr.capacity * staffing * (mods['transit.busCapacityMult'] ?? 1);
          depotCapByComp.set(comp, (depotCapByComp.get(comp) ?? 0) + cap);
          depots++;
        }
        b.transitActive = true;
      } else if (tr.mode === 'bus') busStops.push({ b, tr });
      else if (tr.mode === 'metro') metroStations.push({ b, tr, cap: tr.capacity * staffing });
      else if (tr.mode === 'rail') railStations.push({ b, tr, cap: tr.capacity * staffing });
    }
    const cx = (b) => b.x + (b.w - 1) / 2;
    const cy = (b) => b.y + (b.h - 1) / 2;

    // 2. Lignes tracées (v0.8) : flotte disponible, intervalle, qualité et capacité de chaque ligne
    const lines = state.lines?.list ?? [];
    const busLineMode = lines.some((l) => l.mode === 'bus');
    const active = [];
    const stopLines = new Map(); // identifiant d'arrêt → lignes actives qui le desservent
    const wanted = { bus: new Map(), tram: new Map() };
    for (const line of lines) {
      line.stats = { demand: 0, passengers: 0, capacity: 0, effVehicles: 0, headway: null, quality: 0, saturation: 0, issue: null };
      if (line.status !== 'ok' || !line.path?.length) {
        line.stats.issue = line.reason ?? 'Ligne interrompue';
        continue;
      }
      const comp = net.componentOfTile(line.path[0]);
      line.comp = comp;
      const w = wanted[line.mode];
      w.set(comp, (w.get(comp) ?? 0) + line.vehicles);
    }
    for (const line of lines) {
      if (line.status !== 'ok' || !line.path?.length) continue;
      const M = LINE_MODES[line.mode];
      const avail = slots[line.mode].get(line.comp) ?? 0;
      const want = wanted[line.mode].get(line.comp) ?? 0;
      if (avail <= 0) {
        line.stats.issue = `Aucun ${line.mode === 'tram' ? 'dépôt de tramway' : 'dépôt de bus'} en service sur ce réseau routier`;
        continue;
      }
      const k = want > avail ? avail / want : 1;
      const eff = line.vehicles * k;
      const stopBs = line.stops.map((id) => state.buildings.get(id)).filter((b) => b && isOperational(state, b) && b.access >= 0 && (line.mode !== 'tram' || b.powered !== false));
      if (stopBs.length < 2) {
        line.stats.issue = 'Moins de deux arrêts en service';
        continue;
      }
      const { cycle, headway } = lineTiming(line.mode, line.length, line.stops.length, eff);
      const q = serviceQuality(headway);
      line.stats.effVehicles = Math.round(eff * 10) / 10;
      line.stats.cycle = Math.round(cycle);
      line.stats.headway = Math.round(headway * 10) / 10;
      line.stats.quality = Math.round(q * 100) / 100;
      line.stats.capacity = eff * M.vehicleCap * (line.mode === 'bus' ? mods['transit.busCapacityMult'] ?? 1 : 1);
      if (k < 1) line.stats.issue = `Flotte limitée par les dépôts : ${line.stats.effVehicles} véhicules sur ${line.vehicles}`;
      const entry = { line, q, stops: stopBs, demand: 0 };
      active.push(entry);
      for (const b of stopBs) {
        let arr = stopLines.get(b.id);
        if (!arr) stopLines.set(b.id, (arr = []));
        arr.push(entry);
      }
    }

    // 3. Desserte (champs de couverture)
    let busCap = 0;
    const servedComps = new Set();
    const lineStops = { bus: [], tram: [] };
    const baseStops = [];
    let baseCap = 0;
    if (busLineMode) {
      // Arrêts des lignes : qualité selon la fréquence ; autres arrêts : réseau de base (bus restés au dépôt)
      for (const { b, tr } of busStops) {
        const ls = stopLines.get(b.id);
        if (ls) {
          b.transitActive = true;
          const q = Math.max(...ls.map((e) => e.q));
          EnvironmentSystem.splat(g, g.transitBus, cx(b), cy(b), 1.4 * q, tr.radius);
          lineStops.bus.push({ b, r: tr.radius });
          continue;
        }
        const comp = net.componentOfTile(b.access);
        if (!depotCapByComp.has(comp)) continue;
        servedComps.add(comp);
        b.transitActive = true;
        baseStops.push(b);
        EnvironmentSystem.splat(g, g.transitBus, cx(b), cy(b), 1.4 * BASE_NETWORK_QUALITY, tr.radius);
      }
      // Capacité du réseau de base : la part de la flotte des dépôts que les lignes n'utilisent pas
      for (const comp of servedComps) {
        const avail = slots.bus.get(comp) ?? 0;
        const used = Math.min(avail, wanted.bus.get(comp) ?? 0);
        baseCap += depotCapByComp.get(comp) * (avail > 0 ? 1 - used / avail : 1);
      }
    } else {
      for (const { b, tr } of busStops) {
        const comp = net.componentOfTile(b.access);
        if (!depotCapByComp.has(comp)) continue; // arrêt sans dépôt joignable par la route
        servedComps.add(comp);
        b.transitActive = true;
        EnvironmentSystem.splat(g, g.transitBus, cx(b), cy(b), 1.4, tr.radius);
      }
      for (const comp of servedComps) busCap += depotCapByComp.get(comp);
    }
    for (const { b, tr } of tramStops) {
      const ls = stopLines.get(b.id);
      if (!ls) continue;
      b.transitActive = true;
      const q = Math.max(...ls.map((e) => e.q));
      EnvironmentSystem.splat(g, g.transitTram, cx(b), cy(b), 1.4 * q, tr.radius);
      lineStops.tram.push({ b, r: tr.radius });
    }
    if (metroStations.length >= 2) {
      for (const st of metroStations) {
        st.b.transitActive = true;
        metroCap += st.cap;
        EnvironmentSystem.splat(g, g.transitMetro, cx(st.b), cy(st.b), 1.4, st.tr.radius);
      }
    }
    // Voies ferrées (v0.6) : une gare reliée par les rails au bord de la carte reçoit des trains régionaux (+50 %)
    const linked = railStations.length ? linkedRailTiles(g) : null;
    for (const st of railStations) {
      st.b.railLinked = !!linked && touchesRail(g, st.b, linked);
      if (st.b.railLinked) st.cap *= RAIL_LINK_BONUS;
    }
    for (const st of railStations) {
      st.b.transitActive = true;
      railCap += st.cap;
      EnvironmentSystem.splat(g, g.transitRail, cx(st.b), cy(st.b), 1.4, st.tr.radius);
    }
    for (const f of [g.transitBus, g.transitMetro, g.transitRail, g.transitTram]) {
      for (let i = 0; i < g.size; i++) if (f[i] > 1) f[i] = 1;
    }
    // Zones de chalandise des arrêts de ligne : chaque case est rattachée à l'arrêt desservi le plus proche
    const catchment = { bus: catchmentOf(g, lineStops.bus), tram: catchmentOf(g, lineStops.tram) };

    // 4. Part des emplois desservis (destinations)
    let jobs = 0;
    let jobsBus = 0;
    let jobsMetro = 0;
    let jobsRail = 0;
    let jobsTram = 0;
    for (const b of state.buildings.values()) {
      if (!b.jobsFilled || b.abandoned) continue;
      const i = g.idx(b.x, b.y);
      jobs += b.jobsFilled;
      jobsBus += b.jobsFilled * g.transitBus[i];
      jobsMetro += b.jobsFilled * g.transitMetro[i];
      jobsRail += b.jobsFilled * g.transitRail[i];
      jobsTram += b.jobsFilled * g.transitTram[i];
    }
    const fracBus = jobs ? jobsBus / jobs : 0;
    const fracMetro = jobs ? jobsMetro / jobs : 0;
    const fracRail = jobs ? jobsRail / jobs : 0;
    const fracTram = jobs ? jobsTram / jobs : 0;
    const railLocal = railStations.length >= 2;

    // 5. Parts modales des ménages et demande
    const fare = this.effectiveFare(state);
    const rid = (mods['transit.ridershipMult'] ?? 1) * fareElasticity(fare);
    const s = state.stats;
    const outShare = s.employed > 0 ? Math.min(0.8, s.commutersOut / s.employed) : 0;
    const res = [];
    let dBus = 0;
    let dMetro = 0;
    let dRail = 0;
    let dTram = 0;
    let dBase = 0;
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
      let st = MAX_SHARE.tram * g.transitTram[i] * (0.3 + 0.7 * fracTram) * rid;
      const total = sb + sm + sl + st;
      if (total > 0.7) {
        sb *= 0.7 / total;
        sm *= 0.7 / total;
        sl *= 0.7 / total;
        st *= 0.7 / total;
      }
      // Part du train pour les déplacements vers la région (navettes sortantes et déplacements régionaux)
      const sr = Math.min(0.8, MAX_SHARE.rail * g.transitRail[i] * rid);
      const trips = b.employed * 2 + b.residents * 0.3;
      const regionalTrips = b.employed * 2 * outShare + b.residents * REGIONAL_TRIP_RATE;
      dBus += trips * sb;
      dMetro += trips * sm;
      dRail += trips * sl + regionalTrips * sr;
      dTram += trips * st;
      // Demande adressée aux lignes de l'arrêt le plus proche
      const lb = busLineMode && sb > 0 ? linesAt(catchment.bus, i, stopLines) : null;
      const lt = st > 0 ? linesAt(catchment.tram, i, stopLines) : null;
      if (lb) for (const e of lb) e.demand += (trips * sb) / lb.length;
      else if (busLineMode) dBase += trips * sb;
      if (lt) for (const e of lt) e.demand += (trips * st) / lt.length;
      if (g.transitBus[i] > 0.2 || g.transitMetro[i] > 0.2 || g.transitRail[i] > 0.2 || g.transitTram[i] > 0.2) coveredResidents += b.residents;
      res.push({ b, sb, sm, sl, sr, st, trips, regionalTrips, lb, lt });
    }
    // Navetteurs venant de la région : ceux dont l'emploi est près d'une gare arrivent en train
    const inbound = railStations.length ? (s.commutersIn ?? 0) * 2 * fracRail * INBOUND_RAIL_SHARE * Math.min(1, rid) : 0;
    dRail += inbound;

    // 6. Limitation par la capacité (par ligne pour les lignes tracées)
    let lineBusCap = 0;
    let tramCap = 0;
    for (const e of active) {
      e.k = e.demand > e.line.stats.capacity ? e.line.stats.capacity / e.demand : 1;
      if (e.line.mode === 'bus') lineBusCap += e.line.stats.capacity;
      else tramCap += e.line.stats.capacity;
    }
    if (busLineMode) busCap = lineBusCap + baseCap;
    const kOf = (ls, fallback) => (ls ? ls.reduce((a, e) => a + e.k, 0) / ls.length : fallback);
    // Réseau automatique : capacité globale des dépôts ; avec des lignes : celle du réseau de base pour les arrêts hors ligne
    const kBusGlobal = busLineMode ? (dBase > baseCap ? (baseCap > 0 ? baseCap / dBase : 0) : 1) : dBus > busCap ? (busCap > 0 ? busCap / dBus : 0) : 1;
    const kTramGlobal = dTram > tramCap ? (tramCap > 0 ? tramCap / dTram : 0) : 1;
    const kMetro = dMetro > metroCap ? (metroCap > 0 ? metroCap / dMetro : 0) : 1;
    const kRail = dRail > railCap ? (railCap > 0 ? railCap / dRail : 0) : 1;
    let tripsAvoided = 0;
    let pBus = 0;
    let pBase = 0;
    let pTram = 0;
    for (const { b, sb, sm, sl, sr, st, trips, regionalTrips, lb, lt } of res) {
      const kb = busLineMode ? kOf(lb, kBusGlobal) : kBusGlobal;
      const kt = kOf(lt, kTramGlobal);
      // rail : part des trajets internes en train ; regional : part des trajets vers la région
      b.transit = { bus: sb * kb, metro: sm * kMetro, rail: sl * kRail, regional: sr * kRail, tram: st * kt };
      pBus += trips * b.transit.bus;
      if (busLineMode && !lb) pBase += trips * b.transit.bus;
      pTram += trips * b.transit.tram;
      tripsAvoided += trips * (b.transit.bus * (1 - BUS_ROAD_FACTOR) + b.transit.metro + b.transit.rail + b.transit.tram) + regionalTrips * b.transit.regional;
    }
    tripsAvoided += inbound * kRail;
    const passengers = { bus: pBus, metro: dMetro * kMetro, rail: dRail * kRail, tram: pTram };
    // Fréquentation de chaque ligne et de ses arrêts
    for (const e of active) {
      const st2 = e.line.stats;
      st2.demand = Math.round(e.demand);
      st2.passengers = Math.round(Math.min(e.demand, st2.capacity));
      st2.saturation = st2.capacity > 0 ? Math.round((e.demand / st2.capacity) * 100) / 100 : 0;
      st2.capacity = Math.round(st2.capacity);
      for (const b of e.stops) b.transitPassengers = (b.transitPassengers ?? 0) + st2.passengers / e.stops.length;
    }
    // Fréquentation de chaque équipement (au prorata de sa capacité dans son mode)
    if (!busLineMode) {
      const activeStops = busStops.filter((x) => x.b.transitActive);
      for (const { b } of activeStops) b.transitPassengers = passengers.bus / activeStops.length;
    } else for (const b of baseStops) b.transitPassengers = pBase / baseStops.length;
    for (const st3 of metroStations) st3.b.transitPassengers = st3.b.transitActive && metroCap ? (passengers.metro * st3.cap) / metroCap : 0;
    for (const st3 of railStations) st3.b.transitPassengers = railCap ? (passengers.rail * st3.cap) / railCap : 0;
    state.transit.passengersPerDay = passengers.bus + passengers.metro + passengers.rail + passengers.tram;
    state.transit.operatingCostPerDay =
      (passengers.bus * OPERATING_COST.bus + passengers.metro * OPERATING_COST.metro + passengers.rail * OPERATING_COST.rail + passengers.tram * OPERATING_COST.tram) *
      (mods['upkeep.transport'] ?? 1);
    state.transit.stats = {
      passengers,
      demand: { bus: dBus, metro: dMetro, rail: dRail, tram: dTram },
      capacity: { bus: busCap, metro: metroCap, rail: railCap, tram: tramCap },
      saturation: { bus: busCap ? dBus / busCap : 0, metro: metroCap ? dMetro / metroCap : 0, rail: railCap ? dRail / railCap : 0, tram: tramCap ? dTram / tramCap : 0 },
      stops: busStops.length,
      activeStops: busStops.filter((x) => x.b.transitActive).length,
      tramStops: tramStops.length,
      activeTramStops: tramStops.filter((x) => x.b.transitActive).length,
      busNetwork: busLineMode ? (baseStops.length ? 'mixed' : 'lines') : 'auto',
      baseStops: baseStops.length,
      basePassengers: pBase,
      lines: lines.length,
      activeLines: active.length,
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
    return t ? t.bus + t.metro + (t.rail ?? 0) + (t.tram ?? 0) : 0;
  }
}

/**
 * Rattache chaque case à l'arrêt desservi le plus proche dans son rayon (zone de chalandise).
 * @returns {{owner:Int32Array, ids:number[]}|null}
 */
function catchmentOf(g, stops) {
  if (!stops.length) return null;
  const owner = new Int32Array(g.size).fill(-1);
  const best = new Float32Array(g.size).fill(Infinity);
  const ids = [];
  stops.forEach(({ b, r }, k) => {
    ids.push(b.id);
    const cx = b.x + (b.w - 1) / 2;
    const cy = b.y + (b.h - 1) / 2;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(g.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(g.height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d > r * r) continue;
        const i = y * g.width + x;
        if (d < best[i]) {
          best[i] = d;
          owner[i] = k;
        }
      }
    }
  });
  return { owner, ids };
}

/** Lignes actives de l'arrêt dont la zone de chalandise couvre la case (ou null). */
function linesAt(c, i, stopLines) {
  if (!c) return null;
  const k = c.owner[i];
  return k >= 0 ? stopLines.get(c.ids[k]) ?? null : null;
}
