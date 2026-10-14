import { SIM, dateOfTick } from './config.js';
import { emptyAccrual } from '../app/GameState.js';
import { toCents } from '../util/money.js';

/**
 * Catégories comptables (libellés affichés dans les panneaux financiers).
 */
export const CATEGORY_LABELS = {
  taxR: 'Impôt résidentiel',
  taxC: 'Fiscalité commerciale',
  taxO: 'Fiscalité des bureaux',
  taxI: 'Fiscalité industrielle',
  property: 'Taxe foncière',
  water: 'Vente d\'eau',
  power: 'Vente d\'électricité',
  logistics: 'Redevances logistiques',
  hosting: 'Hébergement de données',
  facilities: 'Recettes des équipements',
  transit: 'Billetterie des transports',
  recycling: 'Vente de matériaux recyclés',
  exportPower: 'Vente d\'électricité à la région',
  exportWater: 'Vente d\'eau à la région',
  importPower: 'Achat d\'électricité à la région',
  importWater: 'Achat d\'eau à la région',
  wasteExport: 'Traitement des déchets hors de la ville',
  transport: 'Transports en commun',
  waste: 'Gestion des déchets',
  roads: 'Voirie',
  zoning: 'Aménagement des zones',
  energy: 'Énergie',
  utilities: 'Eau et assainissement',
  water_infra: 'Eau et assainissement',
  services: 'Services publics',
  parks: 'Espaces verts',
  logistics_infra: 'Logistique',
  technology: 'Technologies',
  policies: 'Politiques publiques',
  demolition: 'Démolitions',
  clearing: 'Défrichement',
  terraforming: 'Terrassement et plantations',
  land: 'Acquisitions foncières (extensions)',
  interest: 'Charges d\'intérêts',
  loan: 'Emprunts',
  principal: 'Remboursement du capital',
  crisis: 'Crises et catastrophes'
};

/** Rattachement des catégories de bâtiments aux catégories comptables et aux modificateurs d'entretien. */
const BUILDING_ACCOUNT = {
  energy: { account: 'energy', upkeepKey: 'upkeep.utilities' },
  water: { account: 'water_infra', upkeepKey: 'upkeep.utilities' },
  services: { account: 'services', upkeepKey: 'upkeep.services' },
  parks: { account: 'parks', upkeepKey: 'upkeep.services' },
  logistics: { account: 'logistics_infra', upkeepKey: 'upkeep.services' },
  transport: { account: 'transport', upkeepKey: 'upkeep.transport' },
  waste: { account: 'waste', upkeepKey: 'upkeep.services' }
};

/** Prix de revente d'une unité de déchets recyclés (euros). */
export const RECYCLING_PRICE = 0.25;

export function accountForCategory(category) {
  return BUILDING_ACCOUNT[category]?.account ?? 'services';
}

/**
 * Système financier municipal.
 * - Tous les montants sont des entiers en centimes.
 * - Chaque mouvement de trésorerie est une transaction identifiable du journal.
 * - Le résultat comptable (avec amortissements) est distingué du flux de trésorerie.
 * - Les investissements sont atomiques : refusés en bloc si la trésorerie est insuffisante.
 */
