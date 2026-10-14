import { GameState, defaultTrade } from '../app/GameState.js';
import { Grid } from '../world/Grid.js';
import { Rng } from '../util/rng.js';
import { typedToBase64, base64ToTyped, checksum } from '../util/encoding.js';
import { defaultLand } from '../world/Land.js';
import { validateSaveData } from '../data/Validators.js';
import { CURRENT_FORMAT_VERSION, migrate } from './SaveMigration.js';
import { formatDate } from '../simulation/config.js';
import { defaultWeather } from '../simulation/WeatherSystem.js';
import { defaultCrises, defaultOptions } from '../simulation/CrisisSystem.js';
import { defaultPolitics, LEGACY_FIRST_ELECTION_MONTHS } from '../simulation/PoliticsSystem.js';

export const TRAFFIC_ARRAYS = { acc: Float32Array, cost: Float64Array, jobW: Float64Array, shopW: Float64Array };

/**
 * Sérialise l'état de jeu en objet JSON versionné.
 * Ne contient aucun objet graphique : le rendu est entièrement reconstruit à partir des données.
 */
export function serializeState(state) {
  const traffic = { ...state.traffic };
  for (const k of Object.keys(TRAFFIC_ARRAYS)) traffic[k] = traffic[k] ? typedToBase64(traffic[k]) : null;
  const { disabledModes, compute, ...mods } = state.modifiers;
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    meta: { ...state.meta },
    world: state.grid.serialize(),
    entries: [...state.entries],
    buildings: [...state.buildings.values()].map((b) => ({ ...b, counters: { ...b.counters }, ages: b.ages ? { ...b.ages } : undefined })),
    nextBuildingId: state.nextBuildingId,
    time: { ...state.time },
    revisions: { ...state.revisions },
    rng: state.rng.serialize(),
    economy: structuredClone(state.economy),
    tech: structuredClone(state.tech),
    policies: structuredClone(state.policies),
    events: structuredClone(state.events),
    demand: { ...state.demand },
    stats: structuredClone(state.stats),
    history: structuredClone(state.history),
    traffic,
    logistics: structuredClone(state.logistics),
    transit: structuredClone(state.transit),
    waste: structuredClone(state.waste),
    progression: { ...state.progression },
    trade: structuredClone(state.trade),
    utilities: structuredClone(state.utilities),
    weather: structuredClone(state.weather ?? null),
    crises: structuredClone(state.crises ?? null),
    scenario: structuredClone(state.scenario ?? null),
    options: structuredClone(state.options ?? null),
    land: structuredClone(state.land ?? null),
    politics: structuredClone(state.politics ?? null),
    modifiers: { ...mods, disabledModes: { ...(disabledModes ?? {}) }, compute: compute ? { ...compute } : undefined },
    dirty: { ...state.dirty }
  };
}

/**
 * Reconstruit un état à partir d'une sauvegarde (après migration et validation).
 * @throws {Error} si la sauvegarde est invalide
 */
export function deserializeState(raw) {
  const { data } = migrate(raw);
  const errors = validateSaveData(data, CURRENT_FORMAT_VERSION);
  if (errors.length) {
    const e = new Error(`Sauvegarde invalide : ${errors.join(' ; ')}`);
    e.details = errors;
    throw e;
  }
  const grid = Grid.deserialize(data.world);
  const s = new GameState({ grid, seed: data.meta.seed, name: data.meta.name });
  s.meta = { ...data.meta };
  s.entries = data.entries;
  for (const b of data.buildings) {
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`Valeur non numérique dans le bâtiment ${b.id} (${k})`);
    }
    const w = b.w;
    const h = b.h;
    if (!grid.inBounds(b.x, b.y) || !grid.inBounds(b.x + w - 1, b.y + h - 1)) throw new Error(`Bâtiment ${b.id} hors carte`);
    s.buildings.set(b.id, b);
  }
  s.nextBuildingId = data.nextBuildingId;
  s.time = data.time;
  s.revisions = data.revisions ?? { roads: 0 };
  s.rng = Rng.from(data.rng);
  s.economy = data.economy;
  s.tech = data.tech;
  s.policies = data.policies;
  s.events = data.events;
  s.demand = data.demand;
  s.stats = data.stats;
  s.history = data.history ?? [];
  const traffic = data.traffic ?? {};
  for (const [k, Ctor] of Object.entries(TRAFFIC_ARRAYS)) traffic[k] = traffic[k] ? base64ToTyped(traffic[k], Ctor) : null;
  s.traffic = traffic;
  s.logistics = data.logistics ?? { stats: {} };
  s.transit = data.transit ?? { stats: {}, passengersPerDay: 0 };
  s.waste = data.waste ?? { stats: {} };
  s.progression = data.progression ?? { era: 1, eraSince: 0 };
  s.trade = data.trade ?? defaultTrade();
  s.utilities = data.utilities ?? { power: {}, water: {} };
  s.weather = data.weather ?? defaultWeather();
  s.crises = data.crises ?? defaultCrises();
  s.scenario = data.scenario ?? null;
  s.options = data.options ?? defaultOptions('off');
  s.land = data.land ?? defaultLand(grid.width, grid.height);
  if (data.politics) s.politics = data.politics;
  else {
    // Partie d'avant la v0.7 : la vie politique démarre, premier scrutin dans 3 ans
    const enabled = s.options.elections ? s.options.elections === 'on' : true;
    s.options.elections ??= enabled ? 'on' : 'off';
    s.politics = defaultPolitics(s, { enabled, firstElectionMonths: LEGACY_FIRST_ELECTION_MONTHS });
    s.politics.announce = enabled;
  }
  s.modifiers = data.modifiers ?? {};
  s.dirty = { ...s.dirty, ...(data.dirty ?? {}), roads: true, roadReach: true };
  if (!data.modifiers) s.dirty.modifiers = true;
  return s;
}

