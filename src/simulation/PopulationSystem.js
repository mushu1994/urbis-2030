import { SIM } from './config.js';
import { emptyStats } from '../app/GameState.js';

const BRACKETS = ['low', 'mid', 'high'];

export function workerBracket(q) {
  return q < 0.42 ? 'low' : q < 0.66 ? 'mid' : 'high';
}

export function jobBracket(q) {
  return q < 0.4 ? 'low' : q < 0.62 ? 'mid' : 'high';
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Population agrégée par bâtiment résidentiel (un « groupe » de ménages par bâtiment) :
 * effectif, revenu, structure par âge, actifs, qualification, emploi, loyer et satisfaction.
 * Calcule aussi le marché du travail, la consommation, la production et la demande urbaine (RCI + bureaux).
 */
export class PopulationSystem {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, network: import('../systems/RoadNetwork.js').RoadNetwork, transport: any}} deps
   */
  constructor({ catalog, network, transport }) {
    this.catalog = catalog;
    this.network = network;
    this.transport = transport;
  }

  /** Satisfaction cible d'un groupe de ménages (0..100) et détail des facteurs (affiché dans l'inspecteur). */
  satisfactionFactors(state, b, def) {
    const g = state.grid;
    const i = g.idx(b.x, b.y);
    const mods = state.modifiers;
    const s = state.stats;
    const cls = b.incomeClass ?? 'mid';
    const f = {};
    f.base = 54;
    f.services =
      g.coverPolice[i] * 6 + g.coverFire[i] * 5 + g.coverHealth[i] * 8 + g.coverEducation[i] * 7 + g.coverAdmin[i] * 3;
    f.green = Math.min(1, g.green[i] / 25) * 8;
    f.pollution = -Math.min(25, g.pollution[i] * 0.55);
    f.noise = -Math.min(12, g.noise[i] * 0.3);
    f.heat = -Math.min(10, Math.max(0, g.heat[i] - 22) * 0.35);
    const age = state.time.tick - (b.deliveredTick ?? b.builtTick);
    f.power = !b.powered && age > 6 ? -25 : 0;
    f.water = !b.watered && age > 6 ? -18 : 0;
    f.commute = -Math.min(14, Math.max(0, b.commute - 14) * 0.45);
    f.unemployment = -Math.min(15, s.unemploymentRate * 45);
    const burden = b.rent / (SIM.RENT_BASE[cls] || 40) - 1;
    f.rent = -clamp(burden * (cls === 'low' ? 14 : 8), -4, 14);
    f.taxes = -(state.economy.taxes.R - 9) * 1.3;
    f.sanitation = -(state.utilities.water?.untreatedShare ?? 0) * 12;
    f.delivery = g.delivery[i] * 2;
    f.garbage = -Math.min(12, (b.garbage ?? 0) * 12);
    f.transit = Math.max(g.transitBus[i], g.transitMetro[i], g.transitRail[i]) * 3;
    f.policies = (mods['satisfaction.all'] ?? 0) + (mods[`satisfaction.${cls}`] ?? 0);
    // Sinistre en cours (inondation, incendie) : habitants évacués ou relogés
    if (b.disasterUntil > state.time.tick) f.disaster = -30;
    let total = 0;
    for (const v of Object.values(f)) total += v;
    return { total: clamp(total, 0, 100), factors: f };
  }

  update(state) {
    const cat = this.catalog;
    const g = state.grid;
    const net = this.network;
    const mods = state.modifiers;
    const st = emptyStats();
    const prev = state.stats;
    st.arrivals = prev.arrivals;
    st.departures = prev.departures;
    st.peakPopulation = prev.peakPopulation ?? 0;
    const residential = [];
    const workplaces = [];

    // 1. Ménages : satisfaction, loyers, occupation cible, âges, actifs, qualification
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      if (def.capacity.jobs) workplaces.push({ b, def });
      if (!def.capacity.residents) continue;
      residential.push({ b, def });
      const cap = def.capacity.residents;
      const cls = b.incomeClass ?? def.capacity.incomeClass;
      const i = g.idx(b.x, b.y);
      b.rent =
        SIM.RENT_BASE[cls] * (0.6 + g.landValue[i] / 70) * (mods.rentMult ?? 1) * (1 + Math.max(0, state.demand.R) / 250);

      const sat = this.satisfactionFactors(state, b, def).total;
      b.satisfaction += (sat - b.satisfaction) * 0.35;

      let target = 0;
      const building = b.constructionUntil !== undefined && !b.upgradeTo;
      if (!b.abandoned && b.access >= 0 && !building) {
        const attract = clamp((b.satisfaction - 15) / 45, 0.05, 1);
        target = cap * attract;
        if (!net.isConnectedToOutside(b.access)) target *= 0.25;
        if (state.demand.R < -30) target *= 0.85;
        if (b.disasterUntil > state.time.tick) target *= 0.4;
      }
      const delta = Math.round(target) - b.residents;
      const step = Math.max(1, Math.ceil(cap * 0.12));
      const move = clamp(delta, -step, step);
      b.residents = clamp(b.residents + move, 0, cap);
      if (move > 0) st.arrivals += move;
      else st.departures -= move;

      const young = Math.round(b.residents * SIM.AGE_PROFILE.young);
      const senior = Math.round(b.residents * (cls === 'high' ? SIM.AGE_PROFILE.senior + 0.04 : SIM.AGE_PROFILE.senior));
      const adult = Math.max(0, b.residents - young - senior);
      b.ages = { young, adult, senior };
      b.workforce = Math.round(adult * SIM.PARTICIPATION);
      const qTarget = Math.min(0.95, SIM.QUALIFICATION[cls] + 0.22 * g.coverEducation[i]);
      if (!b.qualification) b.qualification = SIM.QUALIFICATION[cls];
      b.qualification += (qTarget - b.qualification) * 0.02;

      st.population += b.residents;
      st.housingCapacity += b.abandoned ? 0 : cap;
      st.households[cls] += b.residents;
      st.ages.young += young;
      st.ages.adult += adult;
      st.ages.senior += senior;
      st.workforce += b.workforce;
    }

    // 2. Marché du travail : appariement par bassin (réseau routier) et par qualification
    const pools = new Map();
    const poolOf = (b) => {
      if (b.access < 0 || b.abandoned) return null;
      if (net.isConnectedToOutside(b.access)) return 'ext';
      return `c${net.componentOfTile(b.access)}`;
    };
    const getPool = (k) => {
      if (!pools.has(k)) pools.set(k, { workers: { low: 0, mid: 0, high: 0 }, jobs: { low: 0, mid: 0, high: 0 } });
      return pools.get(k);
    };
    for (const { b } of residential) {
      const k = poolOf(b);
      b._bracket = workerBracket(b.qualification);
      if (k) getPool(k).workers[b._bracket] += b.workforce;
      st.workersByBracket[b._bracket] += b.workforce;
    }
    for (const { b, def } of workplaces) {
      const k = poolOf(b);
      b._jb = jobBracket(def.capacity.qualification);
      const slots = b.abandoned || (b.constructionUntil !== undefined && !b.upgradeTo) ? 0 : def.capacity.jobs * (b.powered ? 1 : 0.6) * (b.disasterUntil > state.time.tick ? 0.2 : 1);
      b._slots = slots;
      if (k) getPool(k).jobs[b._jb] += slots;
      st.jobs += slots;
      st.jobsByBracket[b._jb] += slots;
    }
    const fill = new Map();
    let commutersIn = 0;
    let commutersOut = 0;
    for (const [k, p] of pools) {
      const w = { ...p.workers };
      const j = { ...p.jobs };
      const filled = { low: 0, mid: 0, high: 0 };
      const employed = { low: 0, mid: 0, high: 0 };
      const take = (wb, jb) => {
        const n = Math.min(w[wb], j[jb]);
        w[wb] -= n;
        j[jb] -= n;
        filled[jb] += n;
        employed[wb] += n;
      };
      take('high', 'high');
      take('mid', 'mid');
      take('high', 'mid');
      take('low', 'low');
      take('mid', 'low');
      take('high', 'low');
      if (k === 'ext') {
        // Navetteurs : une partie des emplois vacants est pourvue de l'extérieur, et une partie des chômeurs travaille à l'extérieur.
        for (const jb of BRACKETS) {
          const n = j[jb] * 0.25;
          filled[jb] += n;
          commutersIn += n;
        }
        for (const wb of BRACKETS) {
          const n = w[wb] * 0.3;
          employed[wb] += n;
          commutersOut += n;
          w[wb] -= n;
        }
      }
      const ratios = { jobs: {}, workers: {} };
      for (const x of BRACKETS) {
        ratios.jobs[x] = p.jobs[x] > 0 ? filled[x] / p.jobs[x] : 0;
        ratios.workers[x] = p.workers[x] > 0 ? employed[x] / p.workers[x] : 0;
        st.unemployedByBracket[x] += w[x];
      }
      fill.set(k, ratios);
    }
    for (const { b } of residential) {
      const k = poolOf(b);
      b.employed = k ? Math.round(b.workforce * fill.get(k).workers[b._bracket]) : 0;
      st.employed += b.employed;
      delete b._bracket;
    }
    for (const { b, def } of workplaces) {
      const k = poolOf(b);
      b.jobsFilled = k ? Math.min(def.capacity.jobs, Math.round(b._slots * fill.get(k).jobs[b._jb])) : 0;
      st.jobsFilled += b.jobsFilled;
      delete b._jb;
      delete b._slots;
    }
    st.unemployed = Math.max(0, st.workforce - st.employed);
    st.unemploymentRate = st.workforce > 0 ? st.unemployed / st.workforce : 0;
    st.commutersIn = Math.round(commutersIn);
    st.commutersOut = Math.round(commutersOut);

    // 3. Consommation, ventes, production industrielle
    let consumption = 0;
    for (const { b } of residential) consumption += b.residents * SIM.CONSUMPTION[b.incomeClass ?? 'mid'];
    consumption += st.commutersIn * 0.3;
    let salesCapacity = 0;
    let goods = 0;
    for (const { b, def } of workplaces) {
      if (def.category === 'commerce') salesCapacity += b.jobsFilled * SIM.SALES_PER_JOB_UNIT;
      if (def.category === 'industry') goods += (b.jobsFilled / def.capacity.jobs) * def.capacity.goods;
    }
    st.consumption = consumption;
    st.salesCapacity = salesCapacity;
    st.salesRatio = salesCapacity > 0 ? consumption / salesCapacity : consumption > 0 ? 2 : 0;
    st.goodsProduced = goods;
    st.goodsNeeded = salesCapacity * 0.5;
    const exportDemand = 120 + st.population * 0.04;
    st.goodsSoldRatio = goods > 0 ? Math.min(1, (st.goodsNeeded + exportDemand) / goods) : 1;

    // 4. Agrégats de satisfaction et de loyers
    let satSum = 0;
    let rentSum = 0;
    const byInc = { low: [0, 0], mid: [0, 0], high: [0, 0] };
    for (const { b } of residential) {
      if (!b.residents) continue;
      satSum += b.satisfaction * b.residents;
      rentSum += b.rent * b.residents;
      byInc[b.incomeClass][0] += b.satisfaction * b.residents;
      byInc[b.incomeClass][1] += b.residents;
    }
    st.satisfaction = st.population ? satSum / st.population : 50;
    st.avgRent = st.population ? rentSum / st.population : 0;
    for (const c of BRACKETS) st.satisfactionByIncome[c] = byInc[c][1] ? byInc[c][0] / byInc[c][1] : 50;
    st.housingVacancy = st.housingCapacity > 0 ? 1 - st.population / st.housingCapacity : 0;
    st.peakPopulation = Math.max(st.peakPopulation, st.population);

    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      if (def.kind === 'growable') st.buildingsByZone[def.zone] = (st.buildingsByZone[def.zone] ?? 0) + 1;
      if (b.abandoned) st.abandoned++;
    }
    st.avgLandValue = prev.avgLandValue;
    st.avgPollution = prev.avgPollution;
    st.avgHeat = prev.avgHeat;
    state.stats = st;
  }

  /** Indicateurs de demande résidentielle, commerciale, bureaux et industrielle (−100..100). */
  updateDemand(state) {
    // La ville doit être reliée au réseau régional par au moins une route construite par le joueur.
    const connected = [...this.network.outsideComponents].some((c) => this.network.componentSize[c] > 3);
    state.stats.regionConnected = connected;
    const { target } = demandBreakdown(state, connected);
    for (const k of ['R', 'C', 'O', 'I']) state.demand[k] += (target[k] - state.demand[k]) * 0.3;
  }
}

