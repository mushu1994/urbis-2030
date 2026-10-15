import { SIM } from './config.js';
import { toCents } from '../util/money.js';

/**
 * Lignes de bus et de tramway tracées par le joueur (v0.8).
 *
 * Une ligne relie, dans l'ordre, une suite d'arrêts (au moins deux) et revient à son terminus de départ : c'est une
 * boucle dont les véhicules parcourent l'itinéraire routier le plus court entre deux arrêts successifs.
 *  - Bus : arrêts de bus, sur toutes les routes. Il faut un dépôt de bus sur le même réseau routier ; chaque dépôt
 *    abrite une flotte limitée.
 *  - Tramway : stations de tramway, sur les rues, avenues et boulevards. La création de la ligne pose les rails sur la
 *    chaussée (coût par case) ; il faut un dépôt de tramway sur le même réseau routier.
 * Le joueur choisit le nombre de véhicules : avec la longueur de la boucle, il donne l'intervalle entre deux passages,
 * donc la qualité de desserte (attractivité) et la capacité (voyageurs par jour) de la ligne. Chaque véhicule coûte un
 * entretien mensuel. Tant qu'aucune ligne de bus n'existe, le réseau de bus automatique d'avant la v0.8 reste en
 * service ; ensuite, les arrêts hors ligne restent desservis par un « réseau de base » moins fréquent, assuré par les
 * bus que les lignes laissent au dépôt.
 */

export const LINE_MODES = {
  bus: {
    label: 'Bus',
    stop: 'bus_stop',
    depot: 'bus_depot',
    /** Voyageurs par jour et par véhicule. */
    vehicleCap: 160,
    speedKmh: 18,
    /** Entretien mensuel d'un véhicule (euros). */
    vehicleCost: 350,
    /** Véhicules abrités par dépôt. */
    depotSlots: 14,
    maxVehicles: 30,
    roads: null,
    trackCost: 0,
    defaultVehicles: 3
  },
  tram: {
    label: 'Tramway',
    stop: 'tram_stop',
    depot: 'tram_depot',
    vehicleCap: 650,
    speedKmh: 22,
    vehicleCost: 1500,
    depotSlots: 10,
    maxVehicles: 20,
    roads: ['road_street', 'road_avenue', 'road_boulevard'],
    /** Pose des rails sur la chaussée (euros par case) et entretien mensuel par case. */
    trackCost: 1400,
    trackUpkeep: 3,
    defaultVehicles: 3
  }
};

export const LINE_COLORS = ['#e8483f', '#2f8fd8', '#3fae5a', '#f0a32b', '#9b5bd4', '#17b5b0', '#e0569b', '#7a8b2e', '#d4692b', '#4d5bd8'];
export const MAX_STOPS = 24;
/** Temps d'arrêt par station (minutes). */
const DWELL_MIN = 0.5;

export function defaultLines() {
  return { list: [], nextId: 1, rev: 0 };
}

export function linesOf(state) {
  state.lines ??= defaultLines();
  return state.lines;
}

/** Durée d'un tour complet (minutes) et intervalle entre deux passages pour un nombre de véhicules donné. */
export function lineTiming(mode, length, stops, vehicles) {
  const m = LINE_MODES[mode];
  const cycle = (length * SIM.TILE_KM) / m.speedKmh * 60 + stops * DWELL_MIN;
  const headway = vehicles > 0 ? cycle / vehicles : Infinity;
  return { cycle, headway };
}

/** Qualité de desserte selon l'intervalle (1 pour un passage toutes les 6 minutes, 0,3 au-delà de 20 minutes). */
export function serviceQuality(headway) {
  if (!Number.isFinite(headway)) return 0;
  return Math.max(0.3, Math.min(1.1, 1.3 - headway / 20));
}

/** Code de route autorisé pour un mode (tramway : pas d'autoroute). */
function allowedCodes(catalog, mode) {
  const roads = LINE_MODES[mode].roads;
  if (!roads) return null;
  return new Set(roads.map((id) => catalog.road(id).code));
}

/**
 * Plus court itinéraire routier entre deux cases de route (Dijkstra sur la grille ; tramway : rails existants
 * privilégiés). `tracksOnly` : n'emprunter que des cases déjà équipées de rails.
 * @returns {number[]|null} cases de `from` à `to` incluses
 */
