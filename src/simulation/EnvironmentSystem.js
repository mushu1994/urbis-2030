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
    for (const b of state.buildings.values()) {
      const def = this.catalog.buildingFor(b);
      const svc = def.capacity.service;
      if (!svc || b.abandoned) continue;
      const staffing = def.capacity.jobs ? Math.min(1, 0.25 + (b.jobsFilled / def.capacity.jobs) * 0.75) : 1;
      const power = b.powered ? 1 : 0.35;
      EnvironmentSystem.splat(g, g[COVER_LAYER[svc.type]], b.x + (b.w - 1) / 2, b.y + (b.h - 1) / 2, svc.strength * staffing * power * 1.4, svc.radius);
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
      lv += g.coverPolice[i] * 5 + g.coverFire[i] * 3 + g.coverHealth[i] * 5 + g.coverEducation[i] * 6 + g.coverAdmin[i] * 4;
      const r = g.nearestRoad[i];
      if (r >= 0) {
        const acc = g.accessibility[r];
        lv += acc > 0 && acc < 900 ? Math.max(0, 12 - acc * 0.4) : 0;
      }
      lv -= Math.min(30, g.pollution[i] * 0.7);
      lv -= Math.min(15, g.noise[i] * 0.35);
      lv -= Math.min(10, Math.max(0, g.heat[i] - 25) * 0.3);
      lv += g.altitude[i] >= 2 ? 3 : 0;
      lv -= g.garbage[i] * 10;
      lv += Math.max(g.transitMetro[i], g.transitRail[i]) * 4;
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
    state.stats.avgLandValue = nLV ? sumLV / nLV : 0;
    state.stats.avgPollution = nBuilt ? sumPol / nBuilt : 0;
    state.stats.avgHeat = nBuilt ? sumHeat / nBuilt : 0;
  }
}
