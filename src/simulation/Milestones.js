import { dateOfTick } from './config.js';
import { toCents } from '../util/money.js';

/**
 * Statut de la ville (v1.0) : sept paliers de population. Chaque palier débloque des bâtiments, des fonctions,
 * un niveau maximal pour les bâtiments de zone et des délégations d'adjoints ; son premier passage rapporte
 * une dotation de l'État. Un palier est acquis sur la population maximale atteinte : il n'est jamais perdu.
 *
 * Équilibrage v1.0 (spécification § 2) : charges de structure qui croissent avec la taille de la ville,
 * entretien de la voirie, difficulté et budget de départ. Les anciennes parties gardent l'équilibrage
 * d'origine (« legacy ») tant que le joueur ne bascule pas ; la bascule est progressive sur 24 mois.
 */
export const MILESTONES = [
  { rank: 0, id: 'hamlet', name: 'Hameau', population: 0, grant: 0, maxZoneLevel: 2, delegations: 0 },
  { rank: 1, id: 'village', name: 'Village', population: 500, grant: 60000, maxZoneLevel: 2, delegations: 2 },
  { rank: 2, id: 'bourg', name: 'Bourg', population: 2000, grant: 150000, maxZoneLevel: 3, delegations: 3 },
  { rank: 3, id: 'town', name: 'Ville', population: 5000, grant: 300000, maxZoneLevel: 4, delegations: 4 },
  { rank: 4, id: 'city', name: 'Grande ville', population: 15000, grant: 700000, maxZoneLevel: 5, delegations: 5 },
  { rank: 5, id: 'metropolis', name: 'Métropole', population: 40000, grant: 1500000, maxZoneLevel: 5, delegations: 6 },
  { rank: 6, id: 'capital', name: 'Capitale régionale', population: 80000, grant: 3000000, maxZoneLevel: 5, delegations: 6 }
];

/** Fonctions débloquées par palier (en plus des bâtiments, routes et zones portant `unlock.milestone`). */
export const FEATURES = {
  busLines: { milestone: 2, label: 'Lignes de bus tracées' },
  tramLines: { milestone: 3, label: 'Lignes de tramway' },
  loanProfiles: { milestone: 2, label: 'Emprunts in fine et à amortissement constant' },
  districtTax: { milestone: 3, label: 'Fiscalité par quartier' },
  territory: { milestone: 4, label: 'Extensions de territoire' },
  fixedContracts: { milestone: 4, label: 'Contrats à prix fixe avec la région' }
};

/** Difficulté : trésorerie initiale, coefficient des dotations, capacité d'emprunt. */
export const DIFFICULTIES = {
  easy: { label: 'Facile', treasury: 550000, grantMult: 1.5, debtMult: 1 },
  normal: { label: 'Normal', treasury: 380000, grantMult: 1, debtMult: 1 },
  hard: { label: 'Difficile', treasury: 300000, grantMult: 0.5, debtMult: 0.7 }
};

/** Charges de structure : 9 €/hab. à partir de 40 000 habitants, rien sous 4 000 (courbe en puissance 0,6). */
export const STRUCTURE = { perResident: 9, from: 4000, full: 40000, exponent: 0.6 };
/** L'entretien de la voirie a été multiplié par 2,5 dans les données (v1.0) : facteur des anciennes parties. */
export const LEGACY_ROAD_UPKEEP = 0.4;
/** Durée de la bascule progressive d'une ancienne partie vers l'équilibrage v1.0. */
export const BALANCE_PHASE_MONTHS = 24;

/** Rang du palier atteint pour une population donnée. */
export function rankFor(population) {
  let r = 0;
  for (const m of MILESTONES) if ((population ?? 0) >= m.population) r = m.rank;
  return r;
}

/** Palier atteint par la ville (population maximale atteinte). */
export function milestoneOf(state) {
  return MILESTONES[rankFor(state.stats?.peakPopulation ?? 0)];
}

export function nextMilestone(state) {
  return MILESTONES[milestoneOf(state).rank + 1] ?? null;
}

export function milestoneLabel(rank) {
  const m = MILESTONES[rank];
  return m ? `${m.name}${m.population ? ` (${m.population.toLocaleString('fr-FR')} habitants)` : ''}` : '';
}

/** Une fonction est-elle débloquée ? Pendant la préparation d'un scénario ou d'un bourg, tout l'est. */
export function featureUnlocked(state, feature) {
  const f = FEATURES[feature];
  if (!f || state.meta?.preparing) return { ok: true };
  if (milestoneOf(state).rank >= f.milestone) return { ok: true };
  return { ok: false, reason: `${f.label} : débloqué au statut « ${milestoneLabel(f.milestone)} »` };
}

/** Niveau maximal des bâtiments de zone pour le statut actuel. */
export function maxZoneLevel(state) {
  return state.meta?.preparing ? 5 : milestoneOf(state).maxZoneLevel;
}

export function difficultyOf(state) {
  return DIFFICULTIES[state.options?.difficulty] ?? DIFFICULTIES.normal;
}

/** Applique la difficulté choisie à une nouvelle partie (trésorerie initiale). */
export function applyDifficulty(state, difficulty = 'normal') {
  const d = DIFFICULTIES[difficulty] ? difficulty : 'normal';
  state.options.difficulty = d;
  const cents = toCents(DIFFICULTIES[d].treasury);
  state.economy.treasury = cents;
  state.economy.opening = cents;
  if (state.economy.current) state.economy.current.cashStart = state.economy.current.cashEnd = cents;
}

