import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';
import { councilSeats } from './CouncilSystem.js';

/**
 * Électorat par groupes et scrutin de liste à deux tours (v1.3, lot G).
 *
 * - Huit groupes d'électeurs dérivés des ménages déjà simulés (âges, revenus, qualification, emplois, voiture).
 *   Chaque groupe pèse différemment les facteurs de popularité ; les poids sont normalisés pour que la moyenne
 *   pondérée par la taille des groupes redonne la popularité générale (inchangée). Les politiques et les
 *   technologies autonomes divisent les groupes sans changer la moyenne.
 * - Participation par groupe (base, mobilisation par le thème de campagne et les fêtes, abstention de défiance).
 * - Listes : celle du maire, l'adversaire principal, une liste écologiste (pollution ou électorat écologiste), une
 *   liste citoyenne (popularité faible), la liste dissidente d'un ancien adjoint.
 * - Premier tour : élu si plus de 50 % des exprimés et au moins 25 % des inscrits. Sinon, entre-deux-tours : les listes
 *   à 10 % ou plus se maintiennent, celles à 5 % ou plus peuvent fusionner (négociation du maire, l'adversaire fusionne
 *   avec la liste la plus proche), second tour, prime majoritaire et répartition des sièges.
 * Tous les tirages sont des hachages déterministes.
 */

export const GROUPS = {
  families: { label: 'Familles', turnout: 55, tech: 0 },
  retirees: { label: 'Retraités', turnout: 72, tech: -0.5 },
  youngWorkers: { label: 'Jeunes actifs', turnout: 35, tech: 0.5 },
  working: { label: 'Classes populaires', turnout: 42, tech: -0.5 },
  executives: { label: 'Cadres', turnout: 60, tech: 1 },
  merchants: { label: 'Commerçants et entrepreneurs', turnout: 58, tech: 0.5 },
  greens: { label: 'Écologistes', turnout: 50, tech: 0 },
  drivers: { label: 'Automobilistes', turnout: 52, tech: -1 }
};
export const GROUP_IDS = Object.keys(GROUPS);

/** Correspondance avec les étiquettes « proche des … » des adjoints (v1.1). */
export const LEANING_GROUP = { Familles: 'families', Retraités: 'retirees', 'Jeunes actifs': 'youngWorkers', 'Classes populaires': 'working', Cadres: 'executives', Commerçants: 'merchants', Écologistes: 'greens', Automobilistes: 'drivers' };

/** Sensibilité brute de chaque groupe aux facteurs de popularité (normalisée ensuite). */
const SENSITIVITY = {
  satisfaction: { families: 1.2, retirees: 1, youngWorkers: 0.9, working: 1, executives: 1, merchants: 0.8, greens: 1, drivers: 0.9 },
  jobs: { families: 1, retirees: 0.4, youngWorkers: 1.8, working: 1.8, executives: 0.8, merchants: 1, greens: 0.7, drivers: 1 },
  taxes: { families: 1, retirees: 1.3, youngWorkers: 0.7, working: 0.8, executives: 1.4, merchants: 1.6, greens: 0.6, drivers: 1 },
  finances: { families: 0.8, retirees: 1.3, youngWorkers: 0.6, working: 0.5, executives: 1.4, merchants: 1.4, greens: 0.7, drivers: 0.8 },
  services: { families: 1.5, retirees: 1.4, youngWorkers: 0.8, working: 1.1, executives: 1.1, merchants: 0.7, greens: 0.8, drivers: 0.7 },
  living: { families: 1.1, retirees: 1, youngWorkers: 1, working: 0.7, executives: 1.2, merchants: 1.1, greens: 1.8, drivers: 1.5 },
  housing: { families: 1.4, retirees: 0.6, youngWorkers: 1.7, working: 1.4, executives: 0.6, merchants: 0.6, greens: 0.8, drivers: 0.8 },
  crises: { families: 1, retirees: 1.3, youngWorkers: 0.8, working: 1, executives: 1, merchants: 1.1, greens: 1, drivers: 0.9 },
  local: { families: 1.6, retirees: 0.8, youngWorkers: 1.5, working: 1.1, executives: 0.7, merchants: 1.2, greens: 0.9, drivers: 0.6 },
  controversies: { families: 1, retirees: 1.2, youngWorkers: 0.8, working: 0.8, executives: 1.2, merchants: 1, greens: 1.1, drivers: 0.9 }
};

