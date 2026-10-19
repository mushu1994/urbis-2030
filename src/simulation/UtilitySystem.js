/**
 * Réseaux d'énergie et d'eau.
 * - Électricité : les routes, bâtiments et lignes électriques contigus forment des réseaux.
 *   Chaque réseau compare sa capacité (production + déstockage) à sa demande. En cas de déficit,
 *   les consommateurs sont délestés par ordre de priorité (services d'abord, centres de données en dernier).
 * - Eau : canalisations le long des routes et à travers les bâtiments. Les pompes nécessitent de l'électricité.
 * - Assainissement : la part d'eaux usées non traitée dégrade la santé publique (satisfaction).
 */

import { SIM } from './config.js';

/** Volume importable dans une composante reliée à la région. */
function importCap(demand) {
  return Math.max(SIM.TRADE.importMin, SIM.TRADE.importMaxShare * demand);
}

const PRIORITY = {
  services: 0,
  water: 1,
  logistics: 2,
  residential_low: 3,
  residential_high: 3,
  commerce: 4,
  offices: 5,
  industry: 6,
  energy: 7,
  parks: 8
};

export class UtilitySystem {
  /** @param {{catalog: import('../data/Catalog.js').Catalog, bus?: any}} deps */
  constructor({ catalog, bus }) {
    this.catalog = catalog;
    this.bus = bus;
    this.compPower = new Int32Array(0);
    this.compWater = new Int32Array(0);
  }

  /** Activité d'un bâtiment (0..1) : module la consommation des ressources. */
  activity(b, def) {
    if (b.abandoned) return 0;
    // Chantier d'un bâtiment neuf : pas encore raccordé
    if (b.constructionUntil !== undefined && !b.upgradeTo) return 0;
    if (def.capacity.residents) return Math.max(0.25, b.residents / def.capacity.residents);
    if (def.capacity.jobs) return Math.max(0.35, b.jobsFilled / def.capacity.jobs);
    return 1;
  }