export function routeBetween(state, catalog, mode, from, to, { tracksOnly = false } = {}) {
  const g = state.grid;
  if (from < 0 || to < 0 || !g.road[from] || !g.road[to]) return null;
  if (from === to) return [from];
  const codes = allowedCodes(catalog, mode);
  const tram = mode === 'tram';
  const ok = (i) => g.road[i] && (!codes || codes.has(g.road[i])) && (!tracksOnly || g.tram?.[i]);
  if (!ok(from) || !ok(to)) return null;
  const dist = new Float64Array(g.size).fill(Infinity);
  const prev = new Int32Array(g.size).fill(-1);
  const heap = new MinHeap();
  dist[from] = 0;
  heap.push(from, 0);
  const nb = new Int32Array(4);
  while (heap.size) {
    const [i, d] = heap.pop();
    if (d > dist[i]) continue;
    if (i === to) break;
    const n = g.neighbors4(i, nb);
    const ai = g.surfaceAlt(i);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      if (!ok(j) || Math.abs(g.surfaceAlt(j) - ai) > 1) continue;
      const w = tram && !g.tram?.[j] ? 1.15 : 1;
      const nd = d + w;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(j, nd);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const path = [];
  for (let i = to; i !== -1; i = prev[i]) path.push(i);
  return path.reverse();
}

/**
 * Itinéraire complet d'une ligne (boucle) à partir de ses arrêts.
 * @returns {{ok:true, path:number[], stopAt:number[], length:number, newTracks:number[]} | {ok:false, reason:string, at?:number}}
 */
export function computeLinePath(state, catalog, mode, stopIds, opts = {}) {
  const stops = stopIds.map((id) => state.buildings.get(id));
  if (stops.some((b) => !b)) return { ok: false, reason: 'Un arrêt de la ligne n\'existe plus' };
  if (stops.length < 2) return { ok: false, reason: 'Il faut au moins deux arrêts' };
  for (const b of stops) if (!(b.access >= 0)) return { ok: false, reason: 'Un arrêt n\'est pas desservi par une route' };
  const path = [];
  const stopAt = [];
  for (let k = 0; k < stops.length; k++) {
    const a = stops[k].access;
    const z = stops[(k + 1) % stops.length].access;
    const seg = routeBetween(state, catalog, mode, a, z, opts);
    if (!seg) {
      const why = mode === 'tram'
        ? (opts.tracksOnly ? 'Rails interrompus entre deux stations' : 'Aucune rue, avenue ou boulevard ne relie deux stations successives')
        : 'Aucune route ne relie deux arrêts successifs';
      return { ok: false, reason: why, at: k };
    }
    // Évite de répéter la case de jonction entre deux tronçons
    const joined = path.length > 0 && path[path.length - 1] === seg[0];
    stopAt.push(joined ? path.length - 1 : path.length);
    for (let s = joined ? 1 : 0; s < seg.length; s++) path.push(seg[s]);
  }
  // La boucle se referme sur le premier arrêt : on retire la dernière case si elle le duplique
  if (path.length > 1 && path[path.length - 1] === path[0]) path.pop();
  const g = state.grid;
  const newTracks = mode === 'tram' ? [...new Set(path.filter((i) => !g.tram?.[i]))] : [];
  return { ok: true, path, stopAt, length: Math.max(1, path.length), newTracks };
}

/** Le bâtiment est-il un arrêt de ce mode ? */
export function isStopOf(catalog, b, mode) {
  return !!b && catalog.building(b.defId)?.id === LINE_MODES[mode].stop;
}

/**
 * Aperçu d'une ligne (outil de tracé) : validité, coût des rails, longueur, intervalle avec la flotte par défaut.
 */
export function previewLine(state, catalog, { mode, stops }) {
  const M = LINE_MODES[mode];
  if (!M) return { ok: false, messages: ['Mode de transport inconnu'] };
  const messages = [];
  for (const id of stops) {
    if (!isStopOf(catalog, state.buildings.get(id), mode)) messages.push(`Seuls les ${mode === 'tram' ? 'stations de tramway' : 'arrêts de bus'} peuvent former une ligne`);
  }
  if (new Set(stops).size !== stops.length) messages.push('Un arrêt ne peut figurer qu\'une fois');
  if (stops.length > MAX_STOPS) messages.push(`Au plus ${MAX_STOPS} arrêts par ligne`);
  if (messages.length) return { ok: false, messages: [...new Set(messages)] };
  if (stops.length < 2) return { ok: false, partial: true, messages: ['Choisissez au moins deux arrêts'], cost: 0 };
  const r = computeLinePath(state, catalog, mode, stops);
  if (!r.ok) return { ok: false, messages: [r.reason], at: r.at };
  const cost = toCents(r.newTracks.length * M.trackCost);
  const vehicles = M.defaultVehicles;
  const { cycle, headway } = lineTiming(mode, r.length, stops.length, vehicles);
  const treasuryOk = cost <= state.economy.treasury;
  return {
    ok: treasuryOk,
    messages: treasuryOk ? [] : ['Budget insuffisant'],
    cost,
    path: r.path,
    length: r.length,
    newTracks: r.newTracks.length,
    vehicles,
    cycle,
    headway,
    upkeep: toCents(vehicles * M.vehicleCost + r.newTracks.length * (M.trackUpkeep ?? 0))
  };
}

/** Prochaine couleur libre. */
function nextColor(L) {
  const used = new Set(L.list.map((l) => l.color));
  return LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[L.nextId % LINE_COLORS.length];
}

export class LineSystem {
  /** @param {{catalog:any, economy:any, bus?:any}} deps */
  constructor({ catalog, economy, bus }) {
    this.catalog = catalog;
    this.economy = economy;
    this.bus = bus;
  }

  preview(state, cmd) {
    return previewLine(state, this.catalog, cmd);
  }

  /** Crée une ligne : paie la pose des rails (tramway), pose les rails, enregistre la ligne. */
  create(state, cmd) {
    const pv = previewLine(state, this.catalog, cmd);
    if (!pv.ok) return { ok: false, messages: pv.messages };
    const M = LINE_MODES[cmd.mode];
    const L = linesOf(state);
    const r = computeLinePath(state, this.catalog, cmd.mode, cmd.stops);
    if (r.newTracks.length) {
      const pay = this.economy.payCapex(state, { amount: pv.cost, category: 'tramTracks', label: `Voies de tramway (${r.newTracks.length} cases)`, lifeYears: 40 });
      if (!pay.ok) return { ok: false, messages: [pay.reason] };
      for (const i of r.newTracks) state.grid.tram[i] = 1;
      this.bus?.emit('world:changed', { tiles: r.newTracks, reason: 'tram' });
    }
    const n = L.list.filter((l) => l.mode === cmd.mode).length + 1;
    const line = {
      id: L.nextId++,
      mode: cmd.mode,
      name: String(cmd.name ?? '').trim().slice(0, 28) || `${M.label} ${n}`,
      color: nextColor(L),
      stops: [...cmd.stops],
      vehicles: Math.max(1, Math.min(M.maxVehicles, Math.round(cmd.vehicles ?? M.defaultVehicles))),
      path: r.path,
      stopAt: r.stopAt,
      length: r.length,
      status: 'ok',
      createdTick: state.time.tick,
      stats: null
    };
    L.list.push(line);
    L.rev = (L.rev ?? 0) + 1;
    state.dirty.transit = true;
    return { ok: true, line, cost: pv.cost };
  }

  /** Modifie la flotte, le nom ou la couleur d'une ligne. */
  update(state, cmd) {
    const L = linesOf(state);
    const line = L.list.find((l) => l.id === cmd.id);
    if (!line) return { ok: false, messages: ['Ligne introuvable'] };
    const M = LINE_MODES[line.mode];
    if (cmd.vehicles !== undefined) {
      const v = Math.round(Number(cmd.vehicles));
      if (!Number.isFinite(v)) return { ok: false, messages: ['Nombre de véhicules invalide'] };
      line.vehicles = Math.max(1, Math.min(M.maxVehicles, v));
    }
    if (cmd.name !== undefined) {
      const name = String(cmd.name).replace(/[<>]/g, '').trim().slice(0, 28);
      if (name) line.name = name;
    }
    if (cmd.color !== undefined && LINE_COLORS.includes(cmd.color)) line.color = cmd.color;
    L.rev = (L.rev ?? 0) + 1;
    state.dirty.transit = true;
    return { ok: true, line };
  }

  /** Supprime une ligne ; les rails de tramway que plus aucune ligne n'emprunte sont déposés (sans remboursement). */
  remove(state, cmd) {
    const L = linesOf(state);
    const line = L.list.find((l) => l.id === cmd.id);
    if (!line) return { ok: false, messages: ['Ligne introuvable'] };
    L.list = L.list.filter((l) => l !== line);
    if (line.mode === 'tram') {
      const used = new Set(L.list.filter((l) => l.mode === 'tram').flatMap((l) => l.path));
      const removed = line.path.filter((i) => state.grid.tram[i] && !used.has(i));
      for (const i of removed) state.grid.tram[i] = 0;
      if (removed.length) this.bus?.emit('world:changed', { tiles: removed, reason: 'tram' });
    }
    L.rev = (L.rev ?? 0) + 1;
    state.dirty.transit = true;
    return { ok: true };
  }

  /**
   * Validation périodique (avant le calcul des transports) : arrêts disparus, routes ou rails coupés.
   * Un bus contourne une route coupée ; un tramway ne roule que sur ses rails.
   */
  validate(state) {
    const L = linesOf(state);
    const g = state.grid;
    for (const line of L.list) {
      const before = line.stops.length;
      line.stops = line.stops.filter((id) => isStopOf(this.catalog, state.buildings.get(id), line.mode));
      const changed = before !== line.stops.length;
      const broken = !line.path?.length || line.path.some((i) => !g.road[i] || (line.mode === 'tram' && !g.tram[i]));
      if (!changed && !broken && line.status === 'ok') continue;
      if (line.stops.length < 2) {
        if (line.status !== 'broken') L.rev = (L.rev ?? 0) + 1;
        line.status = 'broken';
        line.reason = 'Moins de deux arrêts';
        continue;
      }
      const r = computeLinePath(state, this.catalog, line.mode, line.stops, { tracksOnly: line.mode === 'tram' });
      if (r.ok) {
        line.path = r.path;
        line.stopAt = r.stopAt;
        line.length = r.length;
        line.status = 'ok';
        line.reason = null;
        if (changed || broken) L.rev = (L.rev ?? 0) + 1;
      } else {
        if (line.status !== 'broken' || line.reason !== r.reason) L.rev = (L.rev ?? 0) + 1;
        line.status = 'broken';
        line.reason = r.reason;
      }
    }
  }

  /** Entretien mensuel : flotte et rails de tramway (centimes, par compte). */
  monthlyCosts(state) {
    const L = linesOf(state);
    let fleet = 0;
    for (const line of L.list) fleet += line.vehicles * LINE_MODES[line.mode].vehicleCost;
    let tracks = 0;
    const g = state.grid;
    if (g.tram) for (let i = 0; i < g.size; i++) if (g.tram[i]) tracks++;
    return { fleet: toCents(fleet), tracks: toCents(tracks * LINE_MODES.tram.trackUpkeep), trackTiles: tracks };
  }
}

/** Tas binaire minimal (indice de case, priorité). */
class MinHeap {
  constructor() {
    this.ids = [];
    this.pri = [];
  }

  get size() {
    return this.ids.length;
  }

  push(id, p) {
    const ids = this.ids;
    const pri = this.pri;
    let k = ids.length;
    ids.push(id);
    pri.push(p);
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (pri[parent] <= p) break;
      ids[k] = ids[parent];
      pri[k] = pri[parent];
      k = parent;
    }
    ids[k] = id;
    pri[k] = p;
  }

  pop() {
    const ids = this.ids;
    const pri = this.pri;
    const top = [ids[0], pri[0]];
    const lastId = ids.pop();
    const lastP = pri.pop();
    const n = ids.length;
    if (n) {
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && pri[r] < pri[l] ? r : l;
        if (pri[c] >= lastP) break;
        ids[k] = ids[c];
        pri[k] = pri[c];
        k = c;
      }
      ids[k] = lastId;
      pri[k] = lastP;
    }
    return top;
  }
}
