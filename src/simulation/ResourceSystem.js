import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';
import { toCents } from '../util/money.js';

/**
 * Ressources de la ville (v0.7) : céréales et cultures, élevage (viande, lait), pétrole, gaz.
 *
 * - Production (tonnes par mois) : fermes et fermes d'élevage (zone agricole), puits de pétrole et de gaz
 *   (zone d'extraction), méthaniseur (biogaz) ; proportionnelle au personnel en poste.
 * - Besoins : alimentation des habitants, carburants et matières de l'industrie, chauffage au gaz (saisonnier)
 *   et centrales à gaz (selon leur production).
 * - Chaque mois, le déficit est importé : la ville paie un surcoût d'importation (logistique, sécurisation des
 *   approvisionnements). L'excédent est revendu à la région : la ville perçoit des redevances, avec un marché
 *   régional limité (rendements décroissants au-delà de sa profondeur).
 * - Les cours évoluent chaque mois (marche aléatoire bornée, déterministe) ; un choc pétrolier ou gazier peut
 *   faire flamber un cours pendant six mois.
 */

export const RESOURCES = {
  grain: { label: 'Céréales et cultures', short: 'Cultures', unit: 't', importCost: 45, royalty: 12 },
  livestock: { label: 'Élevage (viande, lait)', short: 'Élevage', unit: 't', importCost: 60, royalty: 18 },
  oil: { label: 'Pétrole', short: 'Pétrole', unit: 't', importCost: 80, royalty: 30 },
  gas: { label: 'Gaz naturel', short: 'Gaz', unit: 't', importCost: 55, royalty: 20 }
};
export const RESOURCE_KEYS = Object.keys(RESOURCES);

/** Besoins pour 1 000 habitants et par mois (tonnes). */
export const NEEDS_PER_1000 = { grain: 6, livestock: 4, oil: 3, gas: 5 };
/** Pétrole consommé par emploi industriel pourvu (tonnes par mois). */
export const OIL_PER_INDUSTRY_JOB = 0.04;
/** Gaz consommé par unité produite par une centrale à gaz (tonnes par mois). */
export const GAS_PER_POWER_UNIT = 0.03;
const HEATING_SEASON = [1.8, 1.8, 1.4, 1, 0.6, 0.4, 0.4, 0.4, 0.6, 1, 1.4, 1.8];

export function defaultResources() {
  const index = {};
  for (const k of RESOURCE_KEYS) index[k] = 1;
  return { index, shock: null, stats: null };
}

export class ResourceSystem {
  /** @param {{catalog:any, economy:any, bus?:any}} deps */
  constructor({ catalog, economy, bus }) {
    this.catalog = catalog;
    this.economy = economy;
    this.bus = bus;
  }