/** Effets des politiques par groupe (points d'opinion, redistribués : la moyenne pondérée reste nulle). */
export const POLICY_GROUP_EFFECTS = {
  low_emission_zone: { greens: 4, drivers: -5, merchants: -1, executives: 1 },
  free_transit: { working: 3, youngWorkers: 2, greens: 2, merchants: -1 },
  rent_control: { working: 3, youngWorkers: 3, executives: -2, merchants: -1 },
  remote_work: { executives: 2, youngWorkers: 1, merchants: -1 },
  solar_subsidy: { greens: 2, executives: 1 },
  green_roofs: { greens: 2, families: 1 },
  night_delivery: { merchants: 2, families: -1, retirees: -1 },
  waste_sorting: { greens: 1, retirees: -1 },
  heat_plan: { retirees: 2, families: 1 },
  job_training: { working: 2, youngWorkers: 1 },
  regional_commuters: { merchants: 2, drivers: -1 },
  worker_housing: { youngWorkers: 2, families: 1, executives: -1 },
  social_dialogue: { working: 1 },
  flood_plan: { retirees: 1, families: 1 },
  cyber_defense: { executives: 1 }
};

/** Technologies dont l'acceptation dépend de l'attitude des groupes envers la technologie. */
const VISIBLE_TECH = ['autonomous_vehicles', 'autonomous_shuttles', 'drone_delivery', 'ground_robots', 'municipal_copilot'];

/** Groupes visés par un thème de campagne (mobilisation +5 points de participation, programme renforcé). */
export const THEME_GROUPS = {
  jobs: ['working', 'youngWorkers'],
  taxes: ['executives', 'merchants', 'retirees'],
  services: ['families', 'retirees'],
  safety: ['retirees', 'families'],
  environment: ['greens', 'families'],
  mobility: ['drivers', 'youngWorkers', 'greens'],
  finances: ['executives', 'merchants', 'retirees'],
  growth: ['merchants', 'executives'],
  housing: ['youngWorkers', 'working', 'families']
};

/** Listes d'opposition possibles et leur affinité avec chaque groupe. */
export const LISTS = {
  rival: { label: null, theme: null, affinity: {} },
  green: { label: 'Écologie et solidarité', leader: 'Élodie Moreau', theme: 'environment', strength: 0.35, affinity: { greens: 3, youngWorkers: 1.2, executives: 0.8, families: 0.7 } },
  citizen: { label: 'Le Renouveau citoyen', leader: 'Sophie Garnier', theme: 'housing', strength: 0.3, affinity: { working: 1.5, youngWorkers: 1.2, families: 1, retirees: 0.6 } },
  dissident: { label: null, theme: null, strength: 0, affinity: {} }
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round1 = (v) => Math.round(v * 10) / 10;
const monthOf = (state) => Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);

/** Taille des groupes (électeurs, avec recouvrements), à partir des ménages et des emplois. */
export function groupSizes(state) {
  const size = Object.fromEntries(GROUP_IDS.map((g) => [g, 0]));
  const carShare = clamp(SIM.CAR_MODE_SHARE + (state.modifiers?.carModeShare ?? 0), 0.05, 0.95);
  const g = state.grid;
  for (const b of state.buildings.values()) {
    if (b.residents > 0) {
      const a = b.ages ?? { young: 0, adult: b.residents, senior: 0 };
      const cls = b.incomeClass ?? 'mid';
      const q = b.qualification ?? 0.5;
      const green = g ? Math.min(1, (g.green?.[g.idx(b.x, b.y)] ?? 0) / 25) : 0;
      size.retirees += a.senior;
      size.families += a.adult * (cls === 'mid' ? 0.6 : 0.4) * (a.young > 0 ? 1 : 0.3);
      size.youngWorkers += a.adult * (cls === 'high' ? 0.1 : q > 0.6 ? 0.35 : 0.15);
      if (cls === 'low') size.working += (a.adult + a.senior) * 0.7;
      if (cls === 'high') size.executives += a.adult * 0.8;
      size.greens += (a.adult + a.senior) * (0.05 + 0.15 * q) * (0.6 + 0.8 * green);
      size.drivers += (b.workforce ?? a.adult) * carShare * 0.5;
    }
    if (b.jobsFilled > 0 && /^(com|off|ch)/.test(b.defId ?? '')) size.merchants += b.jobsFilled * 0.12;
  }
  return size;
}

