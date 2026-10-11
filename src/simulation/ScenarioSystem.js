import { SIM } from './config.js';
import { EconomySystem } from './EconomySystem.js';

/**
 * Scénarios et défis : une ville à redresser (ou à bâtir) avec des objectifs chiffrés et une échéance.
 *
 * L'état du scénario fait partie de la partie (`state.scenario`) : objectifs, échéance, règles d'échec,
 * compteurs. Il ne contient que des données ; les objectifs sont évalués ici à chaque fin de mois, à partir de
 * l'état de la ville uniquement (la vérification fonctionne de la même façon dans un Web Worker).
 */

const euros = (cents) => `${Math.round(cents / 100).toLocaleString('fr-FR')} €`;
const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')} %`;

/** Mesures disponibles pour les objectifs et les règles d'échec. */
export const METRICS = {
  population: { label: 'Habitants', read: (s) => s.stats.population, fmt: (v) => Math.round(v).toLocaleString('fr-FR') },
  satisfaction: { label: 'Satisfaction', read: (s) => s.stats.satisfaction, fmt: (v) => String(Math.round(v)) },
  cashFlow: {
    label: 'Variation de trésorerie du dernier mois',
    read: (s) => EconomySystem.summarize(s.economy.periods.at(-1))?.cashChange ?? 0,
    fmt: euros
  },
  treasury: { label: 'Trésorerie', read: (s) => s.economy.treasury, fmt: euros },
  debt: { label: 'Dette', read: (s) => s.economy.loans.reduce((a, l) => a + l.remaining, 0), fmt: euros },
  netResult: {
    label: 'Résultat du dernier mois',
    read: (s) => EconomySystem.summarize(s.economy.periods.at(-1))?.netResult ?? 0,
    fmt: euros
  },
  pollution: { label: 'Pollution moyenne', read: (s) => s.stats.avgPollution ?? 0, fmt: (v) => v.toFixed(1).replace('.', ',') },
  unemployment: { label: 'Chômage', read: (s) => s.stats.unemploymentRate ?? 0, fmt: pct },
  congestion: { label: 'Congestion moyenne', read: (s) => s.traffic.stats?.avgCongestion ?? 0, fmt: pct },
  congested: { label: 'Tronçons saturés', read: (s) => s.traffic.stats?.congestedTiles ?? 0, fmt: (v) => String(Math.round(v)) },
  commute: { label: 'Temps de trajet moyen', read: (s) => s.traffic.stats?.avgCommute ?? 0, fmt: (v) => `${v.toFixed(1).replace('.', ',')} min` },
  transit: { label: 'Voyageurs des transports en commun / jour', read: (s) => s.transit.passengersPerDay ?? 0, fmt: (v) => Math.round(v).toLocaleString('fr-FR') },
  abandoned: { label: 'Bâtiments abandonnés', read: (s) => s.stats.abandoned ?? 0, fmt: (v) => String(Math.round(v)) },
  era: { label: 'Ère', read: (s) => s.progression?.era ?? 1, fmt: (v) => String(v) },
  collection: { label: 'Collecte des déchets', read: (s) => s.waste.stats?.collectionRate ?? 0, fmt: pct },
  policy: { label: 'Politique adoptée', read: (s, g) => (s.policies.active[g.policy] !== undefined ? 1 : 0), fmt: (v) => (v ? 'oui' : 'non') },
  techs: { label: 'Technologies déployées', read: (s) => Object.keys(s.tech.researched).length, fmt: (v) => String(v) }
};

/**
 * Évalue un objectif ou une règle.
 * @param {any} state
 * @param {{metric:string, op:'>='|'<='|'<'|'>', target:number, policy?:string}} g
 */
export function evaluateGoal(state, g) {
  const m = METRICS[g.metric];
  if (!m) return { ok: false, value: 0, text: '?' };
  const value = m.read(state, g);
  const ok = g.op === '<=' ? value <= g.target : g.op === '<' ? value < g.target : g.op === '>' ? value > g.target : value >= g.target;
  return { ok, value, text: m.fmt(value), targetText: g.metric === 'policy' ? 'oui' : m.fmt(g.target) };
}

/** Temps restant avant l'échéance, en mois entiers. */
export function monthsLeft(state) {
  const sc = state.scenario;
  if (!sc) return 0;
  return Math.max(0, Math.ceil((sc.deadlineTick - state.time.tick) / SIM.DAYS_PER_MONTH));
}

export function formatMonths(n) {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y ? `${y} an${y > 1 ? 's' : ''}` : '', m ? `${m} mois` : ''].filter(Boolean).join(' ') || 'moins d\'un mois';
}

export class ScenarioSystem {
  constructor({ bus } = {}) {
    this.bus = bus;
  }

  /** Avancement courant (affichage). */
  progress(state) {
    const sc = state.scenario;
    if (!sc) return null;
    const goals = sc.goals.map((g) => ({ ...g, ...evaluateGoal(state, g) }));
    const fails = (sc.failRules ?? []).map((r) => ({ ...r, ...evaluateGoal(state, r), streak: sc.failStreak?.[r.id] ?? 0 }));
    return { goals, fails, done: goals.filter((g) => g.ok).length, total: goals.length, monthsLeft: monthsLeft(state) };
  }

  /** Vérification mensuelle : victoire, échec par règle, échéance dépassée. */
  monthly(state) {
    const sc = state.scenario;
    if (!sc || sc.status !== 'active') return;
    const p = this.progress(state);
    sc.lastCheck = { tick: state.time.tick, done: p.done, total: p.total };
    sc.failStreak ??= {};
    for (const r of p.fails) {
      // Une règle d'échec est « violée » quand sa condition est remplie (ex. trésorerie < −250 000 €)
      sc.failStreak[r.id] = r.ok ? (sc.failStreak[r.id] ?? 0) + 1 : 0;
      if (sc.failStreak[r.id] >= (r.months ?? 1)) return this.#end(state, 'lost', r.label);
    }
    if (p.done === p.total) return this.#end(state, 'won', 'Tous les objectifs sont atteints');
    if (state.time.tick >= sc.deadlineTick) return this.#end(state, 'lost', 'Échéance dépassée');
    // Rappel à un an puis à trois mois de l'échéance
    const left = p.monthsLeft;
    if (left === 12 || left === 3) {
      this.bus?.emit('notify', { level: 'warning', message: `Scénario « ${sc.name} » : plus que ${formatMonths(left)} — ${p.done} / ${p.total} objectifs atteints`, key: `scenario-${left}` });
    }
  }

  #end(state, status, reason) {
    const sc = state.scenario;
    sc.status = status;
    sc.endedTick = state.time.tick;
    sc.reason = reason;
    const months = Math.round((state.time.tick - sc.startTick) / SIM.DAYS_PER_MONTH);
    sc.result = { months, population: state.stats.population, treasury: state.economy.treasury, satisfaction: Math.round(state.stats.satisfaction) };
    this.bus?.emit('notify', {
      level: status === 'won' ? 'success' : 'danger',
      message: status === 'won' ? `Scénario réussi : ${sc.name} (en ${formatMonths(months)})` : `Scénario échoué : ${sc.name} — ${reason}`
    });
    this.bus?.emit('scenario:ended', { scenario: structuredClone(sc) });
  }
}