  /** Production, besoins et solde du mois en cours (sans effet sur l'état). */
  balance(state) {
    const cat = this.catalog;
    const t = state.time.tick;
    const prod = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0]));
    const producers = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0]));
    let industryJobs = 0;
    let gasPower = 0;
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      if (b.abandoned || b.ruins || b.disabledUntil > t) continue;
      const staffing = def.capacity.jobs ? Math.min(1, (b.jobsFilled ?? 0) / def.capacity.jobs) : 1;
      const r = def.capacity.resources;
      if (r) {
        for (const [k, v] of Object.entries(r)) {
          prod[k] += v * staffing;
          if (staffing > 0) producers[k]++;
        }
      }
      if (def.kind === 'growable' && def.zone === 'I') industryJobs += b.jobsFilled ?? 0;
      if (def.id === 'power_gas') gasPower += b.output ?? 0;
    }
    const pop = state.stats.population ?? 0;
    const month = Math.floor(t / SIM.DAYS_PER_MONTH) % 12;
    const k = pop / 1000;
    const need = {
      grain: NEEDS_PER_1000.grain * k,
      livestock: NEEDS_PER_1000.livestock * k,
      oil: NEEDS_PER_1000.oil * k * (state.modifiers?.['resources.oilMult'] ?? 1) + industryJobs * OIL_PER_INDUSTRY_JOB,
      gas: NEEDS_PER_1000.gas * k * HEATING_SEASON[month] + gasPower * GAS_PER_POWER_UNIT
    };
    const rows = {};
    const index = state.resources?.index ?? {};
    for (const r of RESOURCE_KEYS) {
      const spec = RESOURCES[r];
      const p = round(prod[r]);
      const n = round(need[r]);
      const bal = round(p - n);
      const price = index[r] ?? 1;
      const depth = 300 + n;
      const importCents = bal < 0 ? toCents(-bal * spec.importCost * price) : 0;
      const exportCents = bal > 0 ? toCents(spec.royalty * price * depth * Math.log1p(bal / depth)) : 0;
      rows[r] = { production: p, need: n, balance: bal, price: Math.round(price * 100) / 100, importCents, exportCents, producers: producers[r] };
    }
    return { rows, detail: { industryJobs, gasPower: Math.round(gasPower) } };
  }

  /** Clôture mensuelle (appelée avant la clôture des comptes). */
  monthly(state) {
    state.resources ??= defaultResources();
    const R = state.resources;
    const m = Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);
    const seed = state.meta?.seed ?? 2030;
    // Évolution des cours (marche aléatoire bornée) et chocs
    for (const [j, r] of RESOURCE_KEYS.entries()) {
      const step = (hash2(m, j, seed ^ 0x5e5) - 0.5) * 0.12;
      R.index[r] = Math.round(Math.max(0.75, Math.min(1.35, (R.index[r] ?? 1) + step + (1 - (R.index[r] ?? 1)) * 0.08)) * 1000) / 1000;
    }
    if (R.shock && m >= R.shock.until) {
      this.#notify(state, 'info', `Le cours du ${RESOURCES[R.shock.resource].label.toLowerCase()} revient à la normale.`);
      R.shock = null;
    }
    if (!R.shock && m > 24 && hash2(m, 99, seed ^ 0x5e6) < 0.02) {
      const resource = hash2(m, 98, seed) < 0.6 ? 'oil' : 'gas';
      R.shock = { resource, until: m + 6, mult: 1.6 };
      this.#notify(state, 'warning', `⛽ Choc ${resource === 'oil' ? 'pétrolier' : 'gazier'} : le cours du ${RESOURCES[resource].label.toLowerCase()} bondit de 60 % pour six mois. Les importations coûtent plus cher, les exportations rapportent davantage.`);
    }
    const saved = { ...R.index };
    if (R.shock) R.index[R.shock.resource] = Math.round(R.index[R.shock.resource] * R.shock.mult * 1000) / 1000;
    const { rows, detail } = this.balance(state);
    R.index = saved;
    let imp = 0;
    let exp = 0;
    for (const r of RESOURCE_KEYS) {
      imp += rows[r].importCents;
      exp += rows[r].exportCents;
    }
    if (imp > 0) this.economy.post(state, { kind: 'opex', category: 'resourcesImport', label: 'Importations de ressources (surcoût)', amount: -imp });
    if (exp > 0) this.economy.post(state, { kind: 'revenue', category: 'resourcesExport', label: 'Redevances sur les ressources exportées', amount: exp });
    const food = rows.grain.need + rows.livestock.need;
    const foodSelf = food > 0 ? Math.min(rows.grain.production, rows.grain.need) / Math.max(1, food) + Math.min(rows.livestock.production, rows.livestock.need) / Math.max(1, food) : 0;
    R.stats = { month: m, rows, detail, importCents: imp, exportCents: exp, foodSelf: Math.round(foodSelf * 100) / 100, shock: R.shock ? { ...R.shock } : null };
  }

  #notify(state, level, message) {
    const entry = { tick: state.time.tick, level, message, kind: 'resources' };
    state.events.history.push(entry);
    if (state.events.history.length > 80) state.events.history.shift();
    this.bus?.emit('notify', entry);
  }
}

function round(v) {
  return Math.round(v * 10) / 10;
}
