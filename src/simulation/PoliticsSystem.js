import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';
import { effectiveTaxes, districtName, centreKey } from './Districts.js';
import { PARCEL } from '../world/Land.js';
import { factorWeight, THEME_AXIS, shareOf, defaultAgenda, defaultCouncil } from './CouncilSystem.js';

/**
 * Vie politique (v0.7) : popularité du maire, sondages, campagne, programme chiffré, élections municipales.
 *
 * - La popularité (0–100) suit chaque mois une cible calculée à partir de facteurs lisibles : satisfaction des
 *   habitants, emploi, fiscalité (niveau et hausses récentes), finances (note de crédit), services publics,
 *   cadre de vie, logement, gestion des crises, promesses tenues ou rompues, dynamique de la ville, réalisations,
 *   revirements, politiques publiques, lune de miel et usure du pouvoir. Elle a de l'inertie (30 % par mois).
 * - Mandat de 6 ans. Six mois avant le scrutin, la campagne s'ouvre : le maire choisit jusqu'à 3 engagements
 *   chiffrés (modestes ou ambitieux) et un thème de campagne. L'ambition rapporte des voix, pondérées par la
 *   crédibilité (promesses tenues lors des mandats précédents) ; une fois élu, les engagements sont suivis et
 *   leur respect pèse sur la popularité puis sur l'élection suivante.
 * - Le score au scrutin découle de la popularité, du programme, du thème, de la liste adverse (qui attaque les
 *   points faibles de la ville) et d'un aléa de campagne borné (±2,5 points). Résultats détaillés par quartier.
 * - Popularité durablement effondrée : crise de majorité et élections anticipées.
 * - Tous les tirages sont des hachages déterministes (graine, mois) : rechargement et simulation déportée
 *   donnent exactement les mêmes résultats.
 */

export const TERM_MONTHS = 72;
export const CAMPAIGN_MONTHS = 6;
/** Anciennes parties (avant v0.7) : premier scrutin dans 3 ans. */
export const LEGACY_FIRST_ELECTION_MONTHS = 36;
export const MAX_PROMISES = 3;
const INERTIA = 0.3;
const EARLY_ELECTION_THRESHOLD = 18;
const EARLY_ELECTION_MONTHS = 9;

const monthOf = (state) => Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round1 = (v) => Math.round(v * 10) / 10;
const pct1 = (v) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const num1 = (v) => String(round1(v)).replace('.', ',');

export const RIVALS = [
  ['Claire Dumont', 'Ensemble pour {city}'],
  ['Marc Lefèvre', '{city} Demain'],
  ['Sophie Garnier', 'Le Renouveau citoyen'],
  ['Karim Benali', 'Agir pour {city}'],
  ['Élodie Moreau', 'Écologie et solidarité'],
  ['Julien Rousseau', 'Cap 2040'],
  ['Nadia Chevalier', 'Un nouveau souffle'],
  ['Thomas Girard', 'Fiers de {city}']
];


/** Thèmes de campagne et d'engagements, avec le facteur de popularité qu'ils mettent en avant. */
export const THEMES = {
  jobs: { label: 'Emploi', factor: 'jobs' },
  taxes: { label: 'Fiscalité', factor: 'taxes' },
  services: { label: 'Services publics', factor: 'services' },
  safety: { label: 'Sécurité', factor: 'services' },
  environment: { label: 'Environnement et cadre de vie', factor: 'living' },
  mobility: { label: 'Transports', factor: 'living' },
  finances: { label: 'Finances saines', factor: 'finances' },
  growth: { label: 'Développement de la ville', factor: 'growth' },
  housing: { label: 'Logement et qualité de vie', factor: 'satisfaction' }
};

export function defaultPolitics(state, { enabled = true, firstElectionMonths = TERM_MONTHS } = {}) {
  const m = monthOf(state);
  return {
    enabled,
    approval: 58,
    target: 58,
    factors: [],
    termStart: m,
    nextElection: m + firstElectionMonths,
    mandate: 1,
    promises: [],
    record: { kept: 0, broken: 0 },
    elections: [],
    history: [],
    polls: [],
    campaign: null,
    lowMonths: 0,
    early: false,
    defeated: false,
    rival: rivalFor(state, 0),
    memory: { taxes: [], flipflops: [], ignored: [] },
    // v1.1 : conseil municipal et priorités du mandat
    council: defaultCouncil(),
    agenda: defaultAgenda()
  };
}

function rivalFor(state, k) {
  const seed = state.meta?.seed ?? 2030;
  const [leader, list] = RIVALS[Math.floor(hash2(seed, k, 0x7017) * RIVALS.length) % RIVALS.length];
  const name = state.meta?.name ?? '';
  const short = name && name.length <= 22 && !/[:]/.test(name);
  const generic = { 'Ensemble pour {city}': 'Ensemble pour notre ville', '{city} Demain': 'Demain, notre ville', 'Agir pour {city}': 'Agir pour notre ville', 'Fiers de {city}': 'Fiers de notre ville' };
  return { leader, list: short ? list.replace('{city}', name) : (generic[list] ?? list) };
}