/** Résumé affiché dans la liste des sauvegardes. */
export function summarize(state) {
  return {
    name: state.meta.name,
    population: state.stats.population,
    treasury: state.economy.treasury,
    date: formatDate(state.time.tick),
    size: `${state.grid.width}×${state.grid.height}`
  };
}

const DB_NAME = 'urbis-2030';
const DB_VERSION = 1;
const STORE = 'saves';

/**
 * Sauvegardes locales dans IndexedDB.
 * Enregistrement : { id, name, kind: 'manual'|'auto', formatVersion, createdAt, updatedAt, summary, checksum, payload }.
 * - L'écriture est vérifiée par relecture et somme de contrôle avant d'être considérée réussie.
 * - La sauvegarde automatique alterne entre deux emplacements : une écriture ratée ou corrompue
 *   n'écrase jamais la dernière sauvegarde automatique valide.
 */
export class SaveService {
  /** @param {{indexedDB?: IDBFactory}} [opts] */
  constructor({ indexedDB: idb } = {}) {
    this.idb = idb ?? globalThis.indexedDB;
    this.dbPromise = null;
  }

  #open() {
    if (!this.idb) return Promise.reject(new Error('IndexedDB indisponible dans ce navigateur'));
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = this.idb.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Ouverture de la base impossible'));
      });
    }
    return this.dbPromise;
  }

  async #tx(mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      const req = fn(store);
      if (req) req.onsuccess = () => (result = req.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('Erreur de transaction'));
      tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée (quota dépassé ?)'));
    });
  }

  async list() {
    const all = await this.#tx('readonly', (s) => s.getAll());
    return (all ?? [])
      .map(({ payload, ...meta }) => ({ ...meta, sizeKb: Math.round((payload?.length ?? 0) / 1024) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id) {
    return this.#tx('readonly', (s) => s.get(id));
  }

  /**
   * Prépare un enregistrement : sérialisation, validation de l'état sérialisé, somme de contrôle.
   * @throws si l'état courant n'est pas valide (on refuse d'écrire une sauvegarde corrompue)
   */
  buildRecord(state, { id, name, kind }) {
    const data = serializeState(state);
    const errors = validateSaveData(data, CURRENT_FORMAT_VERSION);
    if (errors.length) throw new Error(`État invalide, sauvegarde refusée : ${errors.join(' ; ')}`);
    const payload = JSON.stringify(data);
    const now = Date.now();
    return {
      id,
      name,
      kind,
      formatVersion: CURRENT_FORMAT_VERSION,
      createdAt: now,
      updatedAt: now,
      summary: summarize(state),
      checksum: checksum(payload),
      payload
    };
  }

  /** Écrit puis relit et vérifie un enregistrement. */
  async #writeVerified(record) {
    const existing = await this.get(record.id);
    if (existing) record.createdAt = existing.createdAt;
    await this.#tx('readwrite', (s) => s.put(record));
    const back = await this.get(record.id);
    if (!back || back.checksum !== checksum(back.payload) || back.checksum !== record.checksum) {
      throw new Error('Vérification de la sauvegarde échouée');
    }
    return { id: record.id, name: record.name, updatedAt: record.updatedAt, summary: record.summary };
  }

  async save(state, { id, name, kind = 'manual' }) {
    const record = this.buildRecord(state, { id: id ?? `manual-${Date.now().toString(36)}`, name: name ?? state.meta.name, kind });
    return this.#writeVerified(record);
  }

  /** Sauvegarde automatique sur deux emplacements alternés (le plus ancien est remplacé). */
  async autosave(state) {
    const metas = (await this.list()).filter((m) => m.kind === 'auto');
    const a = metas.find((m) => m.id === 'auto-a');
    const b = metas.find((m) => m.id === 'auto-b');
    const target = !a ? 'auto-a' : !b ? 'auto-b' : a.updatedAt <= b.updatedAt ? 'auto-a' : 'auto-b';
    return this.save(state, { id: target, name: `${state.meta.name} (auto)`, kind: 'auto' });
  }

  /**
   * Charge et valide une sauvegarde. Une sauvegarde corrompue lève une erreur sans rien modifier.
   * @returns {Promise<GameState>}
   */
  async load(id) {
    const rec = await this.get(id);
    if (!rec) throw new Error('Sauvegarde introuvable');
    return SaveService.parseRecord(rec);
  }

  static parseRecord(rec) {
    if (typeof rec.payload !== 'string' || checksum(rec.payload) !== rec.checksum) {
      throw new Error('Sauvegarde corrompue (somme de contrôle invalide)');
    }
    let raw;
    try {
      raw = JSON.parse(rec.payload);
    } catch {
      throw new Error('Sauvegarde illisible (JSON invalide)');
    }
    return deserializeState(raw);
  }

  async remove(id) {
    await this.#tx('readwrite', (s) => s.delete(id));
  }

  /** Export d'une partie vers un fichier (copie de secours, partage). */
  exportRecord(state) {
    return JSON.stringify(this.buildRecord(state, { id: 'export', name: state.meta.name, kind: 'manual' }));
  }

  /** Import d'un fichier exporté : validé avant toute écriture. */
  async importRecord(text) {
    let rec;
    try {
      rec = JSON.parse(text);
    } catch {
      throw new Error('Fichier illisible');
    }
    const state = SaveService.parseRecord(rec);
    return this.save(state, { id: `import-${Date.now().toString(36)}`, name: `${state.meta.name} (importée)`, kind: 'manual' });
  }
}
