import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';
import { toCents } from '../util/money.js';
import { milestoneOf } from './Milestones.js';
import { CRISIS_TYPES, responseCost } from './CrisisSystem.js';

/**
 * Conseil municipal et adjoints (v1.1, lot C) et priorités du mandat (lot D).
 *
 * - Taille du conseil selon la population, comme pour les communes françaises (art. L2121-2 du CGCT).
 * - Six délégations, qui sont aussi les six axes de priorités. Le statut de la ville fixe combien peuvent être
 *   confiées (2 au Village, 6 à la Métropole).
 * - Chaque adjoint a une compétence (intensité de ses effets), une loyauté, une ambition, une notoriété et une
 *   sensibilité (groupe d'électeurs dont il est proche). Ses effets passent par les modificateurs de la ville.
 * - Demandes des adjoints, démissions, remaniements, délégation des crises, liste dissidente en campagne.
 * - Priorités : 100 points répartis entre les six axes. La part d'un axe multiplie les effets de son adjoint
 *   (efficacité) et le poids des facteurs de popularité qui lui sont rattachés (perception).
 * Tous les tirages sont des hachages déterministes (graine, mois, sel).
 */

export const DELEGATIONS = [
  { id: 'urban', label: 'Urbanisme, logement et emploi', short: 'Urbanisme' },
  { id: 'finance', label: 'Finances et budget', short: 'Finances' },
  { id: 'mobility', label: 'Mobilité', short: 'Mobilité' },
  { id: 'safety', label: 'Sécurité et secours', short: 'Sécurité' },
  { id: 'ecology', label: 'Transition écologique et réseaux', short: 'Écologie' },
  { id: 'social', label: 'Solidarités, éducation, santé et culture', short: 'Solidarités' }
];
export const DELEGATION_BY_ID = Object.fromEntries(DELEGATIONS.map((d) => [d.id, d]));
export const AXES = DELEGATIONS.map((d) => d.id);

/** Effets d'un adjoint par point de compétence au-dessus de 1 (compétence 5 = 4 pas). */
export const DEPUTY_EFFECTS = {
  urban: [
    { key: 'growth.all', op: 'mul', step: 0.03, label: 'Croissance des quartiers' },
    { key: 'demand.R', op: 'add', step: 0.5, label: 'Demande de logements' }
  ],
  finance: [
    { key: 'upkeep.structure', op: 'mul', step: -0.02, label: 'Charges de structure' },
    { key: 'loan.rate', op: 'add', step: -0.001, label: 'Taux des nouveaux emprunts' }
  ],
  mobility: [
    { key: 'upkeep.roads', op: 'mul', step: -0.03, label: 'Entretien de la voirie' },
    { key: 'upkeep.transport', op: 'mul', step: -0.03, label: 'Coût des transports en commun' },
    { key: 'transit.ridershipMult', op: 'mul', step: 0.02, label: 'Fréquentation des transports' }
  ],
  safety: [
    { key: 'risk.fire', op: 'mul', step: -0.08, label: 'Risque d\'incendie' },
    { key: 'risk.riot', op: 'mul', step: -0.08, label: 'Risque d\'émeute' },
    { key: 'risk.protest', op: 'mul', step: -0.05, label: 'Risque de manifestation' }
  ],
  ecology: [
    { key: 'upkeep.utilities', op: 'mul', step: -0.03, label: 'Entretien énergie et eau' },
    { key: 'pollution.buildings', op: 'mul', step: -0.04, label: 'Pollution des bâtiments privés' }
  ],
  social: [
    { key: 'upkeep.services', op: 'mul', step: -0.03, label: 'Entretien des services publics' },
    { key: 'satisfaction.all', op: 'add', step: 0.25, label: 'Satisfaction des habitants' }
  ]
};

/** Crises que peut gérer seul un adjoint compétent de la délégation. */
export const CRISIS_AXIS = { fire: 'safety', protest: 'safety', riot: 'safety', cyber: 'safety', strike: 'mobility', flood: 'ecology', heat: 'ecology', blackout: 'ecology', epidemic: 'social' };

