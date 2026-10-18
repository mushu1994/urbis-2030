import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';
import { toCents } from '../util/money.js';
import { milestoneOf, milestoneLabel } from './Milestones.js';
import { efficiency } from './CouncilSystem.js';

/**
 * Événements populaires (v1.2, lot F) : fêtes de quartier, marchés, tournois, fête de la musique, marché de Noël,
 * festival, matchs et concerts au stade, grand événement régional.
 *
 * - Organisés depuis un lieu (parc, place, terrain de sport, marina, stade), payés à l'avance, un à la fois ; chaque
 *   lieu accueille au plus un événement tous les quatre mois. Ils ont lieu à la fin du mois (fête de la musique :
 *   juin ; marché de Noël : décembre).
 * - Effet = base × fréquentation (habitants autour, transports) × météo (pluie, orage, chaleur) × rendements
 *   décroissants (0,6 par édition du même type sur 12 mois) × année électorale (moitié) × adjoint aux Solidarités.
 * - Satisfaction locale pendant un mois, commerce, recettes (festival, stade), trafic ; incident possible si la police
 *   est absente ; facteur de popularité « Vie locale » (jusqu'à +4) ; clientélisme dénoncé en année électorale.
 */

export const EVENT_TYPES = {
  neighborhood: { label: 'Fête de quartier', feminine: true, venues: ['park_small', 'plaza', 'playground', 'park'], milestone: 0, euros: 3000, radius: 10, ref: 1000, sat: 4, points: 1.2 },
  market: { label: 'Marché de producteurs', venues: ['plaza', 'park'], milestone: 1, euros: 2000, radius: 8, ref: 800, sat: 2, points: 0.8, demandC: 3 },
  tournament: { label: 'Tournoi sportif', venues: ['sports_field'], milestone: 1, euros: 5000, radius: 12, ref: 1500, sat: 3, points: 1 },
  music: { label: 'Fête de la musique', feminine: true, venues: ['park'], milestone: 2, euros: 15000, radius: 16, ref: 3000, sat: 3, points: 1.5, night: true, month: 5 },
  christmas: { label: 'Marché de Noël', venues: ['plaza', 'park'], milestone: 2, euros: 20000, radius: 14, ref: 3000, sat: 2, points: 1.5, demandC: 15, month: 11 },
  festival: { label: 'Festival d\'été', venues: ['park', 'marina'], milestone: 3, euros: 60000, radius: 22, ref: 8000, sat: 4, points: 2, night: true, revenue: [30000, 60000] },
  stadium: { label: 'Match ou concert au stade', venues: ['stadium'], milestone: 5, euros: 120000, radius: 26, ref: 25000, sat: 2, points: 2, night: true, revenue: [80000, 160000], traffic: 0.3 },
  grand: { label: 'Grand événement régional', venues: ['stadium'], milestone: 6, euros: 3000000, flat: true, prepMonths: 12, radius: 999, ref: 80000, sat: 3, points: 0, revenue: [1500000, 1500000], traffic: 0.4 }
};
export const EVENT_KINDS = Object.keys(EVENT_TYPES);

export const VENUE_COOLDOWN = 4;
const LOCAL_CAP = 4;

const monthOf = (state) => Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const seedOf = (state) => state.meta?.seed ?? 2030;

export function defaultCivicEvents() {
  return { planned: null, history: [], local: [], legacy: null, nextId: 1 };
}

export function civicOf(state) {
  state.civicEvents ??= defaultCivicEvents();
  return state.civicEvents;
}

/** Coût d'un événement (euros) : plus cher dans une grande ville. */
export function eventCost(state, type) {
  const t = EVENT_TYPES[type];
  if (!t) return 0;
  return t.flat ? t.euros : Math.round((t.euros * (1 + milestoneOf(state).rank * 0.15)) / 100) * 100;
}

/** Mois (index) où l'événement aura lieu s'il est organisé maintenant (résolu à la clôture de ce mois). */
export function eventMonth(state, type) {
  const t = EVENT_TYPES[type];
  const m = monthOf(state);
  if (t.prepMonths) return m + t.prepMonths;
  if (t.month === undefined) return m + 1;
  // La clôture de juin a lieu quand l'index de mois vaut (juin + 1)
  let k = m + 1;
  while ((((k - 1) % 12) + 12) % 12 !== t.month) k++;
  return k;
}