/** Facteurs de popularité ramenés aux groupes : poids normalisés (moyenne pondérée = 1 par facteur). */
function normalizedWeights(sizes) {
  const total = GROUP_IDS.reduce((s, g) => s + sizes[g], 0) || 1;
  const out = {};
  for (const [f, sens] of Object.entries(SENSITIVITY)) {
    const mean = GROUP_IDS.reduce((s, g) => s + sizes[g] * (sens[g] ?? 1), 0) / total || 1;
    out[f] = Object.fromEntries(GROUP_IDS.map((g) => [g, (sens[g] ?? 1) / mean]));
  }
  return out;
}

/**
 * Opinion de chaque groupe : popularité générale + écart propre au groupe (facteurs pondérés, politiques,
 * technologies), recentré pour que la moyenne pondérée par la taille redonne la popularité générale.
 * @returns {{id:string, label:string, size:number, share:number, approval:number, turnout:number, detail:string[]}[]}
 */
export function groupOpinions(state) {
  const p = state.politics;
  if (!p) return [];
  const sizes = groupSizes(state);
  const total = GROUP_IDS.reduce((s, g) => s + sizes[g], 0);
  if (!(total > 0)) return [];
  const W = normalizedWeights(sizes);
  const dev = Object.fromEntries(GROUP_IDS.map((g) => [g, 0]));
  const notes = Object.fromEntries(GROUP_IDS.map((g) => [g, []]));
  for (const f of p.factors ?? []) {
    const w = W[f.id];
    if (!w) continue;
    for (const g of GROUP_IDS) dev[g] += (w[g] - 1) * f.value;
  }
  // Politiques adoptées et technologies visibles : effets propres à chaque groupe
  for (const id of Object.keys(state.policies?.active ?? {})) {
    for (const [g, v] of Object.entries(POLICY_GROUP_EFFECTS[id] ?? {})) {
      dev[g] += v;
      notes[g].push(`${v > 0 ? '+' : ''}${v} politique`);
    }
  }
  const techs = VISIBLE_TECH.filter((t) => state.tech?.researched?.[t] !== undefined).length;
  if (techs) for (const g of GROUP_IDS) dev[g] += clamp(GROUPS[g].tech * techs, -3, 3);
  // Recentrage : la moyenne pondérée des écarts est nulle
  const mean = GROUP_IDS.reduce((s, g) => s + sizes[g] * dev[g], 0) / total;
  const m = monthOf(state);
  const events = (state.civicEvents?.history ?? []).filter((e) => e.success && m - e.month < 12).length;
  const theme = p.campaign?.theme;
  return GROUP_IDS.map((g) => {
    const approval = clamp(p.approval + dev[g] - mean, 0, 100);
    let turnout = GROUPS[g].turnout + (theme && THEME_GROUPS[theme]?.includes(g) ? 5 : 0) + (events ? 2 : 0) - (approval < 35 ? 8 : 0) + Math.abs(approval - 50) * 0.15;
    turnout = clamp(turnout, 20, 90);
    return { id: g, label: GROUPS[g].label, size: sizes[g], share: sizes[g] / total, approval: round1(approval), turnout: round1(turnout), detail: notes[g] };
  });
}

/** Listes d'opposition présentes au premier tour. */
export function opposingLists(state, groups) {
  const p = state.politics;
  const out = [{ id: 'rival', label: p.rival.list, leader: p.rival.leader, theme: null, strength: 1, affinity: {} }];
  const greens = groups.find((g) => g.id === 'greens')?.share ?? 0;
  if ((state.stats?.avgPollution ?? 0) > 15 || greens > 0.15) out.push({ id: 'green', ...LISTS.green });
  if ((p.approval ?? 50) < 45) out.push({ id: 'citizen', ...LISTS.citizen });
  const d = p.campaign?.dissident;
  if (d) out.push({ id: 'dissident', label: `Liste de ${d.name}`, leader: d.name, theme: null, strength: 0, points: d.points, affinity: {} });
  return out;
}

