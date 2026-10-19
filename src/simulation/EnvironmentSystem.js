import { hash2 } from '../util/rng.js';
import { TERRAIN } from '../world/Terrain.js';

const COVER_LAYER = { police: 'coverPolice', fire: 'coverFire', health: 'coverHealth', education: 'coverEducation', admin: 'coverAdmin' };

/** Noyaux de diffusion (décalages et poids) par rayon, partagés et bornés en nombre. */
const KERNELS = new Map();
function kernel(r) {
  let k = KERNELS.get(r);
  if (k) return k;
  const dx = [];
  const dy = [];
  const wt = [];
  const R = Math.ceil(r);
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y);
      if (d > r) continue;
      dx.push(x);
      dy.push(y);
      wt.push(1 - d / (r + 1));
    }
  }
  k = { dx: Int16Array.from(dx), dy: Int16Array.from(dy), wt: Float64Array.from(wt) };
  if (KERNELS.size > 256) KERNELS.clear();
  KERNELS.set(r, k);
  return k;
}

/**
 * Environnement et attractivité :
 *  - couverture des services publics (rayon d'action, effectifs, alimentation) ;
 *  - pollution atmosphérique, bruit, végétation, îlots de chaleur ;
 *  - valeur foncière ; densités d'habitants et d'emplois (couches cartographiques).
 * Ces champs ont un effet réel sur la satisfaction, la croissance et la fiscalité foncière.
 */
export class EnvironmentSystem {
  /** @param {{catalog: import('../data/Catalog.js').Catalog}} deps */
  constructor({ catalog }) {
    this.catalog = catalog;
    this.waterProximity = null;
    this.waterVersion = -1;
  }

  /** Ajoute une émission décroissant linéairement avec la distance (disque de rayon r). */
  static splat(g, field, cx, cy, value, r) {
    // Centre entier : noyau de poids précalculé (mêmes opérations flottantes, résultat identique au bit près)
    if (Number.isInteger(cx) && Number.isInteger(cy)) {
      const k = kernel(r);
      const w = g.width;
      for (let n = 0; n < k.dx.length; n++) {
        const x = cx + k.dx[n];
        const y = cy + k.dy[n];
        if (x < 0 || y < 0 || x >= w || y >= g.height) continue;
        field[y * w + x] += value * k.wt[n];
      }
      return;
    }
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(g.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(g.height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        field[y * g.width + x] += value * (1 - d / (r + 1));
      }
    }
  }

  updateCoverage(state) {
    const g = state.grid;
    for (const layer of Object.values(COVER_LAYER)) g[layer].fill(0);
    // v0.6 : chaque équipement a une capacité (habitants servis). Au-delà, son efficacité baisse :
    // une seule école ne peut plus couvrir toute une métropole.
    const homes = [];
    for (const b of state.buildings.values()) if (b.residents > 0) homes.push(b);
    for (const b of state.buildings.values()) {
      const def = this.catalog.buildingFor(b);
      const svc = def.capacity.service;
      if (!svc || b.abandoned || b.ruins) continue;
      const staffing = def.capacity.jobs ? Math.min(1, 0.25 + (b.jobsFilled / def.capacity.jobs) * 0.75) : 1;
      const power = b.powered ? 1 : 0.35;
      const cx = b.x + (b.w - 1) / 2;
      const cy = b.y + (b.h - 1) / 2;
      let load = 1;
      // v1.4 : technologies d'éducation (efficacité et capacité des établissements)
      const boost = svc.type === 'education' ? state.modifiers?.['education.mult'] ?? 1 : 1;
      if (svc.capacity) {
        const base = this.catalog.building(b.defId).capacity.service;
        const cap = svc.capacity * (svc.strength / (base.strength || 1)) * boost;
        const r2 = svc.radius * svc.radius;
        let served = 0;
        for (const h of homes) {
          const dx = h.x - cx;
          const dy = h.y - cy;
          if (dx * dx + dy * dy <= r2) served += h.residents;
        }
        b.serviceLoad = Math.round((served / cap) * 100) / 100;
        load = served > cap ? Math.max(0.35, cap / served) : 1;
      }
      EnvironmentSystem.splat(g, g[COVER_LAYER[svc.type]], cx, cy, svc.strength * boost * staffing * power * 1.4 * load, svc.radius);
    }
    for (const layer of Object.values(COVER_LAYER)) {
      const f = g[layer];
      for (let i = 0; i < g.size; i++) if (f[i] > 1) f[i] = 1;
    }
  }

