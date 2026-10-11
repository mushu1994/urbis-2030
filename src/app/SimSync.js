import { LAYER_SPECS } from '../world/Grid.js';

/**
 * Synchronisation de l'état entre la simulation (Web Worker, autoritaire) et sa réplique dans le fil
 * principal (lue par le rendu et l'interface).
 *
 * Un instantané contient :
 *  - toutes les couches de la grille (tableaux typés transférés sans copie) ;
 *  - les bâtiments (JSON : plus rapide à relire qu'un clonage structuré d'objets nombreux) ;
 *  - les champs « légers » de l'état (temps, statistiques, technologies, météo, crises, scénario…) ;
 *  - les parties volumineuses seulement quand elles changent : écritures comptables nouvelles depuis le
 *    dernier envoi, immobilisations, périodes clôturées, historique mensuel, historique d'annulation.
 */

export const TRAFFIC_ARRAYS = ['acc', 'cost', 'jobW', 'shopW'];

/** Champs de l'état recopiés à chaque instantané (hors grille, bâtiments, économie, historique). */
export const SCALAR_KEYS = [
  'time', 'revisions', 'nextBuildingId', 'entries', 'tech', 'policies', 'events', 'demand', 'stats',
  'logistics', 'transit', 'waste', 'progression', 'trade', 'utilities', 'modifiers', 'weather', 'crises',
  'scenario', 'options', 'dirty'
];

/** Événements jamais relayés (trop fréquents ou sans intérêt pour l'interface). */
const SILENT = new Set(['sim:tick', 'economy:changed', 'command:done']);

/** Côté simulation : fabrique les instantanés et ne renvoie que ce qui a changé. */
export class SnapshotEncoder {
  /** @param {import('./GameSession.js').GameSession} session */
  constructor(session) {
    this.session = session;
    this.sentTxId = -1;
    this.sig = { assets: '', periods: '', history: '' };
  }

  /**
   * @param {{full?:boolean, undo?:boolean}} [opts]
   * @returns {{msg:any, transfer:ArrayBuffer[]}}
   */
  encode({ full = false, undo = false } = {}) {
    const session = this.session;
    const s = session.state;
    const g = s.grid;
    const transfer = [];
    const layers = {};
    for (const name of Object.keys(LAYER_SPECS)) {
      const copy = g[name].slice();
      layers[name] = copy;
      transfer.push(copy.buffer);
    }
    const traffic = {};
    const trafficArrays = {};
    for (const [k, v] of Object.entries(s.traffic)) {
      if (TRAFFIC_ARRAYS.includes(k)) {
        if (v) {
          const copy = v.slice();
          trafficArrays[k] = copy;
          transfer.push(copy.buffer);
        } else trafficArrays[k] = null;
      } else traffic[k] = v;
    }
    const { ledger, assets, periods, ...economy } = s.economy;
    const scalars = { rng: s.rng.state, traffic, economy };
    for (const k of SCALAR_KEYS) scalars[k] = s[k];

    const msg = {
      type: 'snapshot',
      full,
      tick: s.time.tick,
      layers,
      trafficArrays,
      scalars,
      buildingsJson: JSON.stringify([...s.buildings.values()]),
      timings: session.sim.timings
    };

    // Journal comptable : uniquement les écritures nouvelles
    const from = full ? -1 : this.sentTxId;
    let k = ledger.length;
    while (k > 0 && ledger[k - 1].id > from) k--;
    msg.ledgerFrom = from;
    msg.ledgerFirst = ledger.length ? ledger[0].id : s.economy.nextTxId;
    msg.ledgerJson = JSON.stringify(ledger.slice(k));
    this.sentTxId = s.economy.nextTxId - 1;

    const monthIndex = Math.floor(s.time.tick / 30);
    const sig = {
      assets: `${assets.length}:${s.economy.nextAssetId}:${monthIndex}:${assets.at(-1)?.remaining ?? 0}`,
      periods: `${periods.length}:${periods.at(-1)?.monthIndex ?? -1}`,
      history: `${s.history.length}:${s.history.at(-1)?.monthIndex ?? -1}`
    };
    if (full || sig.assets !== this.sig.assets) msg.assetsJson = JSON.stringify(assets);
    if (full || sig.periods !== this.sig.periods) msg.periodsJson = JSON.stringify(periods);
    if (full || sig.history !== this.sig.history) msg.historyJson = JSON.stringify(s.history);
    this.sig = sig;
    if (full || undo) msg.undoJson = JSON.stringify(session.history.entries);
    return { msg, transfer };
  }
}