/**
 * Premier tour : voix de chaque liste dans chaque groupe.
 * `base` : score du maire selon la formule de la v0.7 (popularité, programme, thème, cohérence, adversaire, aléa),
 * que les groupes déclinent sans changer sa moyenne.
 */
export function firstRound(state, { base, programme = 0, themeGroups = [], dissidentPoints = 0 }) {
  const groups = groupOpinions(state);
  const p = state.politics;
  const lists = opposingLists(state, groups);
  // Programme renforcé dans les groupes visés par le thème (moyenne pondérée inchangée)
  const totalShare = groups.reduce((s, g) => s + g.share, 0) || 1;
  const boostRaw = groups.map((g) => (themeGroups.includes(g.id) ? 1.6 : 0.85));
  const boostMean = groups.reduce((s, g, k) => s + g.share * boostRaw[k], 0) / totalShare;
  const votes = Object.fromEntries([['mayor', 0], ...lists.map((l) => [l.id, 0])]);
  let expressed = 0;
  let registered = 0;
  const byGroup = [];
  groups.forEach((g, k) => {
    const mayor = clamp(base + 0.85 * (g.approval - p.approval) + programme * (boostRaw[k] / boostMean - 1) - dissidentPoints, 3, 97);
    const rest = 100 - mayor - dissidentPoints;
    const shares = { mayor };
    let wsum = 0;
    const weights = {};
    for (const l of lists) {
      if (l.id === 'dissident') continue;
      weights[l.id] = l.id === 'rival' ? 1 : (l.strength ?? 0.3) * (l.affinity[g.id] ?? 0.4);
      wsum += weights[l.id];
    }
    for (const l of lists) {
      if (l.id === 'dissident') shares.dissident = dissidentPoints + (LEANING_GROUP[p.campaign?.dissident?.leaning] === g.id ? 2 : 0);
      else shares[l.id] = (rest * weights[l.id]) / wsum;
    }
    const norm = Object.values(shares).reduce((a, v) => a + v, 0);
    const voters = g.size * (g.turnout / 100);
    registered += g.size;
    expressed += voters;
    for (const [id, v] of Object.entries(shares)) votes[id] += (voters * v) / norm;
    byGroup.push({ id: g.id, label: g.label, share: g.share, turnout: g.turnout, approval: g.approval, mayor: round1((shares.mayor / norm) * 100) });
  });
  const results = [{ id: 'mayor', label: 'Votre liste', leader: null }, ...lists].map((l) => ({ id: l.id, label: l.label, leader: l.leader ?? null, theme: l.theme ?? null, share: expressed > 0 ? round1((votes[l.id] / expressed) * 100) : 0, votes: votes[l.id] }));
  return { lists: results, expressed, registered, turnout: registered > 0 ? round1((expressed / registered) * 100) : 0, byGroup };
}

/** Le premier tour suffit-il ? @returns {'mayor'|'rival'|null} */
export function decidedInFirstRound(r1) {
  const reg = r1.registered || 1;
  for (const l of r1.lists) if (l.share > 50 && l.votes / reg >= 0.25) return l.id === 'mayor' ? 'mayor' : l.id;
  return null;
}

/** Listes que le maire peut proposer de fusionner (5 % ou plus, hors adversaire principal). */
export function mergeCandidates(r1) {
  return r1.lists.filter((l) => !['mayor', 'rival'].includes(l.id) && l.share >= 5);
}

/**
 * Une liste accepte-t-elle de fusionner avec celle du maire ? Oui si le maire est en tête, ou si son thème est l'axe
 * le plus prioritaire du maire (écologie pour la liste écologiste, solidarités pour la liste citoyenne).
 */
export function mergeAccepted(state, r1, listId) {
  const mayor = r1.lists.find((l) => l.id === 'mayor');
  const rival = r1.lists.find((l) => l.id === 'rival');
  const ahead = mayor.share >= rival.share;
  if (listId === 'dissident') return ahead;
  const shares = state.politics?.agenda?.shares;
  const axis = listId === 'green' ? 'ecology' : listId === 'citizen' ? 'social' : null;
  const aligned = shares && axis ? shares[axis] >= 20 : false;
  return ahead || aligned;
}

/**
 * Second tour : fusions, reports de voix, résultat.
 * @param {{mergeWith?:string|null}} opts liste fusionnée avec celle du maire (acceptée), sinon null
 */