/** Couverture moyenne d'un service pour les habitants (0..1). */
export function residentCoverage(state, layer) {
  const g = state.grid;
  let sum = 0;
  let n = 0;
  for (const b of state.buildings.values()) {
    if (!(b.residents > 0)) continue;
    sum += Math.min(1, g[layer][g.idx(b.x, b.y)]) * b.residents;
    n += b.residents;
  }
  return n ? sum / n : 0;
}

const GRADE_POINTS = { AAA: 3, AA: 2, A: 1, BBB: 0, BB: -2, B: -4, CCC: -7, D: -10 };
const GRADE_ORDER = ['D', 'CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'];

/**
 * Indicateurs suivis par les engagements de campagne : lecture d'une valeur et mise en forme.
 * `better` : sens de l'amélioration.
 */
export const METRICS = {
  unemployment: { label: 'Taux de chômage', better: -1, read: (s) => s.stats.unemploymentRate ?? 0, fmt: (v) => `${(v * 100).toFixed(1).replace('.', ',')} %` },
  population: { label: 'Population', better: 1, read: (s) => s.stats.population ?? 0, fmt: (v) => `${Math.round(v).toLocaleString('fr-FR')} hab.` },
  taxR: { label: 'Taxe d\'habitation', better: -1, read: (s) => s.economy.taxes.R, fmt: (v) => `${String(round1(v)).replace('.', ',')} %` },
  education: { label: 'Couverture éducative', better: 1, read: (s) => residentCoverage(s, 'coverEducation'), fmt: (v) => `${Math.round(v * 100)} %` },
  health: { label: 'Couverture santé', better: 1, read: (s) => residentCoverage(s, 'coverHealth'), fmt: (v) => `${Math.round(v * 100)} %` },
  safety: { label: 'Couverture police', better: 1, read: (s) => residentCoverage(s, 'coverPolice'), fmt: (v) => `${Math.round(v * 100)} %` },
  pollution: { label: 'Pollution moyenne', better: -1, read: (s) => s.stats.avgPollution ?? 0, fmt: (v) => round1(v).toString().replace('.', ',') },
  transit: { label: 'Voyageurs des transports en commun', better: 1, read: (s) => s.transit?.passengersPerDay ?? 0, fmt: (v) => `${Math.round(v).toLocaleString('fr-FR')} /jour` },
  congestion: { label: 'Congestion moyenne', better: -1, read: (s) => s.traffic?.stats?.avgCongestion ?? 0, fmt: (v) => `${Math.round(v * 100)} %` },
  satisfaction: { label: 'Satisfaction des habitants', better: 1, read: (s) => s.stats.satisfaction ?? 50, fmt: (v) => `${Math.round(v)} / 100` },
  vacancy: {
    label: 'Emplois non pourvus',
    better: -1,
    read: (s) => (s.stats.jobs > 0 ? Math.max(0, s.stats.jobs - s.stats.jobsFilled) / s.stats.jobs : 0),
    fmt: (v) => `${Math.round(v * 100)} %`
  },
  rating: { label: 'Note financière', better: 1, read: null, fmt: (v) => GRADE_ORDER[Math.round(v)] ?? '—' }
};

export class PoliticsSystem {
  /** @param {{catalog:any, economy:any, bus?:any}} deps */
  constructor({ catalog, economy, bus }) {
    this.catalog = catalog;
    this.economy = economy;
    this.bus = bus;
  }