export class EconomySystem {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, bus?: import('../app/EventBus.js').EventBus}} deps
   */
  constructor({ catalog, bus }) {
    this.catalog = catalog;
    this.bus = bus;
  }

  /** Ouvre la période comptable courante si nécessaire. */
  ensurePeriod(state) {
    const eco = state.economy;
    if (!eco.current) eco.current = this.#newPeriod(state);
    return eco.current;
  }

  #newPeriod(state) {
    const d = dateOfTick(state.time.tick);
    return {
      year: d.year,
      month: d.month,
      monthIndex: d.monthIndex,
      revenue: {},
      opex: {},
      capex: {},
      interest: 0,
      financingIn: 0,
      principal: 0,
      depreciation: 0,
      writeOffs: 0,
      cashStart: state.economy.treasury,
      cashEnd: state.economy.treasury
    };
  }

  canAfford(state, cents) {
    return cents <= 0 || state.economy.treasury >= cents;
  }

  /**
   * Enregistre une transaction et met à jour la trésorerie.
   * @param {{kind:'revenue'|'opex'|'capex'|'interest'|'loan'|'principal', category:string, label:string, amount:number, ref?:any}} t
   *   amount signé : positif = encaissement, négatif = décaissement.
   */
  post(state, t) {
    if (!Number.isInteger(t.amount)) throw new Error(`Montant non entier : ${t.amount}`);
    const eco = state.economy;
    const p = this.ensurePeriod(state);
    const tx = {
      id: eco.nextTxId++,
      tick: state.time.tick,
      kind: t.kind,
      category: t.category,
      label: t.label,
      amount: t.amount,
      ref: t.ref ?? null
    };
    eco.treasury += t.amount;
    eco.ledger.push(tx);
    if (eco.ledger.length > SIM.LEDGER_MAX) eco.ledger.splice(0, eco.ledger.length - SIM.LEDGER_MAX);

    switch (t.kind) {
      case 'revenue':
        p.revenue[t.category] = (p.revenue[t.category] ?? 0) + t.amount;
        break;
      case 'opex':
        p.opex[t.category] = (p.opex[t.category] ?? 0) - t.amount;
        break;
      case 'capex':
        p.capex[t.category] = (p.capex[t.category] ?? 0) - t.amount;
        break;
      case 'interest':
        p.interest -= t.amount;
        break;
      case 'loan':
        p.financingIn += t.amount;
        break;
      case 'principal':
        p.principal -= t.amount;
        break;
      default:
        throw new Error(`Type de transaction inconnu : ${t.kind}`);
    }
    p.cashEnd = eco.treasury;
    this.bus?.emit('economy:changed', { tx });
    return tx;
  }

  /**
   * Paiement d'un investissement (atomique). Crée l'immobilisation amortissable correspondante.
   * @returns {{ok:true, tx:any, assetId:number} | {ok:false, reason:string}}
   */
  payCapex(state, { amount, category, label, ref, lifeYears = 0 }) {
    if (!Number.isInteger(amount) || amount < 0) return { ok: false, reason: 'Montant invalide' };
    if (!this.canAfford(state, amount)) return { ok: false, reason: 'Budget insuffisant' };
    const tx = this.post(state, { kind: 'capex', category, label, amount: -amount, ref });
    let assetId = 0;
    if (lifeYears > 0 && amount > 0) {
      assetId = state.economy.nextAssetId++;
      state.economy.assets.push({
        id: assetId,
        ref,
        label,
        gross: amount,
        monthly: Math.max(1, Math.round(amount / (lifeYears * 12))),
        remaining: amount
      });
    }
    return { ok: true, tx, assetId };
  }

  /** Charge de fonctionnement immédiate (ex. démolition). Peut rendre la trésorerie négative. */
  payOpex(state, { amount, category, label, ref }) {
    if (amount <= 0) return null;
    return this.post(state, { kind: 'opex', category, label, amount: -amount, ref });
  }

  /** Annulation d'une transaction (utilisée par « Annuler ») : contre-passation à l'identique. */
  reverse(state, tx, label) {
    return this.post(state, { kind: tx.kind, category: tx.category, label, amount: -tx.amount, ref: tx.ref });
  }

  removeAsset(state, assetId) {
    const i = state.economy.assets.findIndex((a) => a.id === assetId);
    if (i >= 0) state.economy.assets.splice(i, 1);
  }

  /** Sortie d'actif (démolition) : la valeur nette comptable restante est passée en charge non décaissée. */
  disposeAsset(state, assetId) {
    const eco = state.economy;
    const i = eco.assets.findIndex((a) => a.id === assetId);
    if (i < 0) return 0;
    const nbv = eco.assets[i].remaining;
    eco.assets.splice(i, 1);
    this.ensurePeriod(state).writeOffs += nbv;
    return nbv;
  }

  /**
   * Accumule les bases fiscales et de facturation du jour.
   * Appelée une fois par tick, après la mise à jour de la population et de l'emploi.
   */
  accrueDaily(state) {
    const a = state.economy.accrual;
    const cat = this.catalog;
    let baseR = 0;
    let baseC = 0;
    let baseO = 0;
    let baseI = 0;
    let property = 0;
    let logisticsUnits = 0;
    const g = state.grid;
    const salesRatio = state.stats.salesRatio || 0;
    const goodsSold = state.stats.goodsProduced > 0 ? Math.min(1, 0.4 + 0.6 * (state.stats.goodsSoldRatio ?? 1)) : 0;

    for (const b of state.buildings.values()) {
      if (b.abandoned) continue;
      const def = cat.buildingFor(b);
      if (b.employed) baseR += b.employed * SIM.TAXABLE_INCOME[b.incomeClass ?? 'mid'];
      if (b.jobsFilled && def.kind === 'growable') {
        if (def.category === 'commerce') baseC += b.jobsFilled * SIM.VALUE_ADDED_PER_JOB.commerce * Math.min(1, salesRatio);
        else if (def.category === 'offices') baseO += b.jobsFilled * SIM.VALUE_ADDED_PER_JOB.offices;
        else if (def.category === 'industry') baseI += b.jobsFilled * SIM.VALUE_ADDED_PER_JOB.industry * goodsSold;
      }
      if (def.kind === 'growable') {
        // Valeur cadastrale : uniquement les biens privés.
        let lv = 0;
        for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) lv += g.landValue[g.idx(b.x + dx, b.y + dy)];
        property += lv * SIM.ASSESSED_VALUE_PER_POINT * (0.6 + 0.2 * def.level);
      }
      if (b.logisticsHandled) logisticsUnits += b.logisticsHandled * (def.revenue.perUnitCents > 0 ? 1 : 0);
    }
    a.days += 1;
    a.taxR += baseR;
    a.taxC += baseC;
    a.taxO += baseO;
    a.taxI += baseI;
    a.property += property;
    a.water += state.utilities.water?.consumed ?? 0;
    a.power += state.utilities.power?.consumed ?? 0;
    a.logisticsUnits += logisticsUnits;
    a.transit = (a.transit ?? 0) + (state.transit?.passengersPerDay ?? 0);
    a.transitOps = (a.transitOps ?? 0) + (state.transit?.operatingCostPerDay ?? 0);
    a.recycling = (a.recycling ?? 0) + (state.waste?.stats?.recycledPerDay ?? 0);
    // Échanges régionaux (cumuls journaliers)
    a.powerExport = (a.powerExport ?? 0) + (state.utilities.power?.exported ?? 0);
    a.powerImport = (a.powerImport ?? 0) + (state.utilities.power?.imported ?? 0);
    a.waterExport = (a.waterExport ?? 0) + (state.utilities.water?.exported ?? 0);
    a.waterImport = (a.waterImport ?? 0) + (state.utilities.water?.imported ?? 0);
    a.wasteExport = (a.wasteExport ?? 0) + (state.waste?.stats?.exportedPerDay ?? 0);
  }

  /**
   * Clôture mensuelle : recettes fiscales et de services, charges d'entretien, technologies,
   * politiques, service de la dette, amortissements. Retourne la période clôturée.
   */
  closeMonth(state) {
    const eco = state.economy;
    const cat = this.catalog;
    const mods = state.modifiers;
    const p = this.ensurePeriod(state);
    const a = eco.accrual;
    const days = Math.max(1, a.days);
    const eff = mods.taxEfficiency ?? 1;
    const t = eco.taxes;

    const revenueLines = [
      ['taxR', (a.taxR / days) * (t.R / 100) * eff],
      ['taxC', (a.taxC / days) * (t.C / 100) * eff],
      ['taxO', (a.taxO / days) * (t.O / 100) * eff],
      ['taxI', (a.taxI / days) * (t.I / 100) * eff],
      ['property', ((a.property / days) * (t.property / 100) * eff) / 12],
      ['water', (a.water / days) * eco.tariffs.water],
      ['power', (a.power / days) * eco.tariffs.power]
    ];
    // Redevances logistiques : unités traitées cumulées sur le mois
    let logisticsPerUnit = 0;
    for (const def of cat.buildings.values()) if (def.revenue.perUnitCents) logisticsPerUnit = def.revenue.perUnitCents / 100;
    revenueLines.push(['logistics', a.logisticsUnits * logisticsPerUnit]);

    // Recettes forfaitaires des équipements (hébergement de données, zoo, stade, aéroport…)
    const facilityRevenue = {};
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      const needsPower = def.networks.power > 0;
      if (def.revenue.perMonthCents && (!needsPower || b.powered) && !b.abandoned && !(b.disabledUntil > state.time.tick)) {
        const staffing = def.capacity.jobs ? Math.min(1, b.jobsFilled / def.capacity.jobs) : 1;
        const k = def.revenue.category;
        facilityRevenue[k] = (facilityRevenue[k] ?? 0) + (def.revenue.perMonthCents / 100) * staffing;
      }
    }
    for (const [k, v] of Object.entries(facilityRevenue)) revenueLines.push([k, v]);
    // Billetterie des transports en commun (voyageurs du mois × prix effectif du billet)
    const fare = Math.max(0, (eco.tariffs.transit ?? 0) * (mods['transit.fareMult'] ?? 1));
    revenueLines.push(['transit', (a.transit ?? 0) * fare]);
    revenueLines.push(['recycling', (a.recycling ?? 0) * RECYCLING_PRICE]);
    // Ventes à la région (volumes moyens du mois, comme les ventes aux habitants)
    revenueLines.push(['exportPower', ((a.powerExport ?? 0) / days) * SIM.TRADE.power.sell]);
    revenueLines.push(['exportWater', ((a.waterExport ?? 0) / days) * SIM.TRADE.water.sell]);

    for (const [category, euros] of revenueLines) {
      const amount = toCents(euros);
      if (amount > 0) this.post(state, { kind: 'revenue', category, label: CATEGORY_LABELS[category], amount });
    }

    // Charges d'entretien : bâtiments publics
    const upkeep = {};
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      if (def.kind !== 'plop' || !def.upkeepCents) continue;
      const acc = BUILDING_ACCOUNT[def.category] ?? { account: 'services', upkeepKey: 'upkeep.services' };
      upkeep[acc.account] = (upkeep[acc.account] ?? 0) + def.upkeepCents * (mods[acc.upkeepKey] ?? 1);
    }
    // Voirie
    let roadUpkeep = 0;
    const g = state.grid;
    for (let i = 0; i < g.size; i++) {
      const code = g.road[i];
      if (code) {
        const r = cat.roadByCode(code);
        roadUpkeep += g.bridge[i] ? r.bridgeUpkeepCents : r.upkeepCents;
      }
    }
    upkeep.roads = roadUpkeep * (mods['upkeep.roads'] ?? 1);

    // Exploitation des transports en commun : proportionnelle au nombre de voyageurs
    upkeep.transport = (upkeep.transport ?? 0) + Math.round((a.transitOps ?? 0) * 100);

    // Achats à la région : prix prohibitifs, comptabilisés à part pour rester visibles
    const purchases = [
      ['importPower', ((a.powerImport ?? 0) / days) * SIM.TRADE.power.buy],
      ['importWater', ((a.waterImport ?? 0) / days) * SIM.TRADE.water.buy],
      ['wasteExport', (a.wasteExport ?? 0) * SIM.TRADE.waste.buy]
    ];
    for (const [category, euros] of purchases) {
      const amount = toCents(euros);
      if (amount > 0) this.post(state, { kind: 'opex', category, label: CATEGORY_LABELS[category], amount: -amount });
    }

    for (const [category, cents] of Object.entries(upkeep)) {
      const amount = Math.round(cents);
      if (amount > 0) this.post(state, { kind: 'opex', category, label: `Entretien — ${CATEGORY_LABELS[category]}`, amount: -amount });
    }

    // Technologies (coûts d'exploitation) et politiques
    let techCost = 0;
    for (const id of Object.keys(state.tech.researched)) techCost += cat.techById.get(id)?.upkeepCents ?? 0;
    if (techCost) this.post(state, { kind: 'opex', category: 'technology', label: 'Exploitation des systèmes IA', amount: -techCost });
    let polCost = 0;
    for (const id of Object.keys(state.policies.active)) polCost += cat.policyById.get(id)?.monthlyCostCents ?? 0;
    if (polCost) this.post(state, { kind: 'opex', category: 'policies', label: 'Politiques publiques', amount: -polCost });

    // Service de la dette (annuités constantes)
    for (const loan of eco.loans) {
      if (loan.monthsLeft <= 0) continue;
      const interest = Math.round((loan.remaining * loan.rateAnnual) / 12);
      const principal = Math.min(loan.remaining, loan.payment - interest);
      this.post(state, { kind: 'interest', category: 'interest', label: `Intérêts — emprunt n°${loan.id}`, amount: -interest, ref: loan.id });
      this.post(state, { kind: 'principal', category: 'principal', label: `Capital — emprunt n°${loan.id}`, amount: -principal, ref: loan.id });
      loan.remaining -= principal;
      loan.monthsLeft -= 1;
    }
    eco.loans = eco.loans.filter((l) => l.monthsLeft > 0 && l.remaining > 0);

    // Amortissements (charge non décaissée)
    let dep = 0;
    for (const asset of eco.assets) {
      const m = Math.min(asset.monthly, asset.remaining);
      asset.remaining -= m;
      dep += m;
    }
    eco.assets = eco.assets.filter((x) => x.remaining > 0);
    p.depreciation += dep;

    // Clôture
    p.cashEnd = eco.treasury;
    p.population = state.stats.population;
    eco.periods.push(p);
    if (eco.periods.length > SIM.PERIODS_MAX) eco.periods.shift();
    eco.monthsNegative = eco.treasury < 0 ? eco.monthsNegative + 1 : 0;
    eco.accrual = emptyAccrual();
    eco.current = this.#newPeriod(state);
    return p;
  }

  /** Synthèse d'une période : résultat comptable et flux de trésorerie. */
  static summarize(p) {
    if (!p) return null;
    const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
    const revenues = sum(p.revenue);
    const opex = sum(p.opex);
    const capex = sum(p.capex);
    const operatingResult = revenues - opex;
    const netResult = operatingResult - p.depreciation - p.writeOffs - p.interest;
    const cashOperating = revenues - opex - p.interest;
    const cashInvesting = -capex;
    const cashFinancing = p.financingIn - p.principal;
    return {
      revenues,
      opex,
      capex,
      operatingResult,
      depreciation: p.depreciation,
      writeOffs: p.writeOffs,
      interest: p.interest,
      netResult,
      cashOperating,
      cashInvesting,
      cashFinancing,
      cashChange: cashOperating + cashInvesting + cashFinancing
    };
  }

  /** Capacité d'emprunt restante (centimes). */
  debtCapacity(state) {
    const eco = state.economy;
    const last = eco.periods.slice(-3);
    const avgRevenue = last.length ? last.reduce((s, p) => s + EconomySystem.summarize(p).revenues, 0) / last.length : 0;
    const max = Math.max(toCents(SIM.MIN_DEBT_CAPACITY_EUROS), avgRevenue * SIM.MAX_DEBT_MONTHS_OF_REVENUE);
    const outstanding = eco.loans.reduce((s, l) => s + l.remaining, 0);
    return Math.max(0, Math.round(max - outstanding));
  }

  /**
   * Note de crédit de la ville (façon agence de notation), calculée sur les 3 derniers mois clos.
   * Critères inspirés de l'analyse financière des collectivités :
   *  - capacité de désendettement = dette / épargne brute annuelle (seuil d'alerte ≈ 12 ans) ;
   *  - poids de la dette dans les recettes annuelles ;
   *  - trésorerie négative (et sa durée) ;
   *  - résultat net déficitaire.
   * La note fixe la prime de risque du taux proposé aux nouveaux emprunts.
   * @returns {{grade:string, score:number, spread:number, provisional:boolean, debt:number, years:number|null, factors:{label:string, value:string, penalty:number}[]}}
   */
  creditRating(state) {
    const eco = state.economy;
    const debt = eco.loans.reduce((s, l) => s + l.remaining, 0);
    const last = eco.periods.slice(-3).map((p) => EconomySystem.summarize(p));
    const avg = (k) => (last.length ? last.reduce((s, p) => s + p[k], 0) / last.length : 0);
    const revenues = avg('revenues') * 12;
    const grossSavings = avg('operatingResult') * 12; // épargne brute annuelle (avant intérêts)
    const net = avg('netResult');
    const factors = [];
    let score = 100;
    const penal = (label, value, penalty) => {
      const p = Math.round(Math.max(0, penalty));
      factors.push({ label, value, penalty: p });
      score -= p;
    };
    let years = null;
    if (debt <= 0) penal('Capacité de désendettement', 'aucune dette', 0);
    else if (grossSavings <= 0) penal('Capacité de désendettement', 'épargne brute négative', 45);
    else {
      years = debt / grossSavings;
      const p = years <= 5 ? 0 : years <= 8 ? ((years - 5) / 3) * 10 : years <= 12 ? 10 + ((years - 8) / 4) * 20 : Math.min(45, 30 + ((years - 12) / 8) * 15);
      penal('Capacité de désendettement', `${years.toFixed(1).replace('.', ',')} ans`, p);
    }
    const ratio = revenues > 0 ? debt / revenues : debt > 0 ? 2 : 0;
    penal('Dette / recettes annuelles', `${Math.round(ratio * 100)} %`, ratio <= 0.5 ? 0 : Math.min(20, ((ratio - 0.5) / 1) * 20));
    penal('Trésorerie', eco.treasury < 0 ? `négative depuis ${eco.monthsNegative} mois` : 'positive', eco.treasury < 0 ? Math.min(25, 10 + 5 * eco.monthsNegative) : 0);
    penal('Résultat net mensuel', net < 0 ? 'déficitaire' : 'excédentaire', last.length && net < 0 ? 10 : 0);
    const provisional = last.length === 0;
    if (provisional) score = Math.min(score, 72);
    score = Math.max(0, Math.min(100, Math.round(score)));
    const scale = [
      [90, 'AAA', -0.008], [80, 'AA', -0.005], [70, 'A', -0.002], [60, 'BBB', 0],
      [48, 'BB', 0.01], [36, 'B', 0.02], [24, 'CCC', 0.035], [-1, 'D', 0.06]
    ];
    const [, grade, spread] = scale.find(([min]) => score >= min);
    return { grade, score, spread, provisional, debt, years, factors };
  }

  /** Taux annuel proposé : taux de base + prime de risque liée à la note + poids de l'encours. */
  loanRate(state) {
    const outstanding = state.economy.loans.reduce((s, l) => s + l.remaining, 0);
    const { spread } = this.creditRating(state);
    return Math.round(Math.max(0.012, 0.032 + spread + outstanding / 1e9) * 10000) / 10000;
  }

  /** Montant maximal empruntable maintenant, arrondi à l'euro inférieur (en euros). */
  maxLoanEuros(state) {
    return Math.floor(this.debtCapacity(state) / 100);
  }

  /**
   * Souscrit un emprunt à annuités constantes.
   * @returns {{ok:boolean, reason?:string, loan?:any}}
   */
  takeLoan(state, amountCents, months) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, reason: 'Montant invalide' };
    if (amountCents > this.debtCapacity(state)) return { ok: false, reason: 'Capacité d\'emprunt dépassée' };
    const rateAnnual = this.loanRate(state);
    const r = rateAnnual / 12;
    const payment = Math.ceil((amountCents * r) / (1 - Math.pow(1 + r, -months)));
    const loan = {
      id: state.economy.nextLoanId++,
      principal: amountCents,
      remaining: amountCents,
      rateAnnual,
      months,
      monthsLeft: months,
      payment,
      startTick: state.time.tick
    };
    state.economy.loans.push(loan);
    this.post(state, { kind: 'loan', category: 'loan', label: `Emprunt n°${loan.id} (${months} mois)`, amount: amountCents, ref: loan.id });
    return { ok: true, loan };
  }

  /**
   * Prévision de trésorerie à moyen terme, fondée sur les trois derniers mois clôturés
   * (tendance bornée) et sur l'échéancier réel des emprunts. Hors investissements futurs.
   * @returns {{months: {monthIndex:number, revenues:number, opex:number, debtService:number, treasury:number}[], trend:number}}
   */
  forecast(state, horizon = 12) {
    const eco = state.economy;
    const last = eco.periods.slice(-3).map((p) => EconomySystem.summarize(p));
    let revenues;
    let opex;
    let trend = 0;
    if (last.length) {
      revenues = last.reduce((s, x) => s + x.revenues, 0) / last.length;
      opex = last.reduce((s, x) => s + x.opex, 0) / last.length;
      if (last.length >= 2 && last[0].revenues > 0) {
        trend = Math.pow(last[last.length - 1].revenues / last[0].revenues, 1 / (last.length - 1)) - 1;
        trend = Math.max(-0.05, Math.min(0.05, trend));
      }
    } else {
      revenues = 0;
      opex = 0;
    }
    const loans = eco.loans.map((l) => ({ ...l }));
    let treasury = eco.treasury;
    const months = [];
    const startIndex = Math.floor(state.time.tick / SIM.DAYS_PER_MONTH) + 1;
    for (let m = 0; m < horizon; m++) {
      const rev = revenues * Math.pow(1 + trend, m + 1);
      let debtService = 0;
      for (const l of loans) {
        if (l.monthsLeft <= 0) continue;
        const interest = Math.round((l.remaining * l.rateAnnual) / 12);
        const principal = Math.min(l.remaining, l.payment - interest);
        debtService += interest + principal;
        l.remaining -= principal;
        l.monthsLeft--;
      }
      treasury += Math.round(rev - opex - debtService);
      months.push({ monthIndex: startIndex + m, revenues: Math.round(rev), opex: Math.round(opex), debtService, treasury });
    }
    return { months, trend };
  }
}