/** Lieux de la ville qui peuvent accueillir un type d'événement. */
export function venuesFor(state, type) {
  const t = EVENT_TYPES[type];
  if (!t) return [];
  return [...state.buildings.values()].filter((b) => t.venues.includes(b.defId) && !b.ruins && !b.abandoned);
}

function residentsAround(state, x, y, r) {
  let n = 0;
  for (const b of state.buildings.values()) if (b.residents > 0 && Math.abs(b.x - x) <= r && Math.abs(b.y - y) <= r) n += b.residents;
  return n;
}

/** Bonus de satisfaction des événements en cours pour une case (lu par la population). */
export function localEventBonus(state, x, y) {
  const list = state.civicEvents?.local;
  if (!list?.length) return 0;
  let v = 0;
  for (const e of list) if (e.until > state.time.tick && Math.abs(x - e.x) <= e.r && Math.abs(y - e.y) <= e.r) v += e.sat;
  return clamp(v, -4, 6);
}

/** Facteur de popularité « Vie locale » : événements réussis des 6 derniers mois, décroissance linéaire. */
export function localLifeFactor(state) {
  const C = state.civicEvents;
  if (!C) return 0;
  const m = monthOf(state);
  let v = 0;
  for (const e of C.history) {
    const age = m - e.month;
    if (age < 0 || age >= 6 || !e.success) continue;
    v += (e.points ?? 0) * (1 - age / 6);
  }
  return clamp(v, -2, LOCAL_CAP);
}

/** Événements de l'année électorale (12 derniers mois avant le scrutin) : clientélisme à partir de trois. */
export function clientelismEdge(state) {
  const p = state.politics;
  const C = state.civicEvents;
  if (!p || !C || !p.campaign) return 0;
  const from = p.nextElection - 12;
  return C.history.filter((e) => e.month >= from && !e.cancelled).length >= 3 ? 0.5 : 0;
}

export class CivicEventSystem {
  /** @param {{economy:any, bus?:any, catalog?:any}} deps */
  constructor({ economy, bus, catalog }) {
    this.economy = economy;
    this.bus = bus;
    this.catalog = catalog;
  }