/**
 * Part de l'équilibrage v1.0 appliquée (0 = ancien équilibrage, 1 = complet). Une ancienne partie qui bascule
 * monte d'1/24 par mois depuis le mois de la bascule.
 */
export function balancePhase(state) {
  const o = state.options ?? {};
  if (o.balance === 'legacy') return 0;
  if (o.balanceSince === undefined || o.balanceSince === null) return 1;
  const m = dateOfTick(state.time.tick).monthIndex;
  return Math.max(0, Math.min(1, (m - o.balanceSince) / BALANCE_PHASE_MONTHS));
}

/** Charges de structure mensuelles en euros (avant modificateurs et bascule). */
export function structureEuros(population) {
  const p = population ?? 0;
  const t = Math.max(0, Math.min(1, (p - STRUCTURE.from) / (STRUCTURE.full - STRUCTURE.from)));
  return t > 0 ? STRUCTURE.perResident * Math.pow(t, STRUCTURE.exponent) * p : 0;
}

/** Charges de structure du mois en centimes, modificateurs et bascule compris. */
export function structureCents(state) {
  const mult = Math.max(0.8, state.modifiers?.['upkeep.structure'] ?? 1);
  return Math.round(toCents(structureEuros(state.stats?.population ?? 0)) * mult * balancePhase(state));
}

/** Facteur appliqué à l'entretien de la voirie (données v1.0) : 0,4 pour une ancienne partie, puis bascule. */
export function roadUpkeepFactor(state) {
  const phase = balancePhase(state);
  return LEGACY_ROAD_UPKEEP + (1 - LEGACY_ROAD_UPKEEP) * phase;
}

/** Taux d'épargne brute d'une période résumée (épargne brute / recettes), ou null sans recettes. */
export function savingsRate(summary) {
  if (!summary || !(summary.revenues > 0)) return null;
  return summary.operatingResult / summary.revenues;
}

export function defaultMilestones() {
  return { granted: 0, announced: 0 };
}

/**
 * Passage des paliers : dotation de l'État (équilibrage v1.0 seulement) et annonce « Nouveau statut ».
 * Vérifié chaque jour (l'annonce arrive dès le seuil franchi) ; la dotation est versée une seule fois.
 */
export class MilestoneSystem {
  constructor({ economy, catalog, bus }) {
    this.economy = economy;
    this.catalog = catalog;
    this.bus = bus;
  }

  /** Ce que débloque un palier (noms des bâtiments, routes, zones et fonctions). */
  unlocksOf(rank) {
    const out = { buildings: [], roads: [], zones: [], features: [] };
    if (!this.catalog) return out;
    for (const d of this.catalog.buildings.values()) if (d.kind === 'plop' && d.unlock?.milestone === rank) out.buildings.push(d.name);
    for (const r of this.catalog.roads) if (r.unlock?.milestone === rank) out.roads.push(r.name);
    for (const z of this.catalog.zones) if (z.unlock?.milestone === rank) out.zones.push(z.name);
    for (const f of Object.values(FEATURES)) if (f.milestone === rank) out.features.push(f.label);
    return out;
  }

  daily(state) {
    state.milestones ??= defaultMilestones();
    const ms = state.milestones;
    const rank = milestoneOf(state).rank;
    if (rank <= ms.announced) return;
    // Préparation d'un scénario ou d'un bourg existant : l'équipe précédente a déjà reçu les dotations
    if (state.meta?.preparing) {
      ms.announced = ms.granted = rank;
      return;
    }
    const v1 = (state.options?.balance ?? 'v1') !== 'legacy';
    const mult = difficultyOf(state).grantMult;
    // Plusieurs paliers franchis le même jour : une seule annonce (le plus élevé), dotations cumulées
    const all = { buildings: [], roads: [], zones: [], features: [] };
    const ranks = [];
    let total = 0;
    for (let r = ms.announced + 1; r <= rank; r++) {
      const m = MILESTONES[r];
      let grant = 0;
      if (v1 && r > ms.granted && m.grant > 0) {
        grant = toCents(Math.round(m.grant * mult));
        this.economy.post(state, { kind: 'grant', category: 'grant', label: `Dotation de l'État : statut « ${m.name} »`, amount: grant });
        ms.granted = r;
      }
      const unlocks = this.unlocksOf(r);
      for (const k of Object.keys(all)) all[k].push(...unlocks[k]);
      ranks.push(r);
      total += grant;
      const entry = {
        tick: state.time.tick,
        level: 'success',
        kind: 'milestone',
        rank: r,
        message: `🏙 Nouveau statut : ${m.name} (${m.population.toLocaleString('fr-FR')} habitants).${grant ? ` Dotation de l'État : ${(grant / 100).toLocaleString('fr-FR')} €.` : ''}`,
        panel: 'city'
      };
      state.events.history.push(entry);
      if (state.events.history.length > 80) state.events.history.shift();
      this.bus?.emit('notify', entry);
    }
    this.bus?.emit('milestone:reached', { rank, ranks, grant: total, unlocks: all });
    ms.announced = rank;
    state.dirty.modifiers = true;
  }
}

