import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';
import { toCents } from '../util/money.js';
import { TERRAIN } from '../world/Terrain.js';
import { removeBuilding } from '../systems/BuildingFactory.js';

/**
 * Catastrophes et crises : inondation, canicule extrême, cyberattaque de l'IA municipale, panne géante,
 * grève des transports, incendie.
 *
 * - Chaque crise a des conditions d'apparition (pluie récente, chaleur, technologies déployées, marge du réseau
 *   électrique, fréquentation des transports, couverture incendie…), des effets chiffrés (modificateurs,
 *   équipements à l'arrêt, habitants évacués, dégâts payés à la fin), une durée et deux réponses possibles.
 * - Les tirages utilisent un hachage déterministe (graine, jour) et non le générateur de la partie : à état et
 *   actions identiques, les crises sont identiques, y compris après rechargement.
 * - La fréquence se règle (désactivées, rares, normales, fréquentes). Aucune crise aléatoire la première année.
 */

export const DISASTER_LEVELS = Object.freeze({ off: 0, rare: 0.3, normal: 1, frequent: 2.2 });
export const DISASTER_LEVEL_LABELS = { off: 'Désactivées', rare: 'Rares', normal: 'Normales', frequent: 'Fréquentes' };

/** Écart minimal entre deux événements aléatoires, crises et épisodes confondus (3 mois). */
export const MIN_EVENT_GAP_DAYS = 90;

/** Jour du dernier événement aléatoire (crise ou épisode climatique ou économique). */
export function lastRandomEvent(state) {
  const crises = Object.values(state.crises?.last ?? {});
  return Math.max(-1e9, state.events?.lastRandom ?? -1e9, ...crises);
}

/** Intervalle des tirages (jours). */
const CHECK_EVERY = 5;
/** Aucune crise aléatoire avant ce jour (sauf scénario). */
const GRACE_DAYS = 360;