/** Groupes d'électeurs (étiquettes ; le lot G leur donnera un poids électoral). */
export const LEANINGS = ['Familles', 'Retraités', 'Jeunes actifs', 'Classes populaires', 'Cadres', 'Commerçants', 'Écologistes', 'Automobilistes'];

const FIRST = ['Anne', 'Bruno', 'Camille', 'Djamel', 'Élise', 'Fabien', 'Hélène', 'Ibrahim', 'Julie', 'Kévin', 'Laure', 'Mehdi', 'Nathalie', 'Olivier', 'Pauline', 'Rachid', 'Sandrine', 'Thierry', 'Valérie', 'Yann', 'Agnès', 'Cyril', 'Fatou', 'Grégoire', 'Inès', 'Lucas', 'Manon', 'Nicolas', 'Sophie', 'Vincent'];
const LAST = ['Bernard', 'Martin', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guerin', 'Muller', 'Henry', 'Roussel', 'Nicolas', 'Perrin'];

/** Sièges du conseil municipal selon la population (art. L2121-2 du CGCT). */
const SEATS = [[300000, 69], [250000, 65], [200000, 61], [150000, 59], [100000, 55], [80000, 53], [60000, 49], [50000, 45], [40000, 43], [30000, 39], [20000, 35], [10000, 33], [5000, 29], [3500, 27], [2500, 23], [1500, 19], [500, 15], [100, 11], [0, 7]];
export function councilSeats(population) {
  for (const [p, n] of SEATS) if ((population ?? 0) >= p) return n;
  return 7;
}

/** Indemnité mensuelle d'un adjoint (euros) : 800 € × (rang du statut + 1). */
export function allowanceEuros(state) {
  return 800 * (milestoneOf(state).rank + 1);
}

const monthOf = (state) => Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const seedOf = (state) => state.meta?.seed ?? 2030;

export function defaultAgenda() {
  return { shares: { urban: 17, finance: 17, mobility: 17, safety: 17, ecology: 16, social: 16 }, moves: [], topMonths: {} };
}

export function defaultCouncil() {
  return { members: [], pools: {}, poolMandate: 0, vacantUntil: {}, requests: [], lastRequest: -999, reshuffledAt: -999, resignations: [], nextId: 1, autoCrisis: {} };
}

export function councilOf(state) {
  const p = state.politics;
  p.council ??= defaultCouncil();
  return p.council;
}

export function agendaOf(state) {
  const p = state.politics;
  p.agenda ??= defaultAgenda();
  return p.agenda;
}

/** Part (0..1) d'un axe dans les priorités. */
export function shareOf(state, axis) {
  const a = state.politics?.agenda;
  return a ? (a.shares[axis] ?? 0) / 100 : 1 / 6;
}

/** Coefficient d'efficacité d'un axe : 0,85 + 0,9 × part (1/6 → 1,0). */
export function efficiency(state, axis) {
  return 0.85 + 0.9 * shareOf(state, axis);
}

/** Poids de perception d'un axe : 0,7 + 1,8 × part (1/6 → 1,0). */
export function perception(state, axis) {
  return 0.7 + 1.8 * shareOf(state, axis);
}

/** Facteurs de popularité rattachés aux axes (les autres ne sont pas pondérés). */
export const FACTOR_AXES = {
  satisfaction: [['social', 1]],
  jobs: [['urban', 1]],
  housing: [['urban', 1]],
  growth: [['urban', 1]],
  taxes: [['finance', 1]],
  finances: [['finance', 1]],
  services: [['safety', 0.5], ['social', 0.5]],
  living: [['mobility', 0.5], ['ecology', 0.5]],
  crises: [['safety', 1]]
};

export function factorWeight(state, factorId) {
  const axes = FACTOR_AXES[factorId];
  if (!axes || !state.politics?.agenda) return 1;
  return axes.reduce((w, [axis, part]) => w + part * perception(state, axis), 0);
}

/** Axe d'un thème de campagne (cohérence avec les priorités). */
export const THEME_AXIS = { jobs: 'urban', taxes: 'finance', services: 'social', safety: 'safety', environment: 'ecology', mobility: 'mobility', finances: 'finance', growth: 'urban', housing: 'urban' };

/** Effets des adjoints en poste, pondérés par la priorité de leur axe (lus par computeModifiers). */
export function councilEffects(state) {
  const c = state.politics?.council;
  if (!c?.members?.length) return [];
  const out = [];
  for (const m of c.members) {
    const k = efficiency(state, m.delegation) * (m.suspendedUntil > monthOf(state) ? 0 : 1);
    for (const e of DEPUTY_EFFECTS[m.delegation] ?? []) {
      const value = e.step * (m.competence - 1) * k;
      if (value) out.push({ key: e.key, op: e.op, value, label: `${e.label} (${m.name})` });
    }
  }
  return out;
}

/** Délégations confiables pour le statut actuel. */
export function slotsOf(state) {
  return milestoneOf(state).delegations;
}

/**
 * Candidats d'une délégation pour le mandat en cours (trois, tirés de façon déterministe). Un candidat très
 * compétent est plus souvent ambitieux, pour que le choix soit un arbitrage.
 */
export function candidatesFor(state, delegation) {
  const c = councilOf(state);
  const mandate = state.politics.mandate ?? 1;
  if (c.poolMandate !== mandate) {
    c.pools = {};
    c.poolMandate = mandate;
  }
  if (c.pools[delegation]) return c.pools[delegation];
  const seed = seedOf(state);
  const d = AXES.indexOf(delegation);
  const list = [];
  for (let k = 0; k < 3; k++) {
    const r = (salt) => hash2(seed, mandate * 64 + d * 8 + k, salt);
    const competence = 1 + Math.floor(r(0xa1) * 5);
    const ambition = clamp(Math.round(1 + (competence - 1) * 0.6 + r(0xa2) * 2 - 0.5), 1, 5);
    list.push({
      id: `${mandate}-${delegation}-${k}`,
      name: `${FIRST[Math.floor(r(0xa3) * FIRST.length)]} ${LAST[Math.floor(r(0xa4) * LAST.length)]}`,
      delegation,
      competence,
      ambition,
      loyalty: 55 + Math.floor(r(0xa5) * 26),
      notoriety: Math.floor(r(0xa6) * 6) - 2,
      leaning: LEANINGS[Math.floor(r(0xa7) * LEANINGS.length)]
    });
  }
  c.pools[delegation] = list;
  return list;
}

export class CouncilSystem {
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

  memberOf(state, delegation) {
    return councilOf(state).members.find((m) => m.delegation === delegation) ?? null;
  }

  // ───────────────────────────── Nominations ─────────────────────────────

  /** Nomme un adjoint (ou remplace le titulaire : remaniement). */
  appoint(state, { delegation, candidateId }) {
    if (!state.politics) return { ok: false, reason: 'Vie politique indisponible' };
    if (!DELEGATION_BY_ID[delegation]) return { ok: false, reason: 'Délégation inconnue' };
    const c = councilOf(state);
    const m = monthOf(state);
    const cand = candidatesFor(state, delegation).find((x) => x.id === candidateId);
    if (!cand) return { ok: false, reason: 'Candidat inconnu' };
    if (c.members.some((x) => x.id === candidateId) || c.members.some((x) => x.sourceId === candidateId)) return { ok: false, reason: 'Déjà adjoint' };
    if ((c.vacantUntil[delegation] ?? -1) > m) return { ok: false, reason: `Délégation vacante jusqu'au mois ${c.vacantUntil[delegation] - m} : le conseil doit d'abord élire un remplaçant` };
    const current = this.memberOf(state, delegation);
    let penalty = 0;
    if (!current && c.members.length >= slotsOf(state)) {
      return { ok: false, reason: `Statut « ${milestoneOf(state).name} » : ${slotsOf(state)} délégation${slotsOf(state) > 1 ? 's' : ''} au plus` };
    }
    if (current) {
      // Remaniement : au plus un par an, coûteux sauf si l'adjoint remplacé a perdu la confiance (loyauté < 25)
      const free = current.loyalty < 25;
      if (!free && m - c.reshuffledAt < 12) return { ok: false, reason: 'Un seul remaniement par an' };
      if (!free) {
        penalty = 2;
        c.reshuffledAt = m;
        state.politics.memory.flipflops.push(state.time.tick);
        for (const x of c.members) if (x !== current) x.loyalty = clamp(x.loyalty - 5, 0, 100);
      }
      c.members = c.members.filter((x) => x !== current);
    }
    c.members.push({ ...cand, sourceId: cand.id, id: `d${c.nextId++}`, since: m });
    state.dirty.modifiers = true;
    return { ok: true, penalty };
  }

  /** Retire une délégation (même règles qu'un remaniement). */
  dismiss(state, { delegation }) {
    const c = councilOf(state);
    const current = this.memberOf(state, delegation);
    if (!current) return { ok: false, reason: 'Aucun adjoint à cette délégation' };
    const m = monthOf(state);
    const free = current.loyalty < 25;
    if (!free && m - c.reshuffledAt < 12) return { ok: false, reason: 'Un seul remaniement par an' };
    if (!free) {
      c.reshuffledAt = m;
      state.politics.memory.flipflops.push(state.time.tick);
      for (const x of c.members) if (x !== current) x.loyalty = clamp(x.loyalty - 5, 0, 100);
    }
    c.members = c.members.filter((x) => x !== current);
    state.dirty.modifiers = true;
    return { ok: true };
  }

  setAutoCrisis(state, { delegation, enabled }) {
    const m = this.memberOf(state, delegation);
    if (!m) return { ok: false, reason: 'Aucun adjoint à cette délégation' };
    if (enabled && m.competence < 3) return { ok: false, reason: 'Il faut un adjoint de compétence 3 au moins' };
    councilOf(state).autoCrisis[delegation] = !!enabled;
    return { ok: true };
  }

  // ───────────────────────────── Priorités ─────────────────────────────

  /** Répartit les 100 points de priorités (entiers, somme 100). */
  setAgenda(state, { shares }) {
    if (!state.politics) return { ok: false, reason: 'Vie politique indisponible' };
    const next = {};
    let sum = 0;
    for (const axis of AXES) {
      const v = Math.round(Number(shares?.[axis]));
      if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, reason: 'Répartition invalide' };
      next[axis] = v;
      sum += v;
    }
    if (sum !== 100) return { ok: false, reason: 'La somme des priorités doit faire 100' };
    const a = agendaOf(state);
    const moved = AXES.reduce((x, axis) => x + Math.abs(next[axis] - a.shares[axis]), 0) / 2;
    if (moved > 0) a.moves.push({ m: monthOf(state), points: moved });
    a.shares = next;
    state.dirty.modifiers = true;
    return { ok: true, moved };
  }

  /** Points déplacés sur les 12 derniers mois. */
  movedLastYear(state) {
    const a = agendaOf(state);
    const m = monthOf(state);
    return a.moves.filter((x) => m - x.m < 12).reduce((s, x) => s + x.points, 0);
  }

  // ───────────────────────────── Demandes ─────────────────────────────

  /** Réponse du maire à une demande d'adjoint. */
  answer(state, { requestId, accept }, deps = {}) {
    const c = councilOf(state);
    const req = c.requests.find((r) => r.id === requestId);
    if (!req) return { ok: false, reason: 'Demande introuvable' };
    const member = c.members.find((x) => x.id === req.memberId);
    if (accept) {
      if (req.type === 'budget') {
        const cents = toCents(req.euros);
        if (!this.economy.canAfford(state, cents)) return { ok: false, reason: 'Budget insuffisant' };
        this.economy.payOpex(state, { amount: cents, category: 'council', label: `Enveloppe exceptionnelle : ${DELEGATION_BY_ID[req.delegation].short} (${member?.name ?? 'adjoint'})` });
      } else if (req.type === 'priority') {
        const a = agendaOf(state);
        const shares = { ...a.shares };
        const need = 20 - shares[req.delegation];
        if (need > 0) {
          // On prend les points sur les axes les plus dotés
          let left = need;
          for (const axis of [...AXES].filter((x) => x !== req.delegation).sort((x, y) => shares[y] - shares[x])) {
            const take = Math.min(left, Math.max(0, shares[axis] - 5));
            shares[axis] -= take;
            left -= take;
            if (!left) break;
          }
          shares[req.delegation] += need - left;
          const r = this.setAgenda(state, { shares });
          if (!r.ok) return r;
        }
      } else if (req.type === 'policy') {
        const r = deps.adoptPolicy?.(req.policyId);
        if (r && !r.ok) return r;
      }
      if (member) member.loyalty = clamp(member.loyalty + 6, 0, 100);
    } else if (member) {
      member.loyalty = clamp(member.loyalty - 8, 0, 100);
    }
    c.requests = c.requests.filter((r) => r !== req);
    return { ok: true };
  }

  #makeRequest(state, member) {
    const c = councilOf(state);
    const m = monthOf(state);
    const seed = seedOf(state);
    const a = agendaOf(state);
    const lastRevenue = state.economy.periods.at(-1);
    const revenues = lastRevenue ? Object.values(lastRevenue.revenue).reduce((x, v) => x + v, 0) / 100 : 0;
    const types = [];
    if (a.shares[member.delegation] < 20) types.push('priority');
    if (revenues > 0) types.push('budget');
    const policies = (POLICIES_BY_AXIS[member.delegation] ?? []).filter((id) => {
      const pol = this.catalog?.policyById?.get(id);
      return pol && !(id in state.policies.active) && (!pol.unlock?.population || (state.stats.peakPopulation ?? 0) >= pol.unlock.population);
    });
    if (policies.length) types.push('policy');
    if (!types.length) return null;
    const type = types[Math.floor(hash2(seed, m, 0xc0de) * types.length)];
    const req = { id: `r${c.nextId++}`, memberId: member.id, delegation: member.delegation, type, month: m, expires: m + 2 };
    if (type === 'budget') {
      req.euros = Math.max(1000, Math.round((revenues * (0.02 + hash2(seed, m, 0xb0d6) * 0.04)) / 100) * 100);
      req.label = `${member.name} demande une enveloppe exceptionnelle de ${req.euros.toLocaleString('fr-FR')} € pour la délégation « ${DELEGATION_BY_ID[member.delegation].short} ».`;
    } else if (type === 'priority') {
      req.label = `${member.name} demande que la priorité « ${DELEGATION_BY_ID[member.delegation].short} » passe à 20 %.`;
    } else {
      req.policyId = policies[Math.floor(hash2(seed, m, 0x9011c) * policies.length)];
      req.label = `${member.name} demande l'adoption de la politique « ${this.catalog.policyById.get(req.policyId).name} ».`;
    }
    c.requests.push(req);
    c.lastRequest = m;
    this.#notify(state, 'info', `🏛 ${req.label} (Mairie → Conseil)`);
    return req;
  }

  // ───────────────────────────── Mois ─────────────────────────────

  /** Bilan mensuel : indemnités, loyauté, demandes, démissions, cohérence des priorités. Avant la clôture. */
  monthly(state) {
    if (!state.politics) return;
    const c = councilOf(state);
    const a = agendaOf(state);
    const m = monthOf(state);
    const seed = seedOf(state);
    // Inaugurations du mois : l'adjoint du domaine apprécie
    if (c.members.length && this.catalog) {
      for (const b of state.buildings.values()) {
        if (b.origin === 'player' && state.time.tick - b.builtTick <= SIM.DAYS_PER_MONTH && state.time.tick - b.builtTick > 0) this.onInauguration(state, this.catalog.buildingFor(b));
      }
    }
    // Indemnités des élus
    if (c.members.length) {
      const cents = toCents(allowanceEuros(state) * c.members.length);
      this.economy.post(state, { kind: 'opex', category: 'councilAllowances', label: `Indemnités des adjoints (${c.members.length})`, amount: -cents });
    }
    // Axe le plus prioritaire, mois par mois (cohérence du thème de campagne)
    const top = [...AXES].sort((x, y) => a.shares[y] - a.shares[x])[0];
    if (a.shares[top] > Math.max(...AXES.filter((x) => x !== top).map((x) => a.shares[x]))) a.topMonths[top] = (a.topMonths[top] ?? 0) + 1;
    a.moves = a.moves.filter((x) => m - x.m < 24);
    // Loyauté selon la priorité de chaque axe
    for (const x of c.members) {
      const s = a.shares[x.delegation];
      if (s >= 20) x.loyalty = clamp(x.loyalty + 1, 0, 100);
      else if (s < 8) x.loyalty = clamp(x.loyalty - 2, 0, 100);
    }
    // Demandes expirées : comptent comme un refus
    for (const r of c.requests.filter((r) => r.expires <= m)) {
      const x = c.members.find((y) => y.id === r.memberId);
      if (x) x.loyalty = clamp(x.loyalty - 8, 0, 100);
    }
    c.requests = c.requests.filter((r) => r.expires > m && c.members.some((y) => y.id === r.memberId));
    // Nouvelle demande : au plus une tous les 3 mois, jamais la première année
    if (c.members.length && state.time.tick >= 360 && m - c.lastRequest >= 3 && !c.requests.length && hash2(seed, m, 0xdea1) < 0.35) {
      const member = c.members[Math.floor(hash2(seed, m, 0xdea2) * c.members.length)];
      this.#makeRequest(state, member);
    }
    // Démissions : 3 % par point de loyauté sous 25
    for (const x of [...c.members]) {
      if (x.loyalty >= 25) continue;
      if (hash2(seed, m, 0xd310 + x.since) < 0.03 * (25 - x.loyalty)) {
        c.members = c.members.filter((y) => y !== x);
        c.vacantUntil[x.delegation] = m + 3;
        c.resignations.push(state.time.tick);
        state.dirty.modifiers = true;
        this.#notify(state, 'warning', `🏛 ${x.name} démissionne de sa délégation « ${DELEGATION_BY_ID[x.delegation].short} ». Elle reste vacante trois mois.`);
      }
    }
    c.resignations = c.resignations.filter((t) => state.time.tick - t < 360);
  }

  /**
   * v1.3 : après une fusion d'entre-deux-tours, la tête de liste partenaire reçoit une délégation (celle de son
   * thème si possible ; à défaut, elle remplace l'adjoint le moins loyal, sans pénalité).
   */
  welcomePartner(state, { listId, leader }) {
    const c = councilOf(state);
    const want = listId === 'green' ? 'ecology' : listId === 'citizen' ? 'social' : null;
    const free = AXES.filter((a) => !c.members.some((m) => m.delegation === a));
    let delegation = want && free.includes(want) ? want : free[0] ?? null;
    if (c.members.length >= slotsOf(state) || !delegation) {
      if (!c.members.length) return null;
      const weakest = [...c.members].sort((a, b) => a.loyalty - b.loyalty)[0];
      delegation = weakest.delegation;
      c.members = c.members.filter((m) => m !== weakest);
    }
    const member = { id: `d${c.nextId++}`, sourceId: `partner-${listId}-${state.time.tick}`, name: leader, delegation, competence: 2, ambition: 4, loyalty: 35, notoriety: 1, leaning: listId === 'green' ? 'Écologistes' : 'Classes populaires', since: monthOf(state), partner: listId };
    c.members.push(member);
    state.dirty.modifiers = true;
    this.#notify(state, 'info', `🏛 Accord de fusion : ${leader} reçoit la délégation « ${DELEGATION_BY_ID[delegation].short} ».`);
    return member;
  }

  /** Effets ponctuels : promesses tenues (loyauté de l'adjoint de l'axe), inaugurations du domaine. */
  onPromiseKept(state, theme) {
    const axis = THEME_AXIS[theme];
    const x = axis && this.memberOf(state, axis);
    if (x) x.loyalty = clamp(x.loyalty + 5, 0, 100);
  }

  onInauguration(state, def) {
    const axis = BUILDING_AXIS[def.category === 'services' ? def.capacity?.service?.type : def.category];
    const x = axis && (def.cost ?? 0) >= 50000 && this.memberOf(state, axis);
    if (x) x.loyalty = clamp(x.loyalty + 3, 0, 100);
  }

  /** Délégation des crises : l'adjoint choisit la réponse active si elle coûte au plus 5 % de la trésorerie. */
  daily(state, crises) {
    const c = state.politics?.council;
    if (!c?.members?.length || !crises) return;
    for (const cr of state.crises?.active ?? []) {
      if (cr.response) continue;
      const axis = CRISIS_AXIS[cr.kind];
      if (!axis || !c.autoCrisis[axis]) continue;
      const x = c.members.find((y) => y.delegation === axis);
      if (!x || x.competence < 3) continue;
      const option = CRISIS_TYPES[cr.kind]?.responses?.[0]?.id;
      if (!option) continue;
      const cost = toCents(responseCost(state, cr, option));
      if (cost > Math.max(0, state.economy.treasury) * 0.05) continue;
      const r = crises.respond(state, cr.id, option);
      if (r.ok) this.#notify(state, 'info', `🏛 ${x.name} a pris en charge la crise : ${CRISIS_TYPES[cr.kind].responses[0].label.toLowerCase()}.`);
    }
  }

  /** Popularité : notoriété de l'équipe (plafonnée à +4), démissions récentes. */
  teamFactor(state) {
    const c = state.politics?.council;
    if (!c) return null;
    const m = monthOf(state);
    const vacant = Object.values(c.vacantUntil).filter((u) => u > m).length;
    const notoriety = Math.min(4, c.members.reduce((s, x) => s + (x.suspendedUntil > m ? 0 : x.notoriety), 0));
    const value = notoriety - vacant - 2 * c.resignations.length;
    if (!c.members.length && !vacant && !c.resignations.length) return null;
    return { value, detail: `${c.members.length} adjoint${c.members.length > 1 ? 's' : ''}${vacant ? `, ${vacant} délégation(s) vacante(s)` : ''}${c.resignations.length ? `, ${c.resignations.length} démission(s) récente(s)` : ''}` };
  }

  /**
   * Campagne : un adjoint ambitieux et peu loyal quitte la majorité quand la popularité est faible.
   * @returns {{name:string, delegation:string, points:number}|null}
   */
  dissident(state) {
    const c = state.politics?.council;
    if (!c?.members?.length || (state.politics.approval ?? 50) >= 47) return null;
    const x = [...c.members].filter((y) => y.ambition >= 4 && y.loyalty < 40).sort((a, b) => b.ambition - a.ambition || a.loyalty - b.loyalty)[0];
    if (!x) return null;
    c.members = c.members.filter((y) => y !== x);
    c.vacantUntil[x.delegation] = monthOf(state) + 3;
    state.dirty.modifiers = true;
    return { name: x.name, delegation: x.delegation, points: 1 + x.ambition };
  }
}

/** Politiques qu'un adjoint peut réclamer, par délégation. */
export const POLICIES_BY_AXIS = {
  urban: ['worker_housing', 'job_training', 'rent_control'],
  finance: ['remote_work'],
  mobility: ['free_transit', 'night_delivery', 'regional_commuters'],
  safety: ['cyber_defense', 'flood_plan', 'social_dialogue'],
  ecology: ['low_emission_zone', 'solar_subsidy', 'green_roofs', 'waste_sorting'],
  social: ['heat_plan', 'rent_control', 'job_training']
};

/** Domaine d'un équipement (inaugurations). */
const BUILDING_AXIS = {
  police: 'safety', fire: 'safety', health: 'social', education: 'social', admin: 'finance',
  parks: 'social', transport: 'mobility', energy: 'ecology', water: 'ecology', waste: 'ecology', logistics: 'urban'
};