  #waterProx(state) {
    const g = state.grid;
    if (this.waterProximity && this.waterProximity.length === g.size) return this.waterProximity;
    const f = new Float32Array(g.size);
    for (let i = 0; i < g.size; i++) {
      if (g.terrain[i] === TERRAIN.WATER) EnvironmentSystem.splat(g, f, g.xOf(i), g.yOf(i), 0.35, 3);
    }
    for (let i = 0; i < g.size; i++) f[i] = Math.min(1, f[i]);
    this.waterProximity = f;
    return f;
  }

  /**
   * Attractivité d'implantation par secteur (v0.6). Le logement garde la valeur foncière ; le commerce, les bureaux
   * et l'industrie ont leurs propres critères, pour que la pollution d'une usine ne bloque plus son propre essor :
   * - commerce : clientèle à pied (habitants alentour), passage (accès, transports), une part de valeur foncière ;
   * - bureaux : actifs qualifiés (éducation), transports en commun, accès, une part de valeur foncière ;
   * - industrie, agriculture, extraction : accès routier à l'autoroute, plateformes logistiques, port et gares,
   *   main-d'œuvre ; la pollution compte peu.
   */
  #siteValue(state) {
    const g = state.grid;
    const cat = this.catalog;
    const customers = new Float32Array(g.size);
    const logistics = new Float32Array(g.size);
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      const cx = b.x + (b.w - 1) / 2;
      const cy = b.y + (b.h - 1) / 2;
      if (b.residents > 0) EnvironmentSystem.splat(g, customers, Math.round(cx), Math.round(cy), b.residents, 5);
      const lg = def.capacity.logistics || def.capacity.transit?.mode === 'rail' || def.id === 'seaport' || def.id === 'airport';
      if (lg && !b.abandoned) EnvironmentSystem.splat(g, logistics, Math.round(cx), Math.round(cy), def.id === 'seaport' ? 30 : 18, 14);
    }
    for (let i = 0; i < g.size; i++) {
      const z = g.zone[i];
      if (!z || g.terrain[i] === TERRAIN.WATER) {
        g.siteValue[i] = g.landValue[i];
        continue;
      }
      const lv = g.landValue[i];
      const r = g.nearestRoad[i];
      const acc = r >= 0 ? g.accessibility[r] : 999;
      const access = acc > 0 && acc < 900 ? Math.max(0, 16 - acc * 0.35) : 0;
      const transit = Math.max(g.transitBus[i] * 0.6, g.transitMetro[i], g.transitRail[i]);
      let v;
      if (z <= 2) v = lv;
      else if (z === 3 || z === 9) v = 12 + lv * 0.45 + Math.min(32, customers[i] / 25) + access * 0.8 + transit * 8;
      else if (z === 4) v = 10 + lv * 0.5 + g.coverEducation[i] * 16 + transit * 12 + access;
      else v = 14 + access * 1.2 + Math.min(22, logistics[i]) + lv * 0.25 + Math.min(10, customers[i] / 60);
      g.siteValue[i] = Math.max(0, Math.min(100, v));
    }
  }

  /**
   * Repousse des forêts (v0.6) : une prairie libre (ni zonée, ni bâtie, ni route) entourée d'au moins deux cases de
   * forêt a une petite chance de se boiser à chaque mise à jour (tirage déterministe sur la case et le jour).
   * @returns {number[]} cases devenues forêt
   */
  regrowForests(state) {
    const g = state.grid;
    const out = [];
    const t = state.time.tick;
    const seed = state.meta?.seed ?? 0;
    const nb = new Int32Array(4);
    for (let i = 0; i < g.size; i++) {
      if (g.terrain[i] !== TERRAIN.GRASS || g.zone[i] || g.building[i] || g.road[i]) continue;
      const n = g.neighbors4(i, nb);
      let f = 0;
      for (let k = 0; k < n; k++) if (g.terrain[nb[k]] === TERRAIN.FOREST) f++;
      if (f < 2) continue;
      if (hash2(i, t, seed + 4242) < 0.02 * f) {
        out.push(i);
      }
    }
    for (const i of out) {
      g.terrain[i] = TERRAIN.FOREST;
      g.touch(i);
    }
    return out;
  }

  update(state) {
    const g = state.grid;
    const cat = this.catalog;
    const mods = state.modifiers;
    g.pollution.fill(0);
    g.noise.fill(0);
    g.green.fill(0);
    g.heat.fill(0);
    g.density.fill(0);
    g.jobDensity.fill(0);

    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      const env = def.environment;
      const cx = b.x + (b.w - 1) / 2;
      const cy = b.y + (b.h - 1) / 2;
      let activity = 1;
      if (b.abandoned) activity = 0.15;
      else if (def.capacity.jobs && def.category === 'industry') activity = 0.3 + 0.7 * (b.jobsFilled / def.capacity.jobs);
      else if (def.capacity.powerOutput) activity = b.output ? Math.min(1, b.output / def.capacity.powerOutput) : 0.2;
      let noiseAct = activity;
      if (def.capacity.logistics?.role === 'lastmile') noiseAct = 0.3 + 0.7 * (b.utilization ?? 0);
      const pMult = def.kind === 'growable' ? mods['pollution.buildings'] ?? 1 : 1;
      if (env.pollution) EnvironmentSystem.splat(g, g.pollution, cx, cy, env.pollution * activity * pMult, env.radius + Math.max(b.w, b.h) / 2);
      if (env.noise) EnvironmentSystem.splat(g, g.noise, cx, cy, env.noise * noiseAct, env.radius + Math.max(b.w, b.h) / 2);
      if (env.green) EnvironmentSystem.splat(g, g.green, cx, cy, env.green, env.radius + Math.max(b.w, b.h) / 2);
      if (env.heat) EnvironmentSystem.splat(g, g.heat, cx, cy, env.heat * 2 * (mods.heatMult ?? 1), 2 + Math.max(b.w, b.h) / 2);
      const area = b.w * b.h;
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          const i = g.idx(b.x + dx, b.y + dy);
          g.density[i] = b.residents / area;
          g.jobDensity[i] = b.jobsFilled / area;
        }
      }
    }

    // Trafic : pollution et bruit le long des axes
    const pT = mods['pollution.traffic'] ?? 1;
    const nT = mods['noise.traffic'] ?? 1;
    for (let i = 0; i < g.size; i++) {
      if (!g.road[i]) continue;
      const flow = g.traffic[i];
      g.heat[i] += 0.8 * (mods.heatMult ?? 1);
      if (flow < 20) continue;
      const x = g.xOf(i);
      const y = g.yOf(i);
      EnvironmentSystem.splat(g, g.pollution, x, y, Math.min(14, flow * 0.006) * pT, 2);
      EnvironmentSystem.splat(g, g.noise, x, y, Math.min(16, flow * 0.009) * nT, 2);
    }

    // Végétation naturelle, eau et chaleur
    const wp = this.#waterProx(state);
    let sumLV = 0;
    let nLV = 0;
    let sumPol = 0;
    let sumHeat = 0;
    let nBuilt = 0;
    const heatEvent = state.events.active.some((e) => e.id === 'heatwave') ? 8 : 0;
    for (let i = 0; i < g.size; i++) {
      if (g.terrain[i] === TERRAIN.FOREST) g.green[i] += 6;
      g.pollution[i] += g.garbage[i] * 5;
      if (g.pollution[i] < 0) g.pollution[i] = 0;
      g.heat[i] = Math.max(0, g.heat[i] - g.green[i] * 0.25 - wp[i] * 6) + (g.building[i] || g.road[i] ? heatEvent : 0);
      if (g.terrain[i] === TERRAIN.WATER) {
        g.landValue[i] = 0;
        continue;
      }
      let lv = 22;
      lv += wp[i] * 14;
      lv += Math.min(18, g.green[i] * 0.45);
      lv += g.coverPolice[i] * 6 + g.coverFire[i] * 4 + g.coverHealth[i] * 6 + g.coverEducation[i] * 8 + g.coverAdmin[i] * 4;
      const r = g.nearestRoad[i];
      if (r >= 0) {
        const acc = g.accessibility[r];
        lv += acc > 0 && acc < 900 ? Math.max(0, 12 - acc * 0.4) : 0;
      }
      lv -= Math.min(28, g.pollution[i] * 0.6);
      lv -= Math.min(12, g.noise[i] * 0.25);
      lv -= Math.min(10, Math.max(0, g.heat[i] - 25) * 0.3);
      lv += g.altitude[i] >= 2 ? 3 : 0;
      lv -= g.garbage[i] * 10;
      lv += Math.max(g.transitMetro[i], g.transitRail[i]) * 8;
      lv += mods['landValue.add'] ?? 0;
      g.landValue[i] = lv;
    }
    // Effets ponctuels de bâtiments (ex. hôtel de ville)
    for (const b of state.buildings.values()) {
      const env = cat.buildingFor(b).environment;
      if (env.landValue) EnvironmentSystem.splat(g, g.landValue, b.x + (b.w - 1) / 2, b.y + (b.h - 1) / 2, env.landValue, env.radius);
    }
    for (let i = 0; i < g.size; i++) {
      if (g.terrain[i] === TERRAIN.WATER) continue;
      g.landValue[i] = Math.max(0, Math.min(100, g.landValue[i]));
      if (g.building[i]) {
        sumLV += g.landValue[i];
        nLV++;
        sumPol += g.pollution[i];
        sumHeat += g.heat[i];
        nBuilt++;
      }
    }
    this.#siteValue(state);
    state.stats.avgLandValue = nLV ? sumLV / nLV : 0;
    state.stats.avgPollution = nBuilt ? sumPol / nBuilt : 0;
    state.stats.avgHeat = nBuilt ? sumHeat / nBuilt : 0;
  }
}