export const CRISIS_TYPES = Object.freeze({
  flood: {
    name: 'Inondation',
    icon: '🌊',
    level: 'danger',
    summary: 'Après de fortes pluies, la rivière sort de son lit et noie les berges basses.',
    factors: 'Pluie des derniers jours, quartiers bâtis au ras de l\'eau (altitude basse à 2 cases de la rive).',
    mitigation: 'Politique « Plan de prévention des inondations » ; parcs et forêts en bord de rivière absorbent la crue.',
    responses: [
      { id: 'rescue', label: 'Mobiliser secours et pompes', detail: 'Décrue deux fois plus rapide, dégâts réduits de moitié.' },
      { id: 'wait', label: 'Attendre la décrue', detail: 'Aucune dépense immédiate ; dégâts payés en totalité à la fin.' }
    ]
  },
  heat: {
    name: 'Canicule extrême',
    icon: '🌡',
    level: 'danger',
    summary: 'Plusieurs jours au-dessus de 38 °C : les aînés souffrent, la climatisation sature le réseau électrique.',
    factors: 'Fortes chaleurs, îlots de chaleur (béton, absence de végétation).',
    mitigation: 'Politiques « Plan canicule » et « Toitures végétalisées », parcs, réserve de production électrique.',
    responses: [
      { id: 'plan', label: 'Déclencher le plan canicule', detail: 'Salles rafraîchies, brumisateurs, visites aux aînés : l\'impact sur la satisfaction est divisé par trois.' },
      { id: 'none', label: 'Simples recommandations', detail: 'Aucune dépense ; satisfaction en forte baisse pendant l\'épisode.' }
    ]
  },
  cyber: {
    name: 'Cyberattaque de l\'IA municipale',
    icon: '🛡',
    level: 'danger',
    summary: 'Un rançongiciel chiffre les serveurs de la ville : toutes les technologies déployées sont à l\'arrêt.',
    factors: 'Nombre de technologies déployées ; une rançon déjà payée attire de nouveaux attaquants.',
    mitigation: 'Politique « Cybersécurité municipale ».',
    responses: [
      { id: 'restore', label: 'Restaurer depuis les sauvegardes', detail: 'Remise en service progressive, durée réduite d\'un tiers.' },
      { id: 'ransom', label: 'Payer la rançon', detail: 'Rétablissement immédiat, mais le risque de nouvelle attaque augmente durablement.' }
    ]
  },
  blackout: {
    name: 'Panne géante',
    icon: '⚡',
    level: 'danger',
    summary: 'Une avarie en cascade déconnecte les centrales : la ville ne tient que sur ses batteries et ses imports.',
    factors: 'Marge de production faible, chaleur ou orages.',
    mitigation: 'Surplus de production, batteries, interconnexion régionale (Finances → Échanges régionaux).',
    responses: [
      { id: 'import', label: 'Acheter en urgence à la région', detail: 'Active l\'achat d\'électricité pendant la panne (prix régional élevé).' },
      { id: 'shed', label: 'Délestages tournants', detail: 'Aucun achat : les quartiers non prioritaires sont coupés.' }
    ]
  },
  strike: {
    name: 'Grève des transports',
    icon: '🚌',
    level: 'warning',
    summary: 'Les agents des transports cessent le travail : bus et métro à l\'arrêt, les voitures reprennent la route.',
    factors: 'Fréquentation du réseau, satisfaction générale.',
    mitigation: 'Politique « Dialogue social dans les transports ».',
    responses: [
      { id: 'negotiate', label: 'Négocier un accord', detail: 'Reprise du service en deux jours, contre une prime exceptionnelle.' },
      { id: 'hold', label: 'Tenir bon', detail: 'Aucune dépense ; la grève dure et la satisfaction baisse.' }
    ]
  },
  fire: {
    name: 'Incendie',
    icon: '🔥',
    level: 'danger',
    summary: 'Un feu se déclare et peut gagner les bâtiments voisins.',
    factors: 'Industrie, chaleur, densité ; surtout l\'absence de caserne de pompiers à proximité.',
    mitigation: 'Casernes de pompiers (couverture incendie) : elles limitent la propagation et la durée du feu.',
    responses: [
      { id: 'reinforce', label: 'Appeler les renforts départementaux', detail: 'Le feu est maîtrisé dès le lendemain.' },
      { id: 'none', label: 'Laisser agir les pompiers de la ville', detail: 'Le feu dure selon la couverture incendie et peut se propager.' }
    ]
  }
});

export const CRISIS_KINDS = Object.keys(CRISIS_TYPES);

export function defaultCrises() {
  return { active: [], history: [], nextId: 1, last: {}, ransomsPaid: 0, total: 0 };
}

export function defaultOptions(disasters = 'normal') {
  return { disasters };
}

const isProne = (g, i) => g.terrain[i] !== TERRAIN.WATER && g.altitude[i] <= 1;

/** Coût de réponse (euros) d'une crise. */
export function responseCost(state, crisis, optionId) {
  const pop = state.stats.population ?? 0;
  switch (`${crisis.kind}:${optionId}`) {
    case 'flood:rescue':
      return 9000 + 450 * (crisis.tiles?.length ?? 0);
    case 'heat:plan':
      return 6000 + Math.round(pop * 1.2);
    case 'cyber:restore':
      return 6000;
    case 'cyber:ransom':
      return Math.max(25000, Math.round(Math.max(0, state.economy.treasury) / 100 * 0.025));
    case 'strike:negotiate':
      return 12000 + Math.round((state.transit.passengersPerDay ?? 0) * 5);
    case 'fire:reinforce':
      return 8000 + 1500 * Object.keys(crisis.burning ?? {}).length;
    default:
      return 0;
  }
}

export class CrisisSystem {
  /** @param {{catalog: import('../data/Catalog.js').Catalog, economy: import('./EconomySystem.js').EconomySystem, bus?: any}} deps */
  constructor({ catalog, economy, bus }) {
    this.catalog = catalog;
    this.economy = economy;
    this.bus = bus;
  }

  static roll(state, salt, k = 0) {
    return hash2(state.time.tick * 31 + k, salt, (state.meta?.seed ?? 2030) ^ 0xc415);
  }