  /**
   * Composantes connexes des cases conductrices (BFS 4-connexe).
   * @param {(i:number)=>boolean} conducts
   */
  #components(state, conducts, out) {
    const g = state.grid;
    out.fill(-1);
    const stack = new Int32Array(g.size);
    const nb = new Int32Array(4);
    let comp = 0;
    for (let s = 0; s < g.size; s++) {
      if (out[s] >= 0 || !conducts(s)) continue;
      let top = 0;
      stack[top++] = s;
      out[s] = comp;
      while (top) {
        const i = stack[--top];
        const c = g.neighbors4(i, nb);
        for (let k = 0; k < c; k++) {
          const o = nb[k];
          if (out[o] < 0 && conducts(o)) {
            out[o] = comp;
            stack[top++] = o;
          }
        }
      }
      comp++;
    }
    return comp;
  }

  update(state) {
    const g = state.grid;
    const cat = this.catalog;
    const mods = state.modifiers;
    if (this.compPower.length !== g.size) {
      this.compPower = new Int32Array(g.size);
      this.compWater = new Int32Array(g.size);
    }
    const isLine = (i) => {
      const id = g.building[i];
      return id && state.buildings.get(id)?.defId === 'power_line';
    };
    const nPower = this.#components(state, (i) => g.road[i] > 0 || g.building[i] > 0, this.compPower);
    const nWater = this.#components(state, (i) => g.road[i] > 0 || (g.building[i] > 0 && !isLine(i)), this.compWater);

    // Composantes reliées à la région par l'accès autoroutier (interconnexion électrique et hydraulique)
    const trade = state.trade ?? { power: {}, water: {}, waste: {} };
    const regionPower = new Uint8Array(nPower);
    const regionWater = new Uint8Array(nWater);
    for (const e of state.entries ?? []) {
      if (this.compPower[e] >= 0) regionPower[this.compPower[e]] = 1;
      if (this.compWater[e] >= 0) regionWater[this.compWater[e]] = 1;
    }

    const buildings = [...state.buildings.values()];
    const defs = buildings.map((b) => cat.buildingFor(b));

    // ── Électricité ──
    const supply = new Float64Array(nPower);
    const demand = new Float64Array(nPower);
    const discharge = new Float64Array(nPower);
    const consumers = [];
    const batteries = [];
    for (let k = 0; k < buildings.length; k++) {
      const b = buildings[k];
      const def = defs[k];
      const c = this.compPower[g.idx(b.x, b.y)];
      b._pc = c;
      const cap = def.capacity;
      if (cap.powerOutput || cap.waste?.powerPerUnit) b.output = 0;
      const disabled = b.disabledUntil > state.time.tick;
      if (cap.waste?.powerPerUnit && !b.abandoned && !disabled) {
        // Valorisation énergétique : la production suit le volume de déchets traité
        b.output = (b.wasteProcessed ?? 0) * cap.waste.powerPerUnit * (mods['power.outputMult'] ?? 1);
        supply[c] += b.output;
      }
      if (cap.powerOutput && !b.abandoned && !disabled) {
        let out = cap.powerOutput;
        if (cap.powerSource === 'solar') out *= mods.solarFactor ?? 1;
        if (cap.powerSource === 'wind') out *= (mods.windFactor ?? 1) * (1 + 0.15 * g.altitude[g.idx(b.x, b.y)]);
        if (cap.jobs) out *= 0.5 + 0.5 * Math.min(1, b.jobsFilled / cap.jobs);
        out *= mods['power.outputMult'] ?? 1;
        b.output = out;
        supply[c] += out;
      }
      if (cap.powerStorage) {
        b.charge = b.charge ?? 0;
        batteries.push(b);
        discharge[c] += Math.min(b.charge, cap.powerDischarge);
      }
      const need = def.networks.power * this.activity(b, def) * (def.kind === 'growable' ? mods.powerDemandMult ?? 1 : 1);
      b.powerNeed = need;
      if (need > 0) {
        demand[c] += need;
        consumers.push({ b, def, need, c });
      }
    }

    // Délestage par priorité si nécessaire
    const available = new Float64Array(nPower);
    const imported = new Float64Array(nPower);
    for (let c = 0; c < nPower; c++) {
      const fromBattery = Math.min(discharge[c], Math.max(0, demand[c] - supply[c]));
      // Achat à la région en dernier recours (après les batteries), dans la limite de l'interconnexion
      const deficit = demand[c] - supply[c] - fromBattery;
      if (deficit > 0 && regionPower[c] && trade.power?.buy) imported[c] = Math.min(deficit, importCap(demand[c]));
      available[c] = supply[c] + fromBattery + imported[c];
    }
    consumers.sort((a, z) => (PRIORITY[a.def.category] ?? 5) - (PRIORITY[z.def.category] ?? 5) || a.b.id - z.b.id);
    const used = new Float64Array(nPower);
    let unpowered = 0;
    for (const x of consumers) {
      if (used[x.c] + x.need <= available[x.c] + 1e-9) {
        used[x.c] += x.need;
        x.b.powered = true;
      } else {
        x.b.powered = false;
        unpowered++;
      }
    }
    for (let k = 0; k < buildings.length; k++) {
      if (!(buildings[k].powerNeed > 0)) buildings[k].powered = true;
    }

    // Batteries : charge des excédents, décharge des déficits
    const intake = new Float64Array(nPower);
    for (const bat of batteries) {
      const def = cat.buildingFor(bat);
      const c = bat._pc;
      const surplus = supply[c] - demand[c];
      if (surplus > 0 && bat.charge < def.capacity.powerStorage) intake[c] += Math.min(surplus, def.capacity.powerDischarge);
      const share = discharge[c] > 0 ? Math.min(bat.charge, def.capacity.powerDischarge) / discharge[c] : 0;
      if (surplus > 0) bat.charge = Math.min(def.capacity.powerStorage, bat.charge + Math.min(surplus, def.capacity.powerDischarge) * 2);
      else bat.charge = Math.max(0, bat.charge - Math.min(-surplus, discharge[c]) * share * 2);
    }

    // Couche « alimenté » : cases conductrices d'un réseau disposant d'énergie
    for (let i = 0; i < g.size; i++) {
      const c = this.compPower[i];
      g.powered[i] = c >= 0 && available[c] > 0 && used[c] <= available[c] + 1e-9 ? 1 : 0;
    }
    for (const b of buildings) {
      if (!b.powered) for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) g.powered[g.idx(b.x + dx, b.y + dy)] = 0;
    }

    let totalSupply = 0;
    let totalDemand = 0;
    let totalUsed = 0;
    let networksWithProduction = 0;
    for (let c = 0; c < nPower; c++) {
      totalSupply += supply[c];
      totalDemand += demand[c];
      totalUsed += used[c];
      if (supply[c] > 0) networksWithProduction++;
    }
    // Vente des excédents à la région (après la recharge des batteries)
    let powerExported = 0;
    let powerImported = 0;
    for (let c = 0; c < nPower; c++) {
      powerImported += imported[c];
      if (regionPower[c] && trade.power?.sell) powerExported += Math.max(0, supply[c] - used[c] - intake[c]);
    }
    const storage = batteries.reduce((s, b) => s + b.charge, 0);
    const storageCap = batteries.reduce((s, b) => s + cat.buildingFor(b).capacity.powerStorage, 0);
    state.utilities.power = {
      capacity: totalSupply,
      demand: totalDemand,
      consumed: totalUsed,
      unserved: Math.max(0, totalDemand - totalUsed),
      networks: nPower,
      networksWithProduction,
      unpoweredBuildings: unpowered,
      storage,
      storageCap,
      imported: powerImported,
      exported: powerExported,
      // La ville est reliée si un réseau qui produit ou consomme touche l'accès autoroutier
      connected: regionPower.some((v, c) => v && (demand[c] > 0 || supply[c] > 0)),
      bySource: this.#bySource(buildings, defs)
    };

    // ── Eau ──
    const wSupply = new Float64Array(nWater);
    const wDemand = new Float64Array(nWater);
    const treat = new Float64Array(nWater);
    for (let k = 0; k < buildings.length; k++) {
      const b = buildings[k];
      const def = defs[k];
      const c = this.compWater[g.idx(b.x, b.y)];
      b._wc = c;
      if (c < 0) continue;
      const staffing = def.capacity.jobs ? 0.5 + 0.5 * Math.min(1, b.jobsFilled / def.capacity.jobs) : 1;
      const wm = mods['water.outputMult'] ?? 1;
      if (def.capacity.waterOutput && b.powered && !b.abandoned) wSupply[c] += def.capacity.waterOutput * staffing * wm;
      if (def.capacity.sewageTreatment && b.powered && !b.abandoned) treat[c] += def.capacity.sewageTreatment * staffing * wm;
      const need = def.networks.water * this.activity(b, def) * (def.kind === 'growable' ? mods.waterDemandMult ?? 1 : 1);
      b.waterNeed = need;
      wDemand[c] += need;
    }
    let wTotalS = 0;
    let wTotalD = 0;
    let wUsed = 0;
    let sewage = 0;
    let treated = 0;
    const ratio = new Float64Array(nWater);
    let waterImported = 0;
    let waterExported = 0;
    for (let c = 0; c < nWater; c++) {
      if (regionWater[c]) {
        const d = wDemand[c] - wSupply[c];
        if (d > 0 && trade.water?.buy) {
          const imp = Math.min(d, importCap(wDemand[c]));
          wSupply[c] += imp;
          waterImported += imp;
        } else if (d < 0 && trade.water?.sell) waterExported += -d;
      }
      ratio[c] = wDemand[c] > 0 ? Math.min(1, wSupply[c] / wDemand[c]) : 1;
      wTotalS += wSupply[c];
      wTotalD += wDemand[c];
      wUsed += Math.min(wSupply[c], wDemand[c]);
      const sw = Math.min(wSupply[c], wDemand[c]) * 0.9;
      sewage += sw;
      treated += Math.min(sw, treat[c]);
    }
    let unwatered = 0;
    for (const b of buildings) {
      if (!(b.waterNeed > 0)) {
        b.watered = true;
        continue;
      }
      // Desserte partielle : les bâtiments servis en premier sont déterminés par leur identifiant.
      const r = b._wc >= 0 ? ratio[b._wc] : 0;
      b.watered = r >= 0.999 || (r > 0 && ((b.id * 2654435761) >>> 0) / 4294967296 < r);
      if (!b.watered) unwatered++;
    }
    for (let i = 0; i < g.size; i++) {
      const c = this.compWater[i];
      g.watered[i] = c >= 0 && wSupply[c] > 0 ? 1 : 0;
    }
    state.utilities.water = {
      capacity: wTotalS - waterImported,
      demand: wTotalD,
      consumed: wUsed,
      unserved: Math.max(0, wTotalD - wUsed),
      unwateredBuildings: unwatered,
      sewage,
      treated,
      untreatedShare: sewage > 0 ? 1 - treated / sewage : 0,
      imported: waterImported,
      exported: waterExported,
      connected: regionWater.some((v, c) => v && (wDemand[c] > 0 || wSupply[c] > 0))
    };
    for (const b of buildings) {
      delete b._pc;
      delete b._wc;
    }
  }

  #bySource(buildings, defs) {
    const out = {};
    for (let k = 0; k < buildings.length; k++) {
      const src = defs[k].capacity.powerSource;
      if (!src || !buildings[k].output) continue;
      out[src] = (out[src] ?? 0) + buildings[k].output;
    }
    return out;
  }
}
