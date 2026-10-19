import { SIM } from './config.js';
import { EnvironmentSystem } from './EnvironmentSystem.js';
import { isOperational } from './Modifiers.js';

/** Déchets produits par jour (unités) par habitant ou par emploi occupé. */
export const WASTE_RATES = { residents: 0.1, commerce: 0.15, offices: 0.08, industry: 0.3, other: 0.05 };

/** Ordre de traitement : les filières les plus vertueuses d'abord, la décharge en dernier recours. */
export const PROCESS_ORDER = ['recycling', 'valorisation', 'biogas', 'incinerator', 'landfill'];

export const WASTE_KIND_LABELS = {
  recycling: 'Recyclage',
  valorisation: 'Valorisation IA',
  biogas: 'Méthanisation',
  incinerator: 'Incinération',
  landfill: 'Décharge'
};

/**
 * Gestion des déchets.
 * 1. Chaque bâtiment produit des déchets selon ses habitants ou ses emplois.
 * 2. Les déchets ne sont collectés que dans le rayon d'action des installations qui disposent de bennes
 *    (centre de collecte, décharge, incinérateur, centre de valorisation), dans la limite de leur capacité.
 * 3. Les déchets collectés sont traités par filière (recyclage, méthanisation, incinération, décharge),
 *    dans la limite des capacités de traitement. Une décharge se remplit et finit par être saturée.
 * 4. Les déchets non collectés s'accumulent : baisse de la satisfaction, de la valeur foncière, pollution,
 *    et blocage de l'évolution des bâtiments.
 * L'incinération, la méthanisation et la valorisation produisent de l'électricité (lue par UtilitySystem).
 */
export class WasteSystem {
  /** @param {{catalog: import('../data/Catalog.js').Catalog, bus?: any}} deps */
  constructor({ catalog, bus }) {
    this.catalog = catalog;
    this.bus = bus;
  }

  /** Production journalière d'un bâtiment (unités/jour), avant politiques. */
  generation(b, def) {
    if (b.abandoned) return 0;
    if (def.capacity.residents) return b.residents * WASTE_RATES.residents;
    if (def.capacity.waste) return 0;
    const jobs = b.jobsFilled ?? 0;
    const rate = WASTE_RATES[def.category] ?? WASTE_RATES.other;
    return jobs * rate;
  }

  /**
   * @param {import('../app/GameState.js').GameState} state
   * @param {number} days nombre de jours écoulés depuis la dernière mise à jour
   */
  update(state, days) {
    const g = state.grid;
    const cat = this.catalog;
    const mods = state.modifiers;
    g.wasteCover.fill(0);

    // Installations : couverture de collecte et capacités
    const facilities = [];
    let collectCap = 0;
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      const w = def.capacity.waste;
      if (!w) continue;
      const active = isOperational(state, b) && b.access >= 0 && (def.networks.power === 0 || b.powered);
      const staffing = def.capacity.jobs ? Math.min(1, 0.25 + (b.jobsFilled / def.capacity.jobs) * 0.75) : 1;
      const f = { b, def, w, active, staffing };
      facilities.push(f);
      b.wasteProcessed = 0;
      if (!active) continue;
      if (w.collect) {
        collectCap += w.collect * staffing * (mods['waste.collectMult'] ?? 1);
        // v0.5 : collecte complète jusqu'aux 4/5 du rayon (au lieu des 3/5), puis dégressive
        EnvironmentSystem.splat(g, g.wasteCover, b.x + (b.w - 1) / 2, b.y + (b.h - 1) / 2, 5 * staffing, w.collectRadius ?? 8);
      }
    }
    for (let i = 0; i < g.size; i++) if (g.wasteCover[i] > 1) g.wasteCover[i] = 1;