  #notify(state, level, message, extra = {}) {
    const entry = { tick: state.time.tick, level, message, ...extra };
    state.events.history.push(entry);
    if (state.events.history.length > 80) state.events.history.shift();
    this.bus?.emit('notify', entry);
  }

  #ensure(state) {
    state.crises ??= defaultCrises();
    state.options ??= defaultOptions('off');
    return state.crises;
  }

  /** Multiplicateur de fréquence (niveau choisi × bonus du scénario pour ce type). */
  frequency(state, kind) {
    const lvl = DISASTER_LEVELS[state.options?.disasters ?? 'off'] ?? 0;
    const boost = state.scenario?.status === 'active' ? state.scenario.risks?.[kind] ?? 1 : 1;
    return lvl * boost;
  }

  isActive(state, kind) {
    return (state.crises?.active ?? []).some((c) => c.kind === kind);
  }

  /** Avancée quotidienne : propagation, fin des crises, tirages. */
  daily(state) {
    const cr = this.#ensure(state);
    const t = state.time.tick;
    for (const c of [...cr.active]) {
      if (c.kind === 'fire') this.#fireStep(state, c);
      if (t >= c.until) this.#end(state, c);
    }
    if (t % CHECK_EVERY !== 2) return;
    // Période de grâce : la première année d'une ville, ou quelques mois après le début d'une partie préparée
    if (t < (cr.graceUntil ?? GRACE_DAYS)) return;
    if ((state.stats.peakPopulation ?? 0) < 250) return;
    // Au plus un événement aléatoire (crise ou épisode) tous les 3 mois
    if (t - lastRandomEvent(state) < MIN_EVENT_GAP_DAYS) return;
    let k = 0;
    for (const kind of CRISIS_KINDS) {
      k++;
      if (this.isActive(state, kind)) continue;
      const mult = this.frequency(state, kind);
      if (mult <= 0) continue;
      // Pas deux crises du même type à moins de 60 jours d'intervalle
      if (t - (cr.last[kind] ?? -1e9) < 60) continue;
      const p = this.probability(state, kind) * mult;
      if (p > 0 && CrisisSystem.roll(state, 100 + k) < p && this.trigger(state, kind).ok) {
        state.events.lastRandom = t;
        break;
      }
    }
  }

  /**
   * Probabilité de déclenchement à chaque tirage (tous les 5 jours), avant le réglage de fréquence.
   * @returns {number}
   */
  probability(state, kind) {
    const mods = state.modifiers ?? {};
    const w = state.weather ?? {};
    const s = state.stats;
    const risk = (key) => mods[`risk.${key}`] ?? 1;
    switch (kind) {
      case 'flood': {
        if ((w.rain7 ?? 0) < 2.6) return 0;
        if (!this.#floodTargets(state).length) return 0;
        return Math.min(0.4, 0.1 * ((w.rain7 - 2) / 2)) * risk('flood');
      }
      case 'heat': {
        const hot = w.kind === 'heat' || (state.events?.active ?? []).some((e) => e.id === 'heatwave');
        if (!hot || s.population < 300) return 0;
        return 0.05 * (1 + Math.min(1, (s.avgHeat ?? 0) / 30)) * risk('heat');
      }
      case 'cyber': {
        const n = Object.keys(state.tech.researched).length;
        if (n < 2) return 0;
        return 0.0005 * n * (1 + 0.6 * (state.crises?.ransomsPaid ?? 0)) * risk('cyber');
      }
      case 'blackout': {
        const p = state.utilities.power ?? {};
        if (!(p.capacity > 0) || s.population < 500) return 0;
        const margin = p.demand > 0 ? p.capacity / p.demand : 9;
        let q = margin < 1.05 ? 0.014 : margin < 1.2 ? 0.005 : margin < 1.5 ? 0.0015 : 0.0005;
        if (w.kind === 'heat' || w.kind === 'storm' || this.isActive(state, 'heat')) q *= 2.2;
        if ((p.storageCap ?? 0) > 0.25 * (p.demand ?? 0)) q *= 0.5;
        if (state.trade?.power?.buy) q *= 0.7;
        return q * risk('blackout');
      }
      case 'strike': {
        const pax = state.transit.passengersPerDay ?? 0;
        if (pax < 300) return 0;
        return 0.002 * (s.satisfaction < 50 ? 2 : 1) * (state.economy.treasury < 0 ? 1.5 : 1) * risk('strike');
      }
      case 'fire': {
        if (state.buildings.size < 25 || s.population < 200) return 0;
        const g = state.grid;
        let cover = 0;
        let n = 0;
        for (const b of state.buildings.values()) {
          if (this.catalog.buildingFor(b).kind !== 'growable') continue;
          cover += g.coverFire[g.idx(b.x, b.y)];
          n++;
        }
        const avg = n ? cover / n : 0;
        const hot = w.kind === 'heat' ? 1.6 : w.kind === 'rain' || w.kind === 'snow' ? 0.6 : 1;
        return 0.009 * hot * (1 - 0.7 * Math.min(1, avg)) * Math.min(1.5, 0.6 + n / 400) * risk('fire');
      }
      default:
        return 0;
    }
  }

  /** Probabilité mensuelle approximative (affichage des risques), réglage de fréquence compris. */
  monthlyRisk(state, kind) {
    const p = this.probability(state, kind) * this.frequency(state, kind);
    return 1 - Math.pow(1 - Math.min(1, p), SIM.DAYS_PER_MONTH / CHECK_EVERY);
  }

  /**
   * Déclenche une crise (tirage réussi, scénario ou commande du joueur).
   * @returns {{ok:boolean, reason?:string, crisis?:any}}
   */
  trigger(state, kind, { manual = false } = {}) {
    const cr = this.#ensure(state);
    const type = CRISIS_TYPES[kind];
    if (!type) return { ok: false, reason: 'Type de crise inconnu' };
    if (this.isActive(state, kind)) return { ok: false, reason: `${type.name} déjà en cours` };
    const t = state.time.tick;
    const sev = 0.35 + 0.65 * CrisisSystem.roll(state, 200 + CRISIS_KINDS.indexOf(kind));
    const c = { id: cr.nextId++, kind, label: type.name, start: t, until: t + 5, severity: Math.round(sev * 100) / 100, effects: [], response: null, damage: 0, manual };
    let ok = true;
    let reason = '';
    switch (kind) {
      case 'flood':
        ok = this.#startFlood(state, c);
        reason = 'Aucun quartier bâti en zone inondable';
        break;
      case 'heat':
        c.until = t + 7 + Math.round(6 * sev);
        c.effects = [
          { key: 'powerDemandMult', op: 'mul', value: 0.28 },
          { key: 'waterDemandMult', op: 'mul', value: 0.25 },
          { key: 'heatMult', op: 'mul', value: 0.35 },
          { key: 'satisfaction.all', op: 'add', value: -6 },
          { key: 'satisfaction.low', op: 'add', value: -3 }
        ];
        break;
      case 'cyber': {
        const techs = Object.keys(state.tech.researched).sort();
        if (!techs.length) {
          ok = false;
          reason = 'Aucune technologie déployée';
          break;
        }
        c.until = t + 9 + Math.round(8 * sev);
        c.techs = techs;
        for (const id of techs) state.tech.outages[id] = Math.max(state.tech.outages[id] ?? 0, c.until);
        c.effects = [{ key: 'satisfaction.all', op: 'add', value: -2 }];
        break;
      }
      case 'blackout': {
        const plants = [...state.buildings.values()].filter((b) => {
          const cap = this.catalog.buildingFor(b).capacity;
          return cap.powerOutput > 0 && cap.powerSource !== 'solar' && cap.powerSource !== 'wind';
        });
        if (!plants.length) {
          ok = false;
          reason = 'Aucune centrale pilotable';
          break;
        }
        c.until = t + 2 + Math.round(3 * sev);
        c.buildings = plants.map((b) => b.id).sort((a, z) => a - z);
        for (const b of plants) b.disabledUntil = Math.max(b.disabledUntil ?? 0, c.until);
        c.effects = [{ key: 'satisfaction.all', op: 'add', value: -3 }];
        const p = plants[0];
        c.x = p.x;
        c.y = p.y;
        state.dirty.utilities = true;
        break;
      }
      case 'strike': {
        const lines = [...state.buildings.values()].filter((b) => {
          const tr = this.catalog.buildingFor(b).capacity.transit;
          return tr && (tr.mode === 'bus' || tr.mode === 'metro');
        });
        if (!lines.length) {
          ok = false;
          reason = 'Aucun réseau de bus ni de métro';
          break;
        }
        c.until = t + 7 + Math.round(8 * sev);
        c.buildings = lines.map((b) => b.id).sort((a, z) => a - z);
        for (const b of lines) b.disabledUntil = Math.max(b.disabledUntil ?? 0, c.until);
        c.effects = [{ key: 'satisfaction.all', op: 'add', value: -2 }, { key: 'tripGenerationMult', op: 'mul', value: -0.04 }];
        break;
      }
      case 'fire':
        ok = this.#startFire(state, c);
        reason = 'Aucun bâtiment exposé';
        break;
      default:
        ok = false;
    }
    if (!ok) {
      cr.nextId--;
      return { ok: false, reason };
    }
    cr.active.push(c);
    cr.last[kind] = t;
    cr.total++;
    state.dirty.modifiers = true;
    state.dirty.utilities = true;
    const where = Number.isInteger(c.x) ? { x: c.x, y: c.y } : {};
    this.#notify(state, type.level, `${type.icon} ${type.name} : ${type.summary}`, { kind: 'crisis', crisisId: c.id, ...where });
    this.bus?.emit('crisis:started', { crisis: structuredClone(c) });
    if (c.tiles?.length) this.bus?.emit('world:changed', { tiles: c.tiles, reason: 'flood' });
    return { ok: true, crisis: c };
  }

  // ───────────────────────────── Inondation ─────────────────────────────

  /** Cases bâties ou aménagées exposées à une crue (point de départ possible). */
  #floodTargets(state) {
    const g = state.grid;
    const out = [];
    const near = (x, y) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (g.inBounds(x + dx, y + dy) && g.terrain[g.idx(x + dx, y + dy)] === TERRAIN.WATER) return true;
      }
      return false;
    };
    for (let i = 0; i < g.size; i++) {
      if (!isProne(g, i) || !(g.building[i] || g.road[i] || g.zone[i])) continue;
      if (near(g.xOf(i), g.yOf(i))) out.push(i);
    }
    return out;
  }

  #startFlood(state, c) {
    const g = state.grid;
    const targets = this.#floodTargets(state);
    if (!targets.length) return false;
    const seed = targets[Math.floor(CrisisSystem.roll(state, 301) * targets.length)];
    const risk = state.modifiers?.['risk.flood'] ?? 1;
    const maxTiles = Math.round((14 + 46 * c.severity) * (0.5 + 0.5 * Math.min(1, risk)));
    // Propagation sur les terres basses proches de l'eau ; parcs et forêts absorbent la crue.
    const absorbs = (i) => {
      if (g.terrain[i] === TERRAIN.FOREST && !g.building[i]) return true;
      const b = g.building[i] ? state.buildings.get(g.building[i]) : null;
      return !!b && this.catalog.buildingFor(b).category === 'parks';
    };
    const seen = new Set([seed]);
    const queue = [seed];
    const tiles = [];
    while (queue.length && tiles.length < maxTiles) {
      const i = queue.shift();
      tiles.push(i);
      const x = g.xOf(i);
      const y = g.yOf(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!g.inBounds(x + dx, y + dy)) continue;
        const n = g.idx(x + dx, y + dy);
        if (seen.has(n)) continue;
        seen.add(n);
        if (isProne(g, n) && !absorbs(n)) queue.push(n);
      }
    }
    tiles.sort((a, z) => a - z);
    c.tiles = tiles;
    c.until = state.time.tick + 5 + Math.round(6 * c.severity);
    c.x = g.xOf(seed);
    c.y = g.yOf(seed);
    const hit = new Set();
    for (const i of tiles) if (g.building[i]) hit.add(g.building[i]);
    c.buildings = [...hit].sort((a, z) => a - z);
    for (const id of c.buildings) {
      const b = state.buildings.get(id);
      b.disabledUntil = Math.max(b.disabledUntil ?? 0, c.until);
      b.disasterUntil = Math.max(b.disasterUntil ?? 0, c.until);
    }
    const roads = tiles.filter((i) => g.road[i]).length;
    c.effects = [
      { key: 'roadCapacityMult', op: 'mul', value: -Math.min(0.3, 0.03 + roads * 0.004) },
      { key: 'satisfaction.all', op: 'add', value: -2 }
    ];
    state.dirty.environment = true;
    return true;
  }

  // ───────────────────────────── Incendie ─────────────────────────────

  #startFire(state, c) {
    const g = state.grid;
    const cands = [];
    let total = 0;
    for (const b of [...state.buildings.values()].sort((a, z) => a.id - z.id)) {
      const def = this.catalog.buildingFor(b);
      if (def.category === 'parks' || def.visual.roof === 'park' || def.visual.detail === 'pylon' || b.burnt) continue;
      let w = def.category === 'industry' ? 3 : def.kind === 'growable' ? 1 : 0.4;
      w *= 1.2 - Math.min(1, g.coverFire[g.idx(b.x, b.y)]);
      if (w <= 0) continue;
      total += w;
      cands.push([b, w]);
    }
    if (!cands.length) return false;
    let r = CrisisSystem.roll(state, 401) * total;
    let start = cands[cands.length - 1][0];
    for (const [b, w] of cands) {
      r -= w;
      if (r <= 0) {
        start = b;
        break;
      }
    }
    c.burning = {};
    c.burnt = [];
    c.x = start.x;
    c.y = start.y;
    c.until = state.time.tick + 60; // borne de sécurité : la fin réelle survient quand plus rien ne brûle
    this.#ignite(state, c, start);
    c.effects = [{ key: 'satisfaction.all', op: 'add', value: -1 }];
    return true;
  }

  #ignite(state, c, b) {
    const g = state.grid;
    const cover = Math.min(1, g.coverFire[g.idx(b.x, b.y)]);
    const days = c.response === 'reinforce' ? 1 : Math.round(3 + 7 * (1 - cover) * (0.6 + 0.4 * c.severity));
    const until = state.time.tick + days;
    c.burning[b.id] = until;
    b.disabledUntil = Math.max(b.disabledUntil ?? 0, until);
    b.disasterUntil = Math.max(b.disasterUntil ?? 0, until);
    b.burning = until;
    this.bus?.emit('building:changed', { building: b });
  }

  #fireStep(state, c) {
    const g = state.grid;
    const t = state.time.tick;
    const ids = Object.keys(c.burning).map(Number).sort((a, z) => a - z);
    let k = 0;
    for (const id of ids) {
      const b = state.buildings.get(id);
      const until = c.burning[id];
      if (!b) {
        delete c.burning[id];
        continue;
      }
      // Propagation aux bâtiments voisins (une case autour de l'emprise)
      if (c.response !== 'reinforce' && t < until) {
        const neighbors = new Set();
        for (let y = b.y - 1; y <= b.y + b.h; y++) {
          for (let x = b.x - 1; x <= b.x + b.w; x++) {
            if (!g.inBounds(x, y)) continue;
            const nid = g.building[g.idx(x, y)];
            if (nid && nid !== b.id && !c.burning[nid] && !c.burnt.includes(nid)) neighbors.add(nid);
          }
        }
        for (const nid of [...neighbors].sort((a, z) => a - z)) {
          const n = state.buildings.get(nid);
          const def = this.catalog.buildingFor(n);
          if (def.category === 'parks' || def.visual.roof === 'park') continue;
          const cover = Math.min(1, g.coverFire[g.idx(n.x, n.y)]);
          const p = 0.16 * (1 - 0.85 * cover) * (state.weather?.kind === 'heat' ? 1.5 : state.weather?.kind === 'rain' ? 0.5 : 1);
          if (CrisisSystem.roll(state, 500 + (k++ % 97), nid) < p) this.#ignite(state, c, n);
        }
      }
      if (t >= until) this.#burnOut(state, c, b);
    }
    if (!Object.keys(c.burning).length) c.until = t;
  }

  /** Fin du feu sur un bâtiment : un bâtiment privé mal protégé est détruit, un équipement public est endommagé. */
  #burnOut(state, c, b) {
    const g = state.grid;
    const def = this.catalog.buildingFor(b);
    delete c.burning[b.id];
    delete b.burning;
    c.burnt.push(b.id);
    const cover = Math.min(1, g.coverFire[g.idx(b.x, b.y)]);
    const destroyed = def.kind === 'growable' && c.response !== 'reinforce' && CrisisSystem.roll(state, 601, b.id) < 0.75 - 0.6 * cover;
    if (destroyed) {
      const tiles = [];
      for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) tiles.push(g.idx(b.x + dx, b.y + dy));
      removeBuilding(state, b);
      this.bus?.emit('building:removed', { building: b });
      this.bus?.emit('world:changed', { tiles, reason: 'fire' });
      c.destroyed = (c.destroyed ?? 0) + 1;
      state.dirty.utilities = true;
      state.dirty.environment = true;
    } else {
      // Remise en état : quelques jours d'arrêt supplémentaires et facture pour les équipements publics
      b.disabledUntil = Math.max(b.disabledUntil ?? 0, state.time.tick + (def.kind === 'plop' ? 12 : 4));
      if (def.kind === 'plop') c.damage += toCents(Math.round((def.cost ?? 10000) * 0.18));
      this.bus?.emit('building:changed', { building: b });
    }
  }

  // ───────────────────────────── Réponses et fin ─────────────────────────────

  /**
   * Réponse du maire à une crise en cours (une seule fois).
   * @returns {{ok:boolean, reason?:string, cost?:number}}
   */
  respond(state, crisisId, optionId) {
    const cr = this.#ensure(state);
    const c = cr.active.find((x) => x.id === crisisId);
    if (!c) return { ok: false, reason: 'Crise terminée' };
    if (c.response) return { ok: false, reason: 'Décision déjà prise' };
    const type = CRISIS_TYPES[c.kind];
    if (!type.responses.some((r) => r.id === optionId)) return { ok: false, reason: 'Réponse inconnue' };
    const euros = responseCost(state, c, optionId);
    const cents = toCents(euros);
    if (cents > 0 && !this.economy.canAfford(state, cents)) return { ok: false, reason: 'Budget insuffisant' };
    if (cents > 0) this.economy.payOpex(state, { amount: cents, category: 'crisis', label: `${type.name} : ${type.responses.find((r) => r.id === optionId).label}`, ref: `crisis-${c.id}` });
    c.response = optionId;
    const t = state.time.tick;
    switch (`${c.kind}:${optionId}`) {
      case 'flood:rescue': {
        const until = Math.max(t + 1, Math.ceil(t + (c.until - t) / 2));
        c.until = until;
        for (const id of c.buildings ?? []) {
          const b = state.buildings.get(id);
          if (b) {
            b.disabledUntil = Math.min(b.disabledUntil, until);
            b.disasterUntil = Math.min(b.disasterUntil ?? 0, until);
          }
        }
        break;
      }
      case 'heat:plan':
        c.effects = c.effects.map((e) => (e.key.startsWith('satisfaction') ? { ...e, value: e.value / 3 } : e));
        break;
      case 'cyber:ransom':
        cr.ransomsPaid = (cr.ransomsPaid ?? 0) + 1;
        c.until = t + 1;
        for (const id of c.techs ?? []) if (state.tech.outages[id] > t + 1) state.tech.outages[id] = t + 1;
        break;
      case 'cyber:restore': {
        c.until = Math.max(t + 1, t + Math.round(((c.until - t) * 2) / 3));
        for (const id of c.techs ?? []) if (state.tech.outages[id] > c.until) state.tech.outages[id] = c.until;
        break;
      }
      case 'blackout:import':
        c.restoreBuy = !!state.trade.power.buy;
        state.trade.power.buy = true;
        state.dirty.utilities = true;
        break;
      case 'strike:negotiate': {
        c.until = Math.min(c.until, t + 2);
        for (const id of c.buildings ?? []) {
          const b = state.buildings.get(id);
          if (b && b.disabledUntil > c.until) b.disabledUntil = c.until;
        }
        break;
      }
      case 'strike:hold':
        c.effects = [...c.effects, { key: 'satisfaction.all', op: 'add', value: -2 }];
        break;
      case 'fire:reinforce':
        for (const id of Object.keys(c.burning).map(Number)) {
          c.burning[id] = Math.min(c.burning[id], t + 1);
          const b = state.buildings.get(id);
          if (b) b.burning = c.burning[id];
        }
        break;
      default:
        break;
    }
    state.dirty.modifiers = true;
    state.dirty.utilities = true;
    this.bus?.emit('crisis:changed', { crisis: structuredClone(c) });
    return { ok: true, cost: cents };
  }

  #end(state, c) {
    const cr = state.crises;
    const type = CRISIS_TYPES[c.kind];
    const t = state.time.tick;
    cr.active = cr.active.filter((x) => x.id !== c.id);
    // Dégâts payés à la fin (réparations)
    if (c.kind === 'flood') {
      let dmg = 0;
      for (const id of c.buildings ?? []) {
        const b = state.buildings.get(id);
        if (!b) continue;
        const def = this.catalog.buildingFor(b);
        dmg += def.kind === 'plop' ? Math.round((def.cost ?? 10000) * 0.08) : 600 + 400 * (def.level ?? 1);
      }
      dmg += 150 * (c.tiles ?? []).filter((i) => state.grid.road[i]).length;
      if (c.response === 'rescue') dmg = Math.round(dmg / 2);
      c.damage += toCents(dmg);
      this.bus?.emit('world:changed', { tiles: c.tiles ?? [], reason: 'flood-end' });
    }
    if (c.kind === 'blackout' && c.response === 'import') {
      state.trade.power.buy = !!c.restoreBuy;
    }
    if (c.kind === 'fire') {
      for (const id of Object.keys(c.burning ?? {}).map(Number)) {
        const b = state.buildings.get(id);
        if (b) delete b.burning;
      }
    }
    if (c.damage > 0) this.economy.payOpex(state, { amount: c.damage, category: 'crisis', label: `${type.name} : réparations`, ref: `crisis-${c.id}` });
    const summary = this.#summary(c);
    cr.history.push({ id: c.id, kind: c.kind, label: c.label, start: c.start, end: t, response: c.response, damage: c.damage, summary });
    if (cr.history.length > 40) cr.history.shift();
    state.dirty.modifiers = true;
    state.dirty.utilities = true;
    state.dirty.environment = true;
    this.#notify(state, 'info', `Fin de la crise — ${type.name}${summary ? ` : ${summary}` : ''}`, { kind: 'crisis-end', crisisId: c.id });
    this.bus?.emit('crisis:ended', { crisis: structuredClone(c) });
  }

  #summary(c) {
    const parts = [];
    if (c.kind === 'flood') parts.push(`${c.tiles?.length ?? 0} cases inondées, ${c.buildings?.length ?? 0} bâtiments touchés`);
    if (c.kind === 'fire') parts.push(`${c.burnt?.length ?? 0} bâtiment(s) touché(s)${c.destroyed ? `, ${c.destroyed} détruit(s)` : ''}`);
    if (c.damage > 0) parts.push(`réparations ${Math.round(c.damage / 100).toLocaleString('fr-FR')} €`);
    return parts.join(' · ');
  }
}
