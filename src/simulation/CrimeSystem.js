import { hash2 } from '../util/rng.js';

/**
 * Délinquance (v1.5) : cambriolages de logements et de bureaux, braquages de commerces.
 *
 * - Tirage quotidien et déterministe : hachage de la graine, du jour et du bâtiment. Le générateur pseudo-aléatoire
 *   de la partie n'est pas consommé, si bien que les autres systèmes tirent exactement les mêmes nombres qu'avant.
 * - Risque d'un bâtiment occupé : faible par défaut, multiplié par le chômage et la pauvreté, fortement réduit par la
 *   couverture police (commissariats et postes, avec leurs améliorations, qui élargissent et renforcent la couverture).
 * - Interpellation : d'autant plus probable que la police est présente ; les améliorations du commissariat ou du poste
 *   le plus proche (patrouilles, vidéoprotection, police prédictive) l'augmentent encore.
 * - Un indicateur, pas une sanction : les incidents alimentent le bilan de la ville (Risques et météo), l'inspecteur du
 *   bâtiment touché et, pour un braquage, une brève dans les notifications. Ils n'ont aucun effet sur la croissance,
 *   la satisfaction ni la trésorerie : l'équilibrage du jeu est inchangé (mesuré avec `npm run balance`).
 * - La vue 3D met en scène les incidents récents (alarme, fuite des malfaiteurs, voitures de police).
 */

/** Durée (jours) pendant laquelle un bâtiment garde la trace d'un cambriolage ou d'un braquage. */
export const CRIME_MEMORY_DAYS = 30;
/** Probabilités journalières de base, avant couverture police (par bâtiment occupé). */
const P_BURGLARY = 0.0007;
const P_ROBBERY = 0.0005;
/** Incidents conservés (journal récent, pour l'affichage). */
const KEEP = 40;

const POLICE_IDS = new Set(['police', 'police_post']);
const UPGRADE_BONUS = { police_patrols: 0.06, police_video: 0.1, police_predictive: 0.14 };

export function defaultCrime() {
  return { nextId: 1, incidents: [], month: { burglaries: 0, robberies: 0, arrests: 0 }, history: [] };
}

export function crimeOf(state) {
  state.crime ??= defaultCrime();
  return state.crime;
}

/** Nature du risque d'un bâtiment : cambriolage (logements, bureaux), braquage (commerces), ou aucun. */
export function crimeKind(def) {
  const cat = def?.category;
  if (cat === 'residential_low' || cat === 'residential_high' || cat === 'offices') return 'burglary';
  if (cat === 'commerce') return 'robbery';
  return null;
}

export class CrimeSystem {
  /** @param {{catalog: import('../data/Catalog.js').Catalog, bus?: any}} deps */
  constructor({ catalog, bus }) {
    this.catalog = catalog;
    this.bus = bus;
  }

  /** Probabilité journalière d'un incident sur un bâtiment (0 s'il n'est pas exposé). */
  risk(state, b, def = this.catalog.buildingFor(b)) {
    const kind = crimeKind(def);
    if (!kind || b.abandoned || b.ruins || b.constructionUntil > state.time.tick || b.disasterUntil > state.time.tick) return 0;
    const occupied = kind === 'robbery' ? b.jobsFilled > 0 : kind === 'burglary' && def.category === 'offices' ? b.jobsFilled > 0 : b.residents > 0;
    if (!occupied) return 0;
    const g = state.grid;
    const cover = Math.min(1, g.coverPolice[g.idx(b.x, b.y)] ?? 0);
    const unemployment = state.stats?.unemploymentRate ?? 0;
    const poor = b.incomeClass === 'low' ? 1.2 : b.incomeClass === 'high' ? 1.15 : 1;
    const size = kind === 'robbery' ? 1 : Math.min(2, 0.6 + (b.residents || b.jobsFilled || 0) / 60);
    const base = kind === 'robbery' ? P_ROBBERY : P_BURGLARY;
    return base * size * poor * (1 + 2.5 * unemployment) * (1 - 0.85 * cover);
  }

  /** Probabilité d'interpellation : couverture police et équipement du commissariat le plus proche. */
  arrestChance(state, b) {
    const g = state.grid;
    const cover = Math.min(1, g.coverPolice[g.idx(b.x, b.y)] ?? 0);
    let best = null;
    let bd = Infinity;
    for (const o of state.buildings.values()) {
      if (!POLICE_IDS.has(o.defId) || o.ruins || o.abandoned) continue;
      const d = Math.abs(o.x - b.x) + Math.abs(o.y - b.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    let bonus = 0;
    for (const id of best?.upgrades ?? []) bonus += UPGRADE_BONUS[id] ?? 0;
    return Math.min(0.95, 0.15 + 0.55 * cover + (best ? bonus * Math.min(1, cover * 1.5) : 0));
  }

  /** Appelé une fois par jour de simulation. */
  daily(state) {
    const cr = crimeOf(state);
    const t = state.time.tick;
    const seed = state.meta?.seed ?? 2030;
    const ids = [...state.buildings.keys()].sort((a, z) => a - z);
    const today = [];
    for (const id of ids) {
      const b = state.buildings.get(id);
      const def = this.catalog.buildingFor(b);
      const p = this.risk(state, b, def);
      if (p <= 0 || hash2(t, id, seed * 7 + 811) >= p) continue;
      const kind = crimeKind(def);
      const arrested = hash2(id, t, seed * 13 + 977) < this.arrestChance(state, b);
      today.push({ id: cr.nextId++, tick: t, kind, buildingId: id, x: b.x, y: b.y, arrested });
      b.crimeUntil = t + CRIME_MEMORY_DAYS;
      // au plus trois incidents par jour : la ville n'est pas un champ de bataille
      if (today.length >= 3) break;
    }
    for (const f of today) {
      cr.incidents.push(f);
      if (f.kind === 'robbery') cr.month.robberies++;
      else cr.month.burglaries++;
      if (f.arrested) cr.month.arrests++;
      if (f.kind === 'robbery') {
        const name = this.catalog.building(state.buildings.get(f.buildingId)?.defId)?.name ?? 'un commerce';
        this.bus?.emit('notify', {
          level: 'info',
          message: f.arrested ? `🚨 Braquage : ${name.toLowerCase()} — les malfaiteurs ont été interpellés.` : `🚨 Braquage : ${name.toLowerCase()} — les malfaiteurs ont pris la fuite.`,
          x: f.x,
          y: f.y,
          key: `robbery-${f.id}`
        });
      }
    }
    if (cr.incidents.length > KEEP) cr.incidents.splice(0, cr.incidents.length - KEEP);
  }

  /** Clôture du mois : bilan conservé un an. */
  monthly(state) {
    const cr = crimeOf(state);
    cr.history.push({ month: Math.floor(state.time.tick / 30) - 1, ...cr.month });
    if (cr.history.length > 12) cr.history.splice(0, cr.history.length - 12);
    cr.month = { burglaries: 0, robberies: 0, arrests: 0 };
  }
}