    // Production et déchets collectables (dans la zone couverte)
    const genMult = mods['waste.generationMult'] ?? 1;
    const items = [];
    let generated = 0;
    let collectable = 0;
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      const gen = this.generation(b, def) * genMult;
      if (gen <= 0) {
        b.garbage = 0;
        b.wasteCollectedRatio = 1;
        continue;
      }
      const cover = g.wasteCover[g.idx(b.x + ((b.w - 1) >> 1), b.y + ((b.h - 1) >> 1))];
      const c = gen * Math.min(1, cover);
      generated += gen;
      collectable += c;
      items.push({ b, gen, c });
    }

    // Capacités de traitement (la décharge est limitée par sa place restante)
    const capByKind = {};
    for (const f of facilities) {
      if (!f.active || !f.w.process) continue;
      let cap = f.w.process * f.staffing * (mods['waste.processMult'] ?? 1);
      if (f.w.kind === 'landfill') {
        const left = Math.max(0, (f.w.storage ?? 0) - (f.b.landfillUsed ?? 0));
        cap = Math.min(cap, left / Math.max(1, days));
      }
      f.cap = cap;
      capByKind[f.w.kind] = (capByKind[f.w.kind] ?? 0) + cap;
    }
    const processCap = Object.values(capByKind).reduce((s, v) => s + v, 0);
    // Traitement hors de la ville (prix prohibitif) : les bennes déposent le surplus dans une installation
    // régionale, si la ville est reliée à l'autoroute et dans la limite de l'interconnexion.
    let exported = 0;
    if (state.trade?.waste?.buy && state.entries?.length) {
      const surplus = Math.min(collectable, collectCap) - processCap;
      if (surplus > 0) exported = Math.min(surplus, Math.max(SIM.TRADE.importMin, SIM.TRADE.importMaxShare * generated));
    }
    const collected = Math.min(collectable, collectCap, processCap + exported);
    const r = collectable > 0 ? collected / collectable : 0;

    // Effet sur les bâtiments : part collectée et accumulation des déchets en souffrance
    for (const { b, gen, c } of items) {
      const ratio = (c * r) / gen;
      b.wasteCollectedRatio = ratio;
      const target = 1 - ratio; // en mois de déchets accumulés
      const k = Math.min(1, days / 30);
      b.garbage = (b.garbage ?? 0) + (target - (b.garbage ?? 0)) * k;
    }
    g.garbage.fill(0);
    for (const { b } of items) {
      for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) g.garbage[g.idx(b.x + dx, b.y + dy)] = b.garbage;
    }

    // Répartition du traitement par filière
    const byKind = {};
    let remaining = collected;
    let recycled = 0;
    let power = 0;
    let landfillUsed = 0;
    let landfillCap = 0;
    const recycleMult = mods['waste.recycleMult'] ?? 1;
    for (const kind of PROCESS_ORDER) {
      for (const f of facilities.filter((x) => x.w.kind === kind).sort((a, z) => a.b.id - z.b.id)) {
        if (kind === 'landfill') landfillCap += f.w.storage ?? 0;
        const take = f.active ? Math.min(remaining, f.cap ?? 0) : 0;
        remaining -= take;
        f.b.wasteProcessed = take;
        byKind[kind] = (byKind[kind] ?? 0) + take;
        if (f.w.revenuePerUnit) recycled += take * recycleMult * (f.w.revenuePerUnit / 0.25);
        if (f.w.powerPerUnit) power += take * f.w.powerPerUnit;
        if (kind === 'landfill') {
          const before = f.b.landfillUsed ?? 0;
          f.b.landfillUsed = Math.min(f.w.storage, before + take * days);
          if (before < f.w.storage && f.b.landfillUsed >= f.w.storage) {
            this.bus?.emit('notify', { level: 'warning', message: 'Décharge pleine : elle n\'accepte plus de déchets', x: f.b.x, y: f.b.y, key: `landfill-${f.b.id}` });
          }
        }
        if (kind === 'landfill') landfillUsed += f.b.landfillUsed ?? 0;
      }
    }

    state.waste.stats = {
      generated,
      collectable,
      collected,
      uncollected: Math.max(0, generated - collected),
      coverage: generated > 0 ? collectable / generated : 1,
      collectionRate: generated > 0 ? collected / generated : 1,
      collectCap,
      processCap,
      byKind,
      recycledPerDay: recycled,
      powerFromWaste: power,
      landfillUsed,
      landfillCapacity: landfillCap,
      facilities: facilities.length,
      exportedPerDay: Math.max(0, remaining),
      limitedBy: collected >= generated - 1e-9 ? null : collected >= collectable - 1e-9 ? 'coverage' : collectCap <= processCap ? 'collection' : 'processing'
    };
  }
}