  #notify(state, level, message, extra = {}) {
    const entry = { tick: state.time.tick, level, message, kind: 'politics', ...extra };
    state.events.history.push(entry);
    if (state.events.history.length > 80) state.events.history.shift();
    this.bus?.emit('notify', entry);
  }

  /** Crée l'état politique si absent (nouvelle partie : premier scrutin dans 6 ans ; ancienne partie : 3 ans). */
  ensure(state) {
    if (state.politics) return state.politics;
    const opt = state.options?.elections;
    const enabled = opt ? opt === 'on' : true;
    state.politics = defaultPolitics(state, { enabled, firstElectionMonths: state.time.tick > 0 ? LEGACY_FIRST_ELECTION_MONTHS : TERM_MONTHS });
    return state.politics;
  }

  /** Valeur d'un indicateur d'engagement. */
  read(state, metric) {
    if (metric === 'rating') return GRADE_ORDER.indexOf(this.economy.creditRating(state).grade);
    return METRICS[metric].read(state);
  }

  // ───────────────────────────── Popularité ─────────────────────────────

  /**
   * Facteurs de popularité (points autour de 50).
   * @returns {{id:string, label:string, value:number, detail:string}[]}
   */
  factors(state) {
    const p = this.ensure(state);
    const s = state.stats;
    // Taux moyens effectivement payés (v0.8 : fiscalité par quartier)
    const t = effectiveTaxes(state);
    const m = monthOf(state);
    const out = [];
    const add = (id, label, value, detail) => out.push({ id, label, value: round1(value), detail });
    if (!(s.population > 0) && !((s.peakPopulation ?? 0) > 0)) {
      add('base', 'Ville naissante', 8, 'Les premiers habitants font crédit au maire');
      return out;
    }
    const sat = s.satisfaction ?? 50;
    add('satisfaction', 'Satisfaction des habitants', clamp((sat - 55) * 0.5, -20, 15), `${Math.round(sat)} / 100`);
    const u = s.unemploymentRate ?? 0;
    // Chômage, et entreprises privées de main-d'œuvre quand trop de postes restent vacants
    const vac = METRICS.vacancy.read(state);
    const lack = vac > 0.15 ? Math.min(4, (vac - 0.15) * 15) : 0;
    add('jobs', 'Emploi', clamp(u < 0.04 ? 4 : 4 - (u - 0.04) * 100, -18, 4) - lack, `chômage ${pct1(u)}${lack ? `, ${Math.round(vac * 100)} % de postes vacants` : ''}`);
    const avgTax = t.R * 0.5 + ((t.C + t.O + t.I) / 3) * 0.5;
    const hist = p.memory.taxes;
    const ref = hist.length ? hist[0] : t;
    const hike = Math.max(0, t.R - ref.R) + 0.4 * (Math.max(0, t.C - ref.C) + Math.max(0, t.O - ref.O) + Math.max(0, t.I - ref.I));
    add('taxes', 'Fiscalité', clamp(-(avgTax - 9) * 1.6, -14, 5) - Math.min(10, hike * 1.2), hike > 0.05 ? `taux moyen ${num1(avgTax)} %, hausse de ${num1(hike)} pt sur un an` : `taux moyen ${num1(avgTax)} %`);
    const rating = this.economy.creditRating(state);
    add('finances', 'Finances municipales', (GRADE_POINTS[rating.grade] ?? 0) + (state.economy.treasury < 0 ? -3 : 0), `note ${rating.grade}${state.economy.treasury < 0 ? ', trésorerie négative' : ''}`);
    const cov = (residentCoverage(state, 'coverEducation') + residentCoverage(state, 'coverHealth') + residentCoverage(state, 'coverPolice') + residentCoverage(state, 'coverFire')) / 4;
    add('services', 'Services publics', clamp((cov - 0.55) * 22, -12, 10), `couverture moyenne ${Math.round(cov * 100)} %`);
    const cong = state.traffic?.stats?.avgCongestion ?? 0;
    const pol = s.avgPollution ?? 0;
    add('living', 'Cadre de vie (trafic, pollution)', clamp(2 - cong * 10 - Math.max(0, pol - 5) * 0.5, -12, 2), `congestion ${Math.round(cong * 100)} %, pollution ${num1(pol)}`);
    const dR = state.demand?.R ?? 0;
    const shortage = dR > 50 && (s.housingVacancy ?? 1) < 0.04;
    add('housing', 'Logement', shortage ? -Math.min(5, (dR - 50) * 0.1 + 1) : 0, shortage ? 'pénurie de logements' : 'offre suffisante');
    // Crises : en cours (sans réponse : pénalité), réponses récentes saluées, crises ignorées
    let crisis = 0;
    const active = state.crises?.active ?? [];
    for (const c of active) crisis += c.response ? -1 : -3;
    const recent = (state.crises?.history ?? []).filter((c) => state.time.tick - c.end < 180);
    let handled = 0;
    for (const c of recent) {
      if (c.response && !['wait', 'none', 'hold', 'shed', 'ransom', 'ignore', 'barrier'].includes(c.response)) handled++;
    }
    crisis += Math.min(4, handled * 1.5);
    crisis -= p.memory.ignored.filter((tk) => state.time.tick - tk < 180).length * 2;
    add('crises', 'Gestion des crises', clamp(crisis, -12, 4), active.length ? `${active.length} crise(s) en cours` : handled ? `${handled} crise(s) bien gérée(s) récemment` : 'calme');
    const kept = p.promises.filter((x) => x.status === 'kept').length;
    const broken = p.promises.filter((x) => x.status === 'broken').length;
    add('promises', 'Promesses du mandat', kept * 2.5 - broken * 4, p.promises.length ? `${kept} tenue(s), ${broken} rompue(s), ${p.promises.length - kept - broken} en cours` : 'aucun engagement');
    const past = state.history.at(-13)?.population ?? state.history[0]?.population ?? s.population;
    const growth = past > 50 ? s.population / past - 1 : 0;
    add('growth', 'Dynamique de la ville', clamp(growth * 20, -4, 4), `${growth >= 0 ? '+' : ''}${Math.round(growth * 100)} % d'habitants sur un an`);
    add('achievements', 'Réalisations récentes', this.#achievements(state), 'équipements inaugurés depuis un an');
    const flips = p.memory.flipflops.filter((tk) => state.time.tick - tk < 360).length;
    if (flips) add('flipflops', 'Revirements', -Math.min(6, flips * 1.5), `${flips} politique(s) abrogée(s) peu après leur adoption`);
    const polAdd = state.modifiers?.['approval.add'] ?? 0;
    if (polAdd) add('policies', 'Politiques publiques', polAdd, 'effets des politiques adoptées');
    const since = m - p.termStart;
    if (since < 12) add('honeymoon', 'Début de mandat', 5 * (1 - since / 12), 'état de grâce');
    if (p.mandate > 1) add('wear', 'Usure du pouvoir', -Math.min(6, 1.5 * (p.mandate - 1)), `${p.mandate}e mandat`);
    // v1.1 : équipe municipale (notoriété des adjoints, délégations vacantes, démissions)
    const team = this.council?.teamFactor(state);
    if (team) add('team', 'Équipe municipale', clamp(team.value, -8, 4), team.detail);
    // v1.1 : priorités changeantes (plus de 30 points déplacés sur 12 mois)
    if (p.agenda && this.council && this.council.movedLastYear(state) > 30) add('agenda', 'Priorités changeantes', -1, `${Math.round(this.council.movedLastYear(state))} points déplacés sur un an`);
    // v1.1 : les priorités du mandat pèsent sur le jugement des électeurs (1/6 par axe = poids neutre)
    if (p.agenda) {
      for (const f of out) {
        const w = factorWeight(state, f.id);
        if (Math.abs(w - 1) > 1e-9) {
          f.value = round1(f.value * w);
          f.weight = round1(w * 100) / 100;
        }
      }
    }
    return out;
  }

  /** Inaugurations : équipements publics posés depuis un an, pondérés par leur coût, effet décroissant. */
  #achievements(state) {
    let v = 0;
    const t = state.time.tick;
    for (const b of state.buildings.values()) {
      if (b.origin !== 'player') continue;
      const age = t - b.builtTick;
      if (age < 0 || age > 360) continue;
      const def = this.catalog.building(b.defId);
      if (def.kind !== 'plop' || !['parks', 'services', 'transport'].includes(def.category)) continue;
      v += Math.min(1.5, (def.cost ?? 0) / 400_000) * (1 - age / 360);
    }
    return clamp(v, 0, 5);
  }

  /** Popularité cible (0..100) et facteurs. */
  target(state) {
    const factors = this.factors(state);
    const total = factors.reduce((a, f) => a + f.value, 0);
    return { target: clamp(50 + total, 3, 97), factors };
  }

  // ───────────────────────────── Mois ─────────────────────────────

  monthly(state) {
    const p = this.ensure(state);
    const m = monthOf(state);
    if (p.announce) {
      delete p.announce;
      this.#notify(state, 'info', `🏛 Nouveauté : la vie politique arrive à ${state.meta.name}. Prochaines élections municipales dans ${Math.max(1, Math.round((p.nextElection - m) / 12))} ans — surveillez votre popularité (Mairie, touche E).`, { panel: 'politics' });
    }
    // Mémoire des taux d'imposition sur 12 mois (hausses récentes)
    p.memory.taxes.push({ ...effectiveTaxes(state) });
    if (p.memory.taxes.length > 12) p.memory.taxes.shift();
    // Crises restées sans réponse
    for (const c of state.crises?.history ?? []) {
      if (!c.response && c.end >= state.time.tick - SIM.DAYS_PER_MONTH && c.end < state.time.tick && !p.memory.ignored.includes(c.end)) p.memory.ignored.push(c.end);
    }
    p.memory.ignored = p.memory.ignored.filter((tk) => state.time.tick - tk < 360);
    p.memory.flipflops = p.memory.flipflops.filter((tk) => state.time.tick - tk < 360);

    if (p.enabled && !p.defeated) this.#trackPromises(state, false);
    const { target, factors } = this.target(state);
    p.target = round1(target);
    p.factors = factors;
    p.approval = round1(p.approval + (target - p.approval) * INERTIA);
    p.history.push({ m, approval: p.approval });
    if (p.history.length > 120) p.history.shift();
    if (!p.enabled || p.defeated) return;

    // Sondage mensuel : popularité mesurée avec une marge d'erreur
    const poll = clamp(p.approval + (hash2(state.meta.seed ?? 2030, m, 0x9011) - 0.5) * 6, 0, 100);
    const entry = { m, approval: round1(poll) };
    if (p.campaign) entry.vote = round1(this.projectedShare(state, { noise: false }) + (hash2(state.meta.seed ?? 2030, m, 0x9012) - 0.5) * 5);
    p.polls.push(entry);
    if (p.polls.length > 24) p.polls.shift();

    // Crise de majorité : popularité effondrée durablement → élections anticipées
    p.lowMonths = p.approval < EARLY_ELECTION_THRESHOLD ? p.lowMonths + 1 : 0;
    if (p.lowMonths >= EARLY_ELECTION_MONTHS && !p.campaign && p.nextElection - m > CAMPAIGN_MONTHS + 6) {
      p.nextElection = m + CAMPAIGN_MONTHS;
      p.early = true;
      p.lowMonths = 0;
      this.#notify(state, 'danger', `🏛 Crise de majorité : une partie du conseil municipal démissionne. Élections anticipées dans ${CAMPAIGN_MONTHS} mois.`);
    }
    // Ouverture de la campagne
    if (!p.campaign && p.nextElection - m <= CAMPAIGN_MONTHS) this.#openCampaign(state);
    // v1.1 : en campagne, un adjoint ambitieux et peu loyal peut monter une liste dissidente
    if (p.campaign && !p.campaign.dissident && this.council) {
      const d = this.council.dissident(state);
      if (d) {
        p.campaign.dissident = d;
        this.#notify(state, 'danger', `🗳 ${d.name} quitte la majorité et monte une liste dissidente : environ ${d.points} points de voix en moins pour votre liste.`, { panel: 'politics' });
      }
    }
    // Scrutin
    if (m >= p.nextElection) this.#election(state);
    else if (p.campaign && p.nextElection - m === 1) {
      this.#notify(state, 'warning', `🗳 Élections municipales le mois prochain. Dernier sondage : ${Math.round(entry.vote ?? poll)} % d'intentions de vote pour votre liste.`);
    }
  }

  // ───────────────────────────── Engagements ─────────────────────────────

  /** Offres d'engagements selon la situation de la ville (deux niveaux d'ambition par thème). */
  offers(state) {
    const s = state.stats;
    const out = [];
    const push = (theme, metric, kind, modest, ambitious, labels) => {
      for (const [level, target, points] of [['modest', modest, 1], ['ambitious', ambitious, 2.2]]) {
        if (target === null || (level === 'ambitious' && Math.abs(target - modest) < 1e-9)) continue;
        out.push({ id: `${metric}-${level}`, theme, metric, kind, level, target, points, label: labels[level](METRICS[metric].fmt(target)) });
      }
    };
    const u = s.unemploymentRate ?? 0;
    if (u > 0.05) push('jobs', 'unemployment', 'reach', Math.max(0.04, u - 0.02), Math.max(0.035, u - 0.05), { modest: (v) => `Ramener le chômage sous ${v}`, ambitious: (v) => `Ramener le chômage sous ${v} (plein emploi)` });
    else push('jobs', 'unemployment', 'keep', 0.06, 0.045, { modest: (v) => `Garder le chômage sous ${v} pendant tout le mandat`, ambitious: (v) => `Garder le chômage sous ${v} pendant tout le mandat` });
    const vac = METRICS.vacancy.read(state);
    if (vac > 0.08) push('jobs', 'vacancy', 'reach', Math.round(vac * 60) / 100, 0.04, { modest: (v) => `Réduire les emplois non pourvus à ${v}`, ambitious: (v) => `Pourvoir les emplois vacants (moins de ${v})` });
    const pop = s.population ?? 0;
    const round = (v) => Math.round(v / 100) * 100;
    push('growth', 'population', 'reach', round(Math.max(pop * 1.25, pop + 800)), round(Math.max(pop * 1.6, pop + 2500)), { modest: (v) => `Atteindre ${v}`, ambitious: (v) => `Faire grandir la ville jusqu'à ${v}` });
    const R = state.economy.taxes.R;
    push('taxes', 'taxR', 'keep', R, null, { modest: () => `Ne pas augmenter la taxe d'habitation (${String(R).replace('.', ',')} %) de tout le mandat` });
    if (R >= 4) out.push({ id: 'taxR-ambitious', theme: 'taxes', metric: 'taxR', kind: 'deadline', level: 'ambitious', target: round1(R - 2), points: 2.2, label: `Baisser la taxe d'habitation à ${String(round1(R - 2)).replace('.', ',')} % d'ici la fin du mandat` });
    const cov = (k) => this.read(state, k);
    for (const [metric, theme, name] of [['education', 'services', 'écoles'], ['health', 'services', 'santé'], ['safety', 'safety', 'police']]) {
      const c = cov(metric);
      if (c >= 0.92) continue;
      push(theme, metric, 'reach', Math.min(0.95, Math.round((c + 0.12) * 100) / 100), Math.min(0.98, Math.round((c + 0.25) * 100) / 100), {
        modest: (v) => `Couverture ${name} : ${v} des habitants`,
        ambitious: (v) => `Couverture ${name} : ${v} des habitants`
      });
    }
    const pol = s.avgPollution ?? 0;
    if (pol > 3) push('environment', 'pollution', 'reach', round1(pol * 0.8), round1(pol * 0.6), { modest: (v) => `Réduire la pollution moyenne à ${v} (−20 %)`, ambitious: (v) => `Réduire la pollution moyenne à ${v} (−40 %)` });
    const pax = state.transit?.passengersPerDay ?? 0;
    if (pop > 1500) push('mobility', 'transit', 'reach', Math.round(Math.max(400, pax * 1.5) / 50) * 50, Math.round(Math.max(1200, pax * 2.5) / 50) * 50, { modest: (v) => `Transports en commun : ${v}`, ambitious: (v) => `Transports en commun : ${v}` });
    const cong = state.traffic?.stats?.avgCongestion ?? 0;
    if (cong > 0.25) push('mobility', 'congestion', 'reach', Math.round(cong * 80) / 100, Math.round(cong * 60) / 100, { modest: (v) => `Ramener la congestion à ${v}`, ambitious: (v) => `Ramener la congestion à ${v}` });
    const g = GRADE_ORDER.indexOf(this.economy.creditRating(state).grade);
    push('finances', 'rating', 'deadline', Math.max(g, GRADE_ORDER.indexOf('BBB')), Math.min(7, Math.max(g + 1, GRADE_ORDER.indexOf('A'))), { modest: (v) => `Finances saines : note ${v} ou mieux en fin de mandat`, ambitious: (v) => `Note financière ${v} ou mieux en fin de mandat` });
    const sat = s.satisfaction ?? 50;
    push('housing', 'satisfaction', 'reach', Math.min(85, Math.round(sat + 5)), Math.min(90, Math.round(sat + 10)), { modest: (v) => `Satisfaction des habitants : ${v}`, ambitious: (v) => `Satisfaction des habitants : ${v}` });
    for (const o of out) o.baseline = this.read(state, o.metric);
    return out;
  }

  /** Atteinte d'un engagement : 'reached' | 'violated' | 'pending' et progression 0..1. */
  progress(state, pr) {
    const v = this.read(state, pr.metric);
    const better = METRICS[pr.metric].better;
    const ok = better > 0 ? v >= pr.target - 1e-9 : v <= pr.target + 1e-9;
    const span = pr.target - pr.baseline;
    const frac = Math.abs(span) < 1e-9 ? (ok ? 1 : 0) : clamp((v - pr.baseline) / span, 0, 1);
    return { value: v, ok, frac: ok ? 1 : frac };
  }

  #trackPromises(state, atDeadline) {
    const p = state.politics;
    for (const pr of p.promises) {
      if (pr.status !== 'pending') continue;
      const { ok, value } = this.progress(state, pr);
      pr.last = value;
      if (pr.kind === 'reach' && ok) this.#settle(state, pr, 'kept');
      else if (pr.kind === 'keep' && !ok) this.#settle(state, pr, 'broken');
      else if (atDeadline) this.#settle(state, pr, (pr.kind === 'keep' || pr.kind === 'deadline') && ok ? 'kept' : 'broken');
    }
  }

  #settle(state, pr, status) {
    const p = state.politics;
    pr.status = status;
    pr.settledMonth = monthOf(state);
    if (status === 'kept') this.council?.onPromiseKept(state, pr.theme);
    p.record[status]++;
    this.#notify(state, status === 'kept' ? 'success' : 'warning', status === 'kept' ? `🏛 Promesse tenue : « ${pr.label} ». La population vous en sait gré.` : `🏛 Promesse rompue : « ${pr.label} ». Votre crédibilité en pâtit.`);
  }

  /** Crédibilité du maire (0,3..1) selon les promesses tenues et rompues. */
  credibility(state) {
    const r = state.politics?.record ?? { kept: 0, broken: 0 };
    if (r.kept + r.broken === 0) return 0.8;
    return clamp((r.kept + 0.6) / (r.kept + r.broken + 0.75), 0.3, 1);
  }

  // ───────────────────────────── Campagne ─────────────────────────────

  #openCampaign(state) {
    const p = state.politics;
    const k = p.elections.length + 1;
    p.rival = rivalFor(state, k);
    const weak = [...(p.factors ?? [])].filter((f) => f.value < -2).sort((a, b) => a.value - b.value).slice(0, 2);
    p.campaign = {
      opened: monthOf(state),
      offers: this.offers(state),
      chosen: [],
      theme: null,
      attacks: weak.map((f) => ({ id: f.id, label: f.label, value: f.value })),
      dissident: null
    };
    const attack = weak.length ? ` La liste « ${p.rival.list} » (${p.rival.leader}) attaque votre bilan : ${weak.map((f) => f.label.toLowerCase()).join(', ')}.` : ` Face à vous : « ${p.rival.list} », menée par ${p.rival.leader}.`;
    this.#notify(state, 'warning', `🗳 La campagne des municipales est ouverte : scrutin dans ${p.nextElection - monthOf(state)} mois. Composez votre programme (Mairie → Campagne).${attack}`, { panel: 'politics' });
  }

  /** Choix du programme (jusqu'à 3 engagements, un par thème) et du thème de campagne. */
  setProgramme(state, { promises = [], theme = null }) {
    const p = this.ensure(state);
    if (!p.campaign) return { ok: false, reason: 'La campagne n\'est pas ouverte' };
    const ids = [...new Set(promises)];
    if (ids.length > MAX_PROMISES) return { ok: false, reason: `${MAX_PROMISES} engagements au plus` };
    const chosen = ids.map((id) => p.campaign.offers.find((o) => o.id === id));
    if (chosen.some((o) => !o)) return { ok: false, reason: 'Engagement inconnu' };
    const themes = chosen.map((o) => o.theme);
    if (new Set(themes).size !== themes.length) return { ok: false, reason: 'Un seul engagement par thème' };
    if (theme !== null && !THEMES[theme]) return { ok: false, reason: 'Thème inconnu' };
    p.campaign.chosen = ids;
    p.campaign.theme = theme;
    return { ok: true };
  }

  /** Points de voix apportés par le programme (ambition × crédibilité). */
  programmeBonus(state) {
    const c = state.politics?.campaign;
    if (!c) return 0;
    const pts = c.chosen.reduce((a, id) => a + (c.offers.find((o) => o.id === id)?.points ?? 0), 0);
    return pts * this.credibility(state);
  }

  /** Effet du thème de campagne : bonus si c'est un point fort du bilan, malus s'il est faible. */
  themeBonus(state) {
    const c = state.politics?.campaign;
    if (!c?.theme) return 0;
    const f = (state.politics.factors ?? []).find((x) => x.id === THEMES[c.theme].factor);
    return clamp((f?.value ?? 0) * 0.35, -3, 3);
  }

  /**
   * v1.1 : cohérence du thème avec les priorités du mandat. +1 point si l'axe du thème a été le plus prioritaire
   * au moins 24 mois ; −1,5 point (« opportunisme ») si sa part est restée sous 10 %.
   */
  coherenceBonus(state) {
    return this.coherenceFor(state, state.politics?.campaign?.theme ?? null);
  }

  coherenceFor(state, theme) {
    const p = state.politics;
    if (!theme || !p?.agenda) return 0;
    const axis = THEME_AXIS[theme];
    if (!axis) return 0;
    if ((p.agenda.topMonths?.[axis] ?? 0) >= 24) return 1;
    if (shareOf(state, axis) < 0.1) return -1.5;
    return 0;
  }

  /** v1.1 : liste dissidente d'un ancien adjoint (points pris à la liste du maire). */
  dissidentPenalty(state) {
    return state.politics?.campaign?.dissident?.points ?? 0;
  }

  /** Avantage de la liste adverse : elle attaque les points faibles de la ville. */
  rivalEdge(state) {
    const worst = Math.min(0, ...(state.politics?.factors ?? []).map((f) => f.value));
    return Math.min(3, -worst * 0.2);
  }

  /** Score projeté de la liste du maire au scrutin (%). */
  projectedShare(state, { noise = true } = {}) {
    const p = state.politics;
    const swing = noise ? (hash2(state.meta.seed ?? 2030, p.nextElection, 0xe1ec) - 0.5) * 5 : 0;
    return clamp(50 + (p.approval - 50) * 0.85 + this.programmeBonus(state) + this.themeBonus(state) + this.coherenceBonus(state) - this.dissidentPenalty(state) - this.rivalEdge(state) + swing, 4, 96);
  }

  // ───────────────────────────── Scrutin ─────────────────────────────

  #election(state) {
    const p = state.politics;
    const m = monthOf(state);
    // Fin du mandat : les engagements en cours sont évalués
    this.#trackPromises(state, true);
    const share = round1(this.projectedShare(state));
    const turnout = round1(clamp(46 + Math.abs(p.approval - 50) * 0.35 + (p.early ? 6 : 0) + (hash2(state.meta.seed ?? 2030, m, 0x7a11) - 0.5) * 6, 30, 82));
    const districts = this.districtResults(state, share);
    const won = share >= 50;
    const c = p.campaign;
    const programme = c ? c.chosen.map((id) => c.offers.find((o) => o.id === id)).filter(Boolean) : [];
    const result = {
      m,
      tick: state.time.tick,
      mandate: p.mandate,
      share,
      rivalShare: round1(100 - share),
      rival: { ...p.rival },
      turnout,
      won,
      early: p.early,
      approval: p.approval,
      programme: programme.map((o) => o.label),
      kept: p.promises.filter((x) => x.status === 'kept').length,
      broken: p.promises.filter((x) => x.status === 'broken').length,
      breakdown: {
        approval: round1((p.approval - 50) * 0.85),
        programme: round1(this.programmeBonus(state)),
        theme: round1(this.themeBonus(state)),
        coherence: round1(this.coherenceBonus(state)),
        dissident: round1(-this.dissidentPenalty(state)),
        rival: round1(-this.rivalEdge(state))
      },
      districts
    };
    p.elections.push(result);
    if (p.elections.length > 12) p.elections.shift();
    p.campaign = null;
    p.early = false;
    if (won) {
      p.mandate++;
      p.termStart = m;
      // v1.1 : nouveau mandat, nouvelle mesure de la cohérence des priorités
      if (p.agenda) p.agenda.topMonths = {};
      p.nextElection = m + TERM_MONTHS;
      p.promises = programme.map((o) => ({ ...o, status: 'pending', since: m, deadline: m + TERM_MONTHS }));
      p.approval = round1(Math.min(97, p.approval + 4));
      this.#notify(state, 'success', `🗳 Réélu(e) avec ${String(share).replace('.', ',')} % des voix (participation ${Math.round(turnout)} %). Début de votre ${p.mandate}e mandat.`, { panel: 'politics' });
    } else {
      p.defeated = true;
      this.#notify(state, 'danger', `🗳 Défaite aux municipales : ${String(share).replace('.', ',')} % des voix face à « ${p.rival.list} » (${String(result.rivalShare).replace('.', ',')} %).`, { panel: 'politics' });
    }
    this.bus?.emit('politics:election', { result: structuredClone(result) });
  }

  /**
   * Résultats par quartier (parcelles de 32 × 32 cases habitées) : écart local de satisfaction et de services,
   * puis recalage pour que la moyenne pondérée par les habitants égale le score de la commune.
   */
  districtResults(state, share) {
    const g = state.grid;
    const map = new Map();
    for (const b of state.buildings.values()) {
      if (!(b.residents > 0)) continue;
      const key = `${Math.floor(b.x / PARCEL)},${Math.floor(b.y / PARCEL)}`;
      let d = map.get(key);
      if (!d) map.set(key, (d = { key, residents: 0, sat: 0, cov: 0 }));
      const i = g.idx(b.x, b.y);
      d.residents += b.residents;
      d.sat += (b.satisfaction ?? 50) * b.residents;
      d.cov += ((Math.min(1, g.coverEducation[i]) + Math.min(1, g.coverHealth[i]) + Math.min(1, g.coverPolice[i])) / 3) * b.residents;
    }
    const list = [...map.values()].sort((a, b) => b.residents - a.residents);
    if (!list.length) return [];
    let pop = 0;
    let sat = 0;
    let cov = 0;
    for (const d of list) {
      pop += d.residents;
      sat += d.sat;
      cov += d.cov;
    }
    const avgSat = sat / pop;
    const avgCov = cov / pop;
    for (const d of list) {
      d.sat /= d.residents;
      d.cov /= d.residents;
      d.raw = share + (d.sat - avgSat) * 0.35 + (d.cov - avgCov) * 10;
    }
    const mean = list.reduce((a, d) => a + d.raw * d.residents, 0) / pop;
    // Noms de quartiers stables (v0.8), partagés avec la fiscalité par quartier
    const lb = state.land?.box ?? { x0: 0, y0: 0 };
    const centre = centreKey(state);
    return list.map((d) => {
      const [gx, gy] = d.key.split(',').map(Number);
      const name = districtName(state, `${gx + lb.x0},${gy + lb.y0}`, centre);
      return { name, x: gx, y: gy, residents: d.residents, share: round1(clamp(d.raw + share - mean, 2, 98)), satisfaction: Math.round(d.sat) };
    });
  }

  // ───────────────────────────── Commandes ─────────────────────────────

  /** Abrogation d'une politique adoptée depuis moins d'un an : revirement noté par l'opinion. */
  onPolicyRepeal(state, adoptedTick) {
    const p = this.ensure(state);
    if (state.time.tick - adoptedTick < 360) p.memory.flipflops.push(state.time.tick);
  }

  /** Après une défaite : continuer la partie sans élections (mode libre). */
  continueAfterDefeat(state) {
    const p = this.ensure(state);
    if (!p.defeated) return { ok: false, reason: 'Aucune défaite à constater' };
    p.defeated = false;
    p.enabled = false;
    if (state.options) state.options.elections = 'off';
    return { ok: true };
  }

  /** Active ou désactive les élections (paramètres de la partie). */
  setEnabled(state, on) {
    const p = this.ensure(state);
    p.enabled = !!on;
    if (state.options) state.options.elections = on ? 'on' : 'off';
    if (on) {
      p.defeated = false;
      const m = monthOf(state);
      if (p.nextElection <= m + CAMPAIGN_MONTHS) {
        p.nextElection = m + LEGACY_FIRST_ELECTION_MONTHS;
        p.campaign = null;
      }
    } else p.campaign = null;
    return { ok: true };
  }
}
