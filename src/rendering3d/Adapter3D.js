import { TERRAIN } from '../world/Terrain.js';
import { isOwnedIndex, fullyOwned } from '../world/Land.js';

/**
 * Pont entre l'état de la partie et la vue 3D (v1.5) — sans Three.js, testable dans Node.
 *
 * La vue 3D ne lit jamais l'état directement : elle travaille sur un « miroir » (carte 3D) que cet adaptateur
 * construit puis met à jour par différences. Le miroir est une copie : la 3D ne peut rien modifier de la partie.
 *
 * Repère : x = colonne de la grille, z = ligne (y de la grille). Altitude 3D = altitude du jeu − 1 (le sol le plus
 * bas, au ras de l'eau, est à 0 ; l'eau est en contrebas).
 */

/** Codes de terrain de la vue 3D (ordre des couleurs du moteur). */
export const T3 = Object.freeze({ GRASS: 0, SAND: 1, FOREST: 2, ROCK: 3, WATER: 4 });
const TERR_TO_3D = { [TERRAIN.GRASS]: T3.GRASS, [TERRAIN.WATER]: T3.WATER, [TERRAIN.FOREST]: T3.FOREST, [TERRAIN.SAND]: T3.SAND, [TERRAIN.ROCK]: T3.ROCK };

/** Directions des façades : 0 sud (+z), 1 est (+x), 2 nord (−z), 3 ouest (−x). */
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Bâtiments dont la façade donne sur les voies ferrées (quais). */
const FACE_RAIL = new Set(['train_station']);
/** Bâtiments tout en longueur (quais, tube) : la façade est toujours un grand côté. */
const LONG_SIDE = new Set(['train_station', 'hyperloop']);

/** Durée du chantier décoratif des équipements posés par le joueur (identique à la vue 2D). */
export function constructionDays(def) {
  if (def.kind === 'growable') return 10 + Math.min(8, Math.round(def.visual.height / 8));
  if (def.visual.roof === 'park' || def.visual.detail === 'pylon' || def.visual.roof === 'none') return 0;
  return 5 + Math.min(6, Math.round((def.footprint.w * def.footprint.h) / 2));
}

/**
 * Catalogue au format du moteur 3D (mêmes champs que le prototype) : routes, bâtiments, améliorations, technologies.
 * @param {import('../data/Catalog.js').Catalog} catalog
 */
export function catalog3d(catalog) {
  const b = [...catalog.buildings.values()].map((d) => ({
    id: d.id,
    name: d.name,
    cat: d.category,
    kind: d.kind,
    w: d.footprint.w,
    h: d.footprint.h,
    lv: d.level ?? 0,
    v: d.visual,
    road: !!d.placement?.requiresRoadAccess,
    water: d.placement?.adjacentToTerrainCode === TERRAIN.WATER
  }));
  return {
    roads: catalog.roads.map((r) => ({ id: r.id, name: r.name, v: r.visual })),
    b,
    byId: new Map(b.map((d) => [d.id, d])),
    ups: catalog.upgrades.map((u) => ({ id: u.id, name: u.name, appliesTo: u.appliesTo, effects: u.effects, description: u.description })),
    techs: catalog.technologies.map((t) => ({ id: t.id, name: t.name, description: t.description }))
  };
}

/** Altitude 3D d'une case. */
export function alt3(grid, i) {
  return Math.max(0, grid.altitude[i] - 1);
}

/**
 * Façade d'un bâtiment : côté de la route d'accès (ou des voies pour une gare), sinon le côté le plus desservi.
 * @returns {number} 0..3 (voir DIRS)
 */