  #notify(state, level, message, extra = {}) {
    const entry = { tick: state.time.tick, level, message, kind: 'politics', panel: 'politics', ...extra };
    state.events.history.push(entry);
    if (state.events.history.length > 80) state.events.history.shift();
    this.bus?.emit('notify', entry);
  }

  /** Vérifie qu'un événement peut être organisé. @returns {{ok:boolean, reason?:string, cost?:number, month?:number}} */
  preview(state, { type, buildingId, cover = false }) {
    const t = EVENT_TYPES[type];
    if (!t) return { ok: false, reason: 'Événement inconnu' };
    const C = civicOf(state);
    const m = monthOf(state);
    if (milestoneOf(state).rank < t.milestone) return { ok: false, reason: `${t.label} : débloqué au statut « ${milestoneLabel(t.milestone)} »` };
    if (C.planned) return { ok: false, reason: `Un événement est déjà en préparation (${EVENT_TYPES[C.planned.type].label})` };
    const b = state.buildings.get(buildingId);
    if (!b || !t.venues.includes(b.defId)) return { ok: false, reason: 'Ce lieu ne peut pas accueillir cet événement' };
    const last = C.history.filter((e) => e.buildingId === buildingId).at(-1);
    if (last && m - last.month < VENUE_COOLDOWN) return { ok: false, reason: `Ce lieu a accueilli un événement il y a moins de ${VENUE_COOLDOWN} mois` };
    if (type === 'grand') {
      const has = (id) => [...state.buildings.values()].some((x) => x.defId === id && !x.ruins);
      if (!has('airport') && !has('train_station')) return { ok: false, reason: 'Il faut un aéroport ou une gare régionale' };
      if ((state.stats.satisfaction ?? 0) < 60) return { ok: false, reason: 'Il faut une satisfaction d\'au moins 60' };
    }
    const cost = toCents(eventCost(state, type) * (cover ? 1.3 : 1));
    if (!this.economy.canAfford(state, cost)) return { ok: false, reason: 'Budget insuffisant', cost };
    return { ok: true, cost, month: eventMonth(state, type) };
  }

  plan(state, cmd) {
    const pv = this.preview(state, cmd);
    if (!pv.ok) return pv;
    const t = EVENT_TYPES[cmd.type];
    const C = civicOf(state);
    this.economy.payOpex(state, { amount: pv.cost, category: 'events', label: `${t.label}${cmd.cover ? ' (repli couvert)' : ''}` });
    C.planned = { id: C.nextId++, type: cmd.type, buildingId: cmd.buildingId, cover: !!cmd.cover, month: pv.month, cost: pv.cost, since: monthOf(state) };
    return { ok: true, month: pv.month, cost: pv.cost };
  }

  /** Annule l'événement prévu : la moitié des frais est remboursée. */
  cancel(state) {
    const C = civicOf(state);
    if (!C.planned) return { ok: false, reason: 'Aucun événement prévu' };
    const refund = Math.round(C.planned.cost / 2);
    if (refund > 0) this.economy.post(state, { kind: 'opex', category: 'events', label: `Annulation : ${EVENT_TYPES[C.planned.type].label} (moitié remboursée)`, amount: refund });
    C.planned = null;
    return { ok: true, refund };
  }

  /** Déroulement de l'événement prévu pour ce mois (à la clôture), puis nettoyage des effets locaux. */
  monthly(state) {
    const C = civicOf(state);
    const t = state.time.tick;
    C.local = C.local.filter((e) => e.until > t);
    if (C.legacy && C.legacy.until <= monthOf(state)) C.legacy = null;
    const P = C.planned;
    if (!P || P.month !== monthOf(state)) return null;
    C.planned = null;
    return this.#run(state, P);
  }

  #run(state, P) {
    const C = civicOf(state);
    const T = EVENT_TYPES[P.type];
    const m = P.month;
    const t = state.time.tick;
    const seed = seedOf(state);
    const b = state.buildings.get(P.buildingId);
    const entry = { id: P.id, type: P.type, label: T.label, feminine: !!T.feminine, buildingId: P.buildingId, month: m, night: !!T.night, visitors: 0, success: false, cancelled: false, incident: false, points: 0 };
    const done = () => {
      C.history.push(entry);
      if (C.history.length > 40) C.history.shift();
      this.bus?.emit('civic:event', { event: { ...entry } });
      return entry;
    };
    if (!b || b.ruins) {
      entry.cancelled = true;
      this.#notify(state, 'warning', `${T.label} annulé${T.feminine ? 'e' : ''} : le lieu n'existe plus.`);
      return done();
    }
    // Météo du jour
    const wx = state.weather?.kind ?? 'clear';
    let weather = 1;
    if (wx === 'storm' && !P.cover) {
      entry.cancelled = true;
      const refund = Math.round(P.cost / 2);
      this.economy.post(state, { kind: 'opex', category: 'events', label: `${T.label} annulé${T.feminine ? 'e' : ''} (orage) : moitié des frais récupérée`, amount: refund });
      this.#notify(state, 'warning', `⛈ Orage : ${T.label.toLowerCase()} annulé${T.feminine ? 'e' : ''}, la moitié des frais est perdue.`);
      return done();
    }
    if (wx === 'rain' && !P.cover) weather = 0.6;
    if (wx === 'heat') weather = 0.85;
    // Fréquentation : habitants autour du lieu, transports en commun
    const g = state.grid;
    const i = g.idx(b.x, b.y);
    const around = T.radius >= 999 ? state.stats.population : residentsAround(state, b.x, b.y, T.radius);
    const transit = Math.max(g.transitBus?.[i] ?? 0, g.transitMetro?.[i] ?? 0, g.transitRail?.[i] ?? 0, g.transitTram?.[i] ?? 0);
    const attendance = clamp((around / T.ref) * (transit > 0.3 ? 1.2 : 1), 0.2, 1);
    // Rendements décroissants, année électorale, adjoint aux Solidarités
    const same = C.history.filter((e) => e.type === P.type && !e.cancelled && m - e.month < 12).length;
    const p = state.politics;
    const electoral = p?.enabled && !p.defeated && p.nextElection - m <= 12 ? 0.5 : 1;
    const deputy = (p?.council?.members ?? []).find((x) => x.delegation === 'social' && !(x.suspendedUntil > m));
    const dep = deputy ? 1 + 0.08 * (deputy.competence - 1) : 1;
    const social = p?.agenda ? efficiency(state, 'social') : 1;
    const E = attendance * weather * Math.pow(0.6, same) * electoral * dep * social;
    entry.visitors = Math.round(T.ref * attendance * weather);
    entry.attendance = Math.round(attendance * 100) / 100;
    // Sécurité : incident si la police est peu présente
    const police = Math.min(1, g.coverPolice?.[i] ?? 0);
    entry.incident = hash2(seed, m, 0xe7e7 + P.id) < 0.08 * (1 - police);
    if (P.type === 'grand') return done(this.#grand(state, entry, E));
    entry.success = !entry.incident;
    entry.points = entry.incident ? -1 : T.points * E;
    entry.effect = Math.round(E * 100) / 100;
    C.local.push({ x: b.x, y: b.y, r: T.radius, sat: entry.incident ? -2 : Math.round(T.sat * E * 10) / 10, until: t + SIM.DAYS_PER_MONTH });
    const effects = [];
    if (T.demandC && !entry.incident) effects.push({ key: 'demand.C', op: 'add', value: Math.round(T.demandC * E * 10) / 10 });
    if (T.traffic) effects.push({ key: 'tripGenerationMult', op: 'mul', value: T.traffic });
    if (effects.length) {
      state.events.active.push({ id: `civic-${P.id}`, label: T.label, until: t + (T.traffic ? 3 : SIM.DAYS_PER_MONTH), effects });
      state.dirty.modifiers = true;
    }
    if (T.revenue && !entry.incident) {
      const euros = Math.round(T.revenue[0] + (T.revenue[1] - T.revenue[0]) * attendance) * weather;
      entry.revenue = Math.round(euros);
      this.economy.post(state, { kind: 'revenue', category: 'events', label: `${T.label} : billetterie et tourisme`, amount: toCents(euros) });
    }
    this.#notify(state, entry.incident ? 'warning' : 'success', entry.incident
      ? `${T.label} : des incidents ont gâché la fête (police trop peu présente).`
      : `🎉 ${T.label} : ${entry.visitors.toLocaleString('fr-FR')} visiteurs${weather < 1 ? ' malgré la météo' : ''}${electoral < 1 ? ' (effet réduit en année électorale)' : ''}.`);
    return done();
  }

  #grand(state, entry, E) {
    const C = civicOf(state);
    const fail = (state.crises?.active ?? []).length > 0 || (state.stats.satisfaction ?? 0) < 50 || entry.incident;
    if (fail) {
      entry.success = false;
      if (state.politics) state.politics.approval = Math.max(0, state.politics.approval - 5);
      state.controversies?.affairs.push({ kind: 'grand', title: 'Fiasco du grand événement', tick: state.time.tick, month: entry.month });
      this.#notify(state, 'danger', '📰 Le grand événement tourne au fiasco : popularité −5 et une affaire pour la prochaine campagne.');
      return entry;
    }
    entry.success = true;
    entry.points = 0;
    entry.revenue = Math.round(1500000 * Math.max(0.5, E));
    this.economy.post(state, { kind: 'revenue', category: 'events', label: 'Grand événement : tourisme et billetterie', amount: toCents(entry.revenue) });
    C.legacy = { until: entry.month + 24, approval: 3 };
    state.events.active.push({ id: 'civic-legacy', label: 'Héritage du grand événement', until: state.time.tick + 24 * SIM.DAYS_PER_MONTH, effects: [{ key: 'demand.R', op: 'add', value: 5 }, { key: 'tripGenerationMult', op: 'mul', value: 0 }] });
    state.dirty.modifiers = true;
    this.#notify(state, 'success', `🏟 Le grand événement est un succès : ${entry.visitors.toLocaleString('fr-FR')} visiteurs, ${entry.revenue.toLocaleString('fr-FR')} € de recettes et un héritage durable.`);
    return entry;
  }
}