/** Côté interface : réplique et dernières données confirmées par la simulation. */
export class SnapshotDecoder {
  /** @param {import('./GameSession.js').GameSession} session réplique */
  constructor(session) {
    this.session = session;
    const eco = session.state.economy;
    this.confirmed = {
      ledger: eco.ledger.slice(),
      assets: eco.assets.slice(),
      periods: eco.periods,
      history: session.state.history,
      undo: session.history.entries.slice()
    };
  }

  /**
   * Remplace la réplique par l'instantané (les commandes non encore confirmées sont rejouées ensuite).
   * Les objets de l'état (grille, carte des bâtiments, état lui-même) gardent leur identité : le rendu et
   * l'interface qui en conservent une référence restent valides.
   */
  apply(msg) {
    const session = this.session;
    const s = session.state;
    const g = s.grid;
    const c = this.confirmed;
    for (const [name, arr] of Object.entries(msg.layers)) g[name].set(arr);
    const sc = msg.scalars;
    s.rng.state = sc.rng;
    for (const k of SCALAR_KEYS) if (k in sc) s[k] = sc[k];
    const traffic = sc.traffic;
    for (const k of TRAFFIC_ARRAYS) traffic[k] = msg.trafficArrays[k] ?? null;
    s.traffic = traffic;

    // Économie : parties confirmées + écritures nouvelles ; copies superficielles (une commande rejouée
    // ajoute ses écritures à la copie, jamais aux données confirmées).
    let ledger = c.ledger;
    if (msg.ledgerFrom < 0) ledger = [];
    else {
      let k = ledger.length;
      while (k > 0 && ledger[k - 1].id > msg.ledgerFrom) k--;
      if (k < ledger.length) ledger = ledger.slice(0, k);
    }
    const tail = JSON.parse(msg.ledgerJson);
    if (tail.length) ledger = ledger.concat(tail);
    let first = 0;
    while (first < ledger.length && ledger[first].id < msg.ledgerFirst) first++;
    if (first) ledger = ledger.slice(first);
    c.ledger = ledger;
    if (msg.assetsJson) c.assets = JSON.parse(msg.assetsJson);
    if (msg.periodsJson) c.periods = JSON.parse(msg.periodsJson);
    if (msg.historyJson) c.history = JSON.parse(msg.historyJson);
    if (msg.undoJson) c.undo = JSON.parse(msg.undoJson);
    s.economy = { ...sc.economy, ledger: c.ledger.slice(), assets: c.assets.slice(), periods: c.periods };
    s.history = c.history;
    session.history.entries = c.undo.slice();

    const list = JSON.parse(msg.buildingsJson);
    s.buildings.clear();
    for (const b of list) s.buildings.set(b.id, b);
    if (msg.timings) session.sim.timings = msg.timings;
  }
}

/**
 * Enregistre les événements émis sur un bus (côté simulation) pour les relayer à l'interface.
 * Les événements « structurels » (cases et bâtiments modifiés) sont aussi résumés en ensembles
 * de cases et de bâtiments touchés.
 */
export class EventRecorder {
  constructor(bus) {
    this.bus = bus;
    this.events = [];
    this.tiles = new Set();
    this.allTiles = false;
    this.buildings = new Set();
    this.phase = 'tick';
    const emit = bus.emit.bind(bus);
    bus.emit = (type, payload) => {
      this.#record(type, payload);
      emit(type, payload);
    };
  }

  #record(type, payload) {
    if (type === 'world:changed') {
      if (payload?.tiles) for (const i of payload.tiles) this.tiles.add(i);
      else this.allTiles = true;
    }
    if (type === 'building:added' || type === 'building:changed' || type === 'building:removed') {
      if (payload?.building) this.buildings.add(payload.building.id);
    }
    // Pendant l'application d'une commande, l'interface a déjà émis ces événements (prédiction locale).
    if (this.phase !== 'tick' || SILENT.has(type)) return;
    this.events.push({ type, payload: payload === undefined ? null : cloneable(payload) });
  }

  drain() {
    const out = {
      events: this.events,
      touched: { tiles: this.allTiles ? null : [...this.tiles], buildings: [...this.buildings] }
    };
    this.events = [];
    this.tiles = new Set();
    this.allTiles = false;
    this.buildings = new Set();
    return out;
  }
}

/** Copie sans fonctions ni objets non clonables (les bâtiments sont de simples objets de données). */
function cloneable(payload) {
  try {
    return structuredClone(payload);
  } catch {
    return JSON.parse(JSON.stringify(payload));
  }
}