export function facingOf(state, b, defId = b.defId) {
  const g = state.grid;
  const sideTiles = (d) => {
    const out = [];
    if (d === 0 || d === 2) {
      const y = d === 0 ? b.y + b.h : b.y - 1;
      for (let x = b.x; x < b.x + b.w; x++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
    } else {
      const x = d === 1 ? b.x + b.w : b.x - 1;
      for (let y = b.y; y < b.y + b.h; y++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
    }
    return out;
  };
  // côtés admissibles : les grands côtés pour un bâtiment tout en longueur
  const sides = LONG_SIDE.has(defId) && b.w !== b.h ? (b.w > b.h ? [0, 2] : [1, 3]) : [0, 1, 2, 3];
  if (FACE_RAIL.has(defId)) {
    let best = -1;
    let bestN = 0;
    for (const d of sides) {
      const n = sideTiles(d).filter((i) => g.rail[i]).length;
      if (n > bestN) {
        best = d;
        bestN = n;
      }
    }
    if (best >= 0) return best;
  }
  if (b.access >= 0) {
    const ax = g.xOf(b.access);
    const ay = g.yOf(b.access);
    let side = -1;
    if (ay >= b.y + b.h && ax >= b.x && ax < b.x + b.w) side = 0;
    else if (ax >= b.x + b.w && ay >= b.y && ay < b.y + b.h) side = 1;
    else if (ay < b.y && ax >= b.x && ax < b.x + b.w) side = 2;
    else if (ax < b.x && ay >= b.y && ay < b.y + b.h) side = 3;
    if (side >= 0 && sides.includes(side)) return side;
  }
  let best = sides.includes(b.rot ? 1 : 0) ? (b.rot ? 1 : 0) : sides[0];
  let bestN = 0;
  for (const d of sides) {
    const n = sideTiles(d).filter((i) => g.road[i]).length;
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/** Côté donnant sur l'eau (port, marina, centrale hydraulique…), −1 s'il n'y en a pas. */
export function waterSideOf(state, b) {
  const g = state.grid;
  let best = -1;
  let bestN = 0;
  for (let d = 0; d < 4; d++) {
    let n = 0;
    if (d === 0 || d === 2) {
      const y = d === 0 ? b.y + b.h : b.y - 1;
      for (let x = b.x; x < b.x + b.w; x++) if (g.inBounds(x, y) && g.terrain[g.idx(x, y)] === TERRAIN.WATER) n++;
    } else {
      const x = d === 1 ? b.x + b.w : b.x - 1;
      for (let y = b.y; y < b.y + b.h; y++) if (g.inBounds(x, y) && g.terrain[g.idx(x, y)] === TERRAIN.WATER) n++;
    }
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/**
 * État visible d'un bâtiment, déduit uniquement des données de la partie.
 * @returns {{state?:string, defId:string, progress?:number}}
 */
export function visualStateOf(state, b, catalog, floodIds) {
  const t = state.time.tick;
  const def = catalog.building(b.defId);
  if (b.ruins) return { state: b.ruins.cause === 'fire' ? 'burnt' : 'rubble', defId: b.defId };
  if (floodIds?.has(b.id) || b.recoverUntil > t) return { state: 'flooded', defId: b.defId };
  if (b.abandoned) return { state: 'abandoned', defId: b.defId };
  let end = 0;
  let start = b.builtTick ?? 0;
  let target = b.defId;
  if (b.repairUntil > t) {
    end = b.repairUntil;
    start = b.repairStart ?? t;
  } else if (b.constructionUntil > t) {
    end = b.constructionUntil;
    start = b.constructionStart ?? b.builtTick ?? t;
    if (b.upgradeTo) target = b.upgradeTo;
  } else if (def && def.kind !== 'growable') {
    const days = constructionDays(def);
    if (days && t < (b.builtTick ?? 0) + days && t >= (b.builtTick ?? 0)) end = (b.builtTick ?? 0) + days;
  }
  if (end) {
    const progress = Math.max(0, Math.min(1, (t - start) / Math.max(1, end - start)));
    return { state: 'construction', defId: target, progress: Math.round(progress * 10) / 10 };
  }
  return { defId: b.defId };
}

/**
 * Miroir 3D de la partie. `build()` crée la carte, `sync()` la met à jour et renvoie ce qui a changé.
 */
export class MapMirror {
  /** @param {import('../data/Catalog.js').Catalog} catalog */
  constructor(catalog) {
    this.catalog = catalog;
    this.cat = catalog3d(catalog);
    this.map = null;
    this.sigs = new Map();
  }

  /** @param {import('../app/GameState.js').GameState} state */
  build(state) {
    const g = state.grid;
    const W = g.width;
    const H = g.height;
    const N = W * H;
    const map = {
      W,
      H,
      idx: (x, z) => z * W + x,
      inside: (x, z) => x >= 0 && z >= 0 && x < W && z < H,
      terr: new Uint8Array(N),
      alt: new Uint8Array(N),
      road: new Uint8Array(N),
      rail: new Uint8Array(N),
      tram: new Uint8Array(N),
      bridge: new Uint8Array(N),
      zone: new Uint8Array(N),
      occ: new Int32Array(N).fill(-1),
      /** 1 = parcelle hors du territoire communal (non achetée). */
      locked: new Uint8Array(N),
      /** Neige au sol : 0, 1 (légère) ou 2 (épaisse). */
      snow: 0,
      buildings: [],
      byId: new Map()
    };
    this.map = map;
    this.sigs.clear();
    this.#copyTiles(state, null);
    this.#syncBuildings(state);
    return map;
  }

  /** Recopie les couches de cases ; renvoie les indices modifiés (si `changed` est fourni). */
  #copyTiles(state, changed) {
    const g = state.grid;
    const m = this.map;
    let all = true;
    try {
      all = !state.land || fullyOwned(state);
    } catch {
      all = true;
    }
    for (let i = 0; i < g.size; i++) {
      const terr = TERR_TO_3D[g.terrain[i]] ?? T3.GRASS;
      const alt = alt3(g, i);
      const road = g.road[i];
      const rail = g.rail?.[i] ?? 0;
      const tram = g.tram?.[i] ?? 0;
      const bridge = g.bridge[i] ? Math.max(1, g.bridge[i] - 1) : 0;
      const zone = g.zone[i];
      const occ = g.building[i] ? g.building[i] : -1;
      const locked = all ? 0 : isOwnedIndex(state, i) ? 0 : 1;
      if (changed && m.terr[i] === terr && m.alt[i] === alt && m.road[i] === road && m.rail[i] === rail && m.tram[i] === tram && m.bridge[i] === bridge && m.zone[i] === zone && m.occ[i] === occ && m.locked[i] === locked) continue;
      m.terr[i] = terr;
      m.alt[i] = alt;
      m.road[i] = road;
      m.rail[i] = rail;
      m.tram[i] = tram;
      m.bridge[i] = bridge;
      m.zone[i] = zone;
      m.occ[i] = occ;
      m.locked[i] = locked;
      changed?.add(i);
    }
  }

  /** Bâtiments touchés par une crue en cours. */
  #floodIds(state) {
    const ids = new Set();
    for (const c of state.crises?.active ?? []) if (c.kind === 'flood') for (const id of c.buildings ?? []) ids.add(id);
    return ids;
  }

  /** Fiche 3D d'un bâtiment de la partie (nouvel objet). */
  #describe(state, b, floodIds) {
    const vs = visualStateOf(state, b, this.catalog, floodIds);
    const def = this.cat.byId.get(vs.defId) ?? this.cat.byId.get(b.defId);
    const g = state.grid;
    const o = {
      id: b.id,
      def,
      x: b.x,
      z: b.y,
      w: b.w,
      h: b.h,
      rot: facingOf(state, b, vs.defId),
      alt: alt3(g, g.idx(b.x, b.y)),
      water: def?.water || /marina|seaport|hydro|desal|water_pump|water_plant/.test(b.defId) ? waterSideOf(state, b) : -1,
      ups: new Set(b.upgrades ?? []),
      state: vs.state,
      progress: vs.progress
    };
    if (b.defId === 'landfill') {
      const base = this.catalog.building('landfill')?.capacity?.waste?.storage || 1;
      o.fill = Math.max(0, Math.min(1.8, (b.landfillUsed ?? 0) / base));
      o.fillAuto = false;
    }
    return o;
  }

  #sig(o) {
    return `${o.def?.id}|${o.x},${o.z},${o.w},${o.h}|${o.rot}|${o.alt}|${o.water}|${o.state ?? ''}|${o.progress ?? ''}|${[...o.ups].sort().join(',')}`;
  }

  /** Met à jour la liste des bâtiments ; renvoie { changed, removed } (objets du miroir). */
  #syncBuildings(state) {
    const m = this.map;
    const floodIds = this.#floodIds(state);
    const changed = [];
    const removed = [];
    const seen = new Set();
    for (const b of state.buildings.values()) {
      seen.add(b.id);
      const fresh = this.#describe(state, b, floodIds);
      if (!fresh.def) continue;
      const sig = this.#sig(fresh);
      const cur = m.byId.get(b.id);
      if (cur) {
        // L'objet du miroir garde son identité (les effets en cours y font référence)
        if (fresh.fill !== undefined) cur.fill = fresh.fill;
        if (this.sigs.get(b.id) === sig) continue;
        const before = { x: cur.x, z: cur.z, w: cur.w, h: cur.h, state: cur.state };
        Object.assign(cur, fresh);
        cur.prev = before;
        changed.push(cur);
      } else {
        m.byId.set(b.id, fresh);
        m.buildings.push(fresh);
        changed.push(fresh);
      }
      this.sigs.set(b.id, sig);
    }
    if (m.byId.size !== seen.size) {
      for (const [id, o] of m.byId) {
        if (seen.has(id)) continue;
        m.byId.delete(id);
        this.sigs.delete(id);
        removed.push(o);
      }
      m.buildings = m.buildings.filter((o) => m.byId.has(o.id));
    }
    return { changed, removed };
  }

  /**
   * Rapproche le miroir de l'état.
   * @returns {{tiles:Set<number>, changed:any[], removed:any[]}}
   */
  sync(state) {
    if (!this.map || this.map.W !== state.grid.width || this.map.H !== state.grid.height) {
      this.build(state);
      return { tiles: null, changed: this.map.buildings.slice(), removed: [], rebuilt: true };
    }
    const tiles = new Set();
    this.#copyTiles(state, tiles);
    const { changed, removed } = this.#syncBuildings(state);
    return { tiles, changed, removed, rebuilt: false };
  }
}

/**
 * Nuit (0 = plein jour, 1 = pleine nuit) : même calendrier que la vue 2D (un cycle par mois de jeu, 70 % de jour).
 */
export function nightOf(phase) {
  const s = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const p = ((phase % 1) + 1) % 1;
  return Math.max(0, s(0.66, 0.73, p) - s(0.97, 1, p));
}

/** Technologies effectivement en service (déployées et pas en panne). */
export function activeTechs(state) {
  const t = state.time.tick;
  const out = new Set();
  for (const id of Object.keys(state.tech?.researched ?? {})) if (!(state.tech.outages?.[id] > t)) out.add(id);
  return out;
}