/**
 * Décomposition de la demande par secteur : chaque facteur et sa contribution (en points, −100..100).
 * Sert au calcul de la simulation et au panneau « Besoins de la ville » (même formule, aucune divergence).
 * @returns {{target: Record<'R'|'C'|'O'|'I', number>, factors: Record<'R'|'C'|'O'|'I', {label:string, value:number}[]>, connected:boolean}}
 */
export function demandBreakdown(state, connected = state.stats.regionConnected !== false) {
  const s = state.stats;
  const t = state.economy.taxes;
  const m = state.modifiers;
  const pop = s.population;
  const jobVacancy = s.jobs > 0 ? (s.jobs - s.jobsFilled) / Math.max(40, s.jobs) : 0;
  const wf = Math.max(60, s.workforce);
  const ub = s.unemployedByBracket ?? { low: 0, mid: 0, high: 0 };
  const f = { R: [], C: [], O: [], I: [] };
  const add = (k, label, value) => {
    if (Math.abs(value) >= 0.05) f[k].push({ label, value });
  };

  add('R', 'Base', 15);
  add('R', 'Emplois vacants', jobVacancy * 70);
  add('R', 'Satisfaction des habitants', (s.satisfaction - 50) * 0.7);
  add('R', 'Logements vides', -Math.max(0, s.housingVacancy - 0.05) * 90);
  add('R', 'Taxe d\'habitation', -(t.R - 9) * 3.5);
  add('R', 'Chômage', -s.unemploymentRate * 80);
  add('R', 'Jeune ville (attractivité)', pop < 300 ? 45 : pop < 1500 ? 20 : 0);

  add('C', 'Consommation / capacité de vente', (Math.min(2, s.salesRatio) - 1) * 90);
  add('C', 'Base', 8);
  add('C', 'Taxe commerciale', -(t.C - 9) * 3.5);

  add('O', 'Actifs qualifiés sans emploi', ((ub.mid + ub.high * 1.5) / wf) * 160);
  add('O', pop > 900 ? 'Taille de la ville' : 'Ville trop petite (< 900 hab.)', pop > 900 ? 12 : -25);
  add('O', 'Taxe sur les bureaux', -(t.O - 9) * 3.5);
  add('O', 'Puissance de calcul disponible', m.compute?.supply > 50 ? 6 : 0);

  add('I', 'Actifs peu qualifiés sans emploi', (ub.low / wf) * 170);
  add('I', s.goodsSoldRatio >= 0.95 ? 'Production entièrement écoulée' : 'Invendus industriels', s.goodsSoldRatio >= 0.95 ? 18 : -10);
  add('I', 'Taxe industrielle', -(t.I - 9) * 3.5);
  add('I', 'Commerces en manque de marchandises', s.goodsProduced < s.goodsNeeded ? 15 : 0);
  add('I', 'Démarrage de la ville', pop < 100 ? 20 : 0);

  const target = {};
  for (const k of ['R', 'C', 'O', 'I']) {
    let v = f[k].reduce((a, x) => a + x.value, 0);
    if (k === 'C' && pop < 80 && v > 5) {
      add('C', 'Pas encore assez d\'habitants (< 80)', 5 - v);
      v = 5;
    }
    if (!connected && v > -40) {
      add(k, 'Ville non reliée au réseau régional', -40 - v);
      v = -40;
    }
    const mod = m['demand.' + k] ?? 0;
    add(k, 'Politiques, technologies et équipements', mod);
    target[k] = clamp(v + mod, -100, 100);
  }
  return { target, factors: f, connected };
}