export function secondRound(state, r1, { mergeWith = null, seed = 0 } = {}) {
  const lists = r1.lists.map((l) => ({ ...l }));
  const get = (id) => lists.find((l) => l.id === id);
  const mayor = get('mayor');
  const rival = get('rival');
  let total = r1.expressed;
  const transfers = [];
  const merged = { mayor: [], rival: [] };
  if (mergeWith && get(mergeWith)) {
    const l = get(mergeWith);
    mayor.votes += l.votes * 0.8;
    merged.mayor.push(l.id);
    transfers.push({ from: l.id, to: 'mayor', share: 0.8 });
    l.out = true;
  }
  // L'adversaire fusionne avec la liste restante la plus forte (hors liste dissidente, qui se maintient ou se retire)
  const rest = lists.filter((l) => !['mayor', 'rival'].includes(l.id) && !l.out && l.share >= 5 && l.id !== 'dissident').sort((a, b) => b.share - a.share);
  if (rest[0]) {
    rival.votes += rest[0].votes * 0.8;
    merged.rival.push(rest[0].id);
    transfers.push({ from: rest[0].id, to: 'rival', share: 0.8 });
    rest[0].out = true;
  }
  // Les autres : maintien à 10 % ou plus (triangulaire), sinon reports partiels et abstention
  const finalists = [mayor, rival];
  for (const l of lists) {
    if (l === mayor || l === rival || l.out) continue;
    if (l.share >= 10) {
      l.votes *= 0.9;
      finalists.push(l);
    } else {
      mayor.votes += l.votes * 0.35;
      rival.votes += l.votes * 0.35;
      total -= l.votes * 0.3;
      transfers.push({ from: l.id, to: 'both', share: 0.35 });
    }
  }
  // Mobilisation du second tour (±3 % des exprimés, déterministe)
  const swing = 1 + (hash2(seed, 0x2d2, 0x7) - 0.5) * 0.06;
  total *= swing;
  const sum = finalists.reduce((s, l) => s + l.votes, 0) || 1;
  const results = finalists.map((l) => ({ id: l.id, label: l.label, leader: l.leader, share: round1((l.votes / sum) * 100), votes: l.votes }));
  results.sort((a, b) => b.share - a.share);
  return { lists: results, turnout: round1(clamp(r1.turnout * swing, 15, 95)), merged, transfers, winner: results[0].id };
}

/**
 * Sièges du conseil : prime majoritaire (la moitié des sièges à la liste en tête), puis répartition à la plus forte
 * moyenne de l'autre moitié entre les listes à 5 % ou plus, gagnante comprise.
 */
export function allocateSeats(population, finalLists) {
  const total = councilSeats(population);
  const winner = finalLists[0];
  const bonus = Math.ceil(total / 2);
  const rest = total - bonus;
  const eligible = finalLists.filter((l) => l.share >= 5);
  const seats = Object.fromEntries(finalLists.map((l) => [l.id, 0]));
  seats[winner.id] = bonus;
  const won = Object.fromEntries(eligible.map((l) => [l.id, 0]));
  for (let k = 0; k < rest; k++) {
    let best = null;
    let bestAvg = -1;
    for (const l of eligible) {
      const avg = l.share / (won[l.id] + 1);
      if (avg > bestAvg) {
        bestAvg = avg;
        best = l;
      }
    }
    if (!best) break;
    won[best.id]++;
  }
  for (const [id, n] of Object.entries(won)) seats[id] += n;
  return { total, seats, majority: seats[winner.id] / total };
}

/**
 * Vote du conseil sur une délibération clivante quand la majorité est étroite (moins de 55 % des sièges).
 * @returns {{ok:boolean, needed:boolean, score?:number}}
 */
export function councilVote(state, salt = 0) {
  const p = state.politics;
  const maj = p?.majority;
  if (!maj || !(maj.share < 0.55)) return { ok: true, needed: false };
  const members = p.council?.members ?? [];
  const loyalty = members.length ? members.reduce((s, m) => s + m.loyalty, 0) / members.length : 50;
  const noise = (hash2(state.meta?.seed ?? 2030, state.time.tick, 0xc0c1 + salt) - 0.5) * 10;
  const score = maj.share * 100 + (2 * (loyalty - 50)) / 50 + noise;
  return { ok: score >= 50, needed: true, score: round1(score) };
}
