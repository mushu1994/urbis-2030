import { REASONS, canZoneTile } from '../world/PlacementSystem.js';
import { isUnlocked } from './ConstructionService.js';
import { ZONE_EXTRACT, ZONE_FOREST, TERRAIN, ROCK_CLEARING_COST_EUROS } from '../world/Terrain.js';
import { toCents } from '../util/money.js';
import { isOwnedIndex, fullyOwned } from '../world/Land.js';

/**
 * Zonage (résidentiel, commerce, bureaux, industrie) et zones de desserte autorisées pour les drones.
 * Le zonage ne crée aucun bâtiment : il autorise la croissance spontanée, sous conditions.
 * Les opérations sont atomiques : toutes les cases éligibles du rectangle sont traitées et payées, ou aucune.
 */
export class ZoningService {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, economy: import('../simulation/EconomySystem.js').EconomySystem,
   *          construction: import('./ConstructionService.js').ConstructionService, bus?: import('../app/EventBus.js').EventBus}} deps
   */
  constructor({ catalog, economy, construction, bus }) {
    this.catalog = catalog;
    this.economy = economy;
    this.construction = construction;
    this.bus = bus;
  }

  #rectTiles(state, { x0, y0, x1, y1 }) {
    const g = state.grid;
    const out = [];
    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(g.height - 1, Math.max(y0, y1)); y++) {
      for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(g.width - 1, Math.max(x0, x1)); x++) out.push(g.idx(x, y));
    }
    return out;
  }

  /** @param {{zoneId:string|null, rect:{x0:number,y0:number,x1:number,y1:number}}} p zoneId null = dézonage */
  previewZone(state, { zoneId, rect }) {
    const g = state.grid;
    const all = this.#rectTiles(state, rect);
    const zone = zoneId ? this.catalog.zoneById.get(zoneId) : null;
    const code = zone ? zone.code : 0;
    let eligible;
    /** Dézonage : bâtiments de zone présents sur les cases (ils sont démolis avec le zonage). */
    const buildings = [];
    if (zone) {
      // Sur-zonage (v0.6) : une case déjà bâtie d'une autre zone change de zone ; son bâtiment est démoli
      const set = new Set();
      for (const i of all) {
        if (g.zone[i] === code) continue;
        const id = g.building[i];
        if (!id) {
          if (canZoneTile(state, i, code)) set.add(i);
          continue;
        }
        const b = state.buildings.get(id);
        if (!b || buildings.includes(b)) continue;
        const def = this.catalog.building(b.defId);
        if (def.kind === 'plop' || def.zoneCode === code) continue;
        const foot = [];
        for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) foot.push(g.idx(b.x + dx, b.y + dy));
        if (!foot.every((j) => canZoneTile(state, j, code, { ignoreBuilding: true }))) continue;
        buildings.push(b);
        for (const j of foot) set.add(j);
      }
      eligible = [...set].sort((a, z) => a - z);
    } else {
      const set = new Set();
      for (const i of all) {
        if (!g.zone[i]) continue;
        const id = g.building[i];
        if (!id) {
          set.add(i);
          continue;
        }
        const b = state.buildings.get(id);
        // Seuls les bâtiments nés du zonage sont concernés (un équipement public n'a pas de zone)
        if (!b || this.catalog.building(b.defId).kind === 'plop' || buildings.includes(b)) continue;
        buildings.push(b);
        for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) set.add(g.idx(b.x + dx, b.y + dy));
      }
      eligible = [...set].sort((a, z) => a - z);
    }
    const reasons = [];
    const unlock = zone ? isUnlocked(state, zone.unlock) : { ok: true };
    if (!unlock.ok) reasons.push('locked');
    const special = code === ZONE_EXTRACT ? 'noDeposit' : code === ZONE_FOREST ? 'noForest' : null;
    if (!eligible.length) reasons.push(zone ? (special && all.some((i) => canZoneTile(state, i) && g.zone[i] !== code) ? special : 'noZone') : 'nothing');
    let cost = zone ? eligible.length * zone.costCents : 0;
    // Roche : dérochée (payante) au moment du zonage, sauf pour l'extraction qui l'exploite
    const rocks = zone && code !== ZONE_EXTRACT ? eligible.filter((i) => g.terrain[i] === TERRAIN.ROCK) : [];
    cost += rocks.length * toCents(ROCK_CLEARING_COST_EUROS);
    for (const b of buildings) cost += this.construction.demolitionCost(b);
    if (!reasons.length && !this.economy.canAfford(state, cost)) reasons.push('budget');
    return {
      ok: reasons.length === 0,
      cost,
      tiles: all,
      eligible,
      buildings: buildings.map((b) => b.id),
      rocks,
      residents: buildings.reduce((n, b) => n + (b.residents ?? 0), 0),
      reasons,
      messages: reasons.map((r) => (r === 'locked' ? unlock.reason : REASONS[r]))
    };
  }

  applyZone(state, params) {
    const pv = this.previewZone(state, params);
    if (!pv.ok) return pv;
    const g = state.grid;
    const zone = params.zoneId ? this.catalog.zoneById.get(params.zoneId) : null;
    const snapshot = this.construction.snapshot(state, pv.eligible);
    const txs = [];
    let removed = {};
    if (!zone && pv.buildings.length) {
      // Dézonage d'une parcelle bâtie : le bâtiment est démoli (frais de démolition)
      if (pv.cost > 0) txs.push(this.economy.payOpex(state, { amount: pv.cost, category: 'demolition', label: `Dézonage : démolition de ${pv.buildings.length} bâtiment${pv.buildings.length > 1 ? 's' : ''}` }));
      removed = this.construction.removeBuildings(state, pv.buildings.map((id) => state.buildings.get(id)));
    } else if (zone && pv.buildings.length) {
      // Sur-zonage : démolition (charge) puis zonage (investissement)
      const demo = pv.buildings.reduce((s, id) => s + this.construction.demolitionCost(state.buildings.get(id)), 0);
      if (demo > 0) txs.push(this.economy.payOpex(state, { amount: demo, category: 'demolition', label: `Changement de zone : démolition de ${pv.buildings.length} bâtiment${pv.buildings.length > 1 ? 's' : ''}` }));
      removed = this.construction.removeBuildings(state, pv.buildings.map((id) => state.buildings.get(id)));
      const rest = pv.cost - demo;
      if (rest > 0) {
        const pay = this.economy.payCapex(state, { amount: rest, category: 'zoning', label: `Zonage ${zone.name} (${pv.eligible.length} cases)`, lifeYears: 0 });
        if (pay.tx) txs.push(pay.tx);
      }
    } else if (pv.cost > 0) {
      const pay = this.economy.payCapex(state, {
        amount: pv.cost,
        category: 'zoning',
        label: `Zonage ${zone.name} (${pv.eligible.length} cases)`,
        lifeYears: 0
      });
      if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
      txs.push(pay.tx);
    }
    for (const i of pv.rocks ?? []) g.terrain[i] = TERRAIN.GRASS;
    for (const i of pv.eligible) {
      g.zone[i] = zone ? zone.code : 0;
      g.touch(i);
    }
    this.construction.record(state, zone ? `Zonage : ${zone.name}` : 'Dézonage', snapshot, pv.eligible, txs, removed);
    this.bus?.emit('world:changed', { tiles: pv.eligible, reason: 'zone' });
    return { ...pv, ok: true };
  }

  /** Zones de desserte autorisées pour les drones (réglementation municipale, sans coût de travaux). */
  previewDeliveryZone(state, { rect, enabled }) {
    const tech = this.catalog.techById.get('drone_delivery');
    const unlocked = isUnlocked(state, { tech: tech?.id });
    const all = this.#rectTiles(state, rect);
    const g = state.grid;
    const eligible = all.filter((i) => g.terrain[i] !== 1 && !!g.deliveryZone[i] !== enabled && (fullyOwned(state) || isOwnedIndex(state, i)));
    const reasons = [];
    if (!unlocked.ok) reasons.push('locked');
    else if (!eligible.length) reasons.push('nothing');
    return { ok: reasons.length === 0, cost: 0, tiles: all, eligible, reasons, messages: reasons.map((r) => (r === 'locked' ? 'Nécessite la livraison par drones' : REASONS[r])) };
  }

  applyDeliveryZone(state, params) {
    const pv = this.previewDeliveryZone(state, params);
    if (!pv.ok) return pv;
    const g = state.grid;
    const snapshot = this.construction.snapshot(state, pv.eligible);
    for (const i of pv.eligible) {
      g.deliveryZone[i] = params.enabled ? 1 : 0;
      g.touch(i);
    }
    state.dirty.environment = true;
    this.construction.record(state, params.enabled ? 'Zone de desserte' : 'Retrait de zone de desserte', snapshot, pv.eligible, []);
    this.bus?.emit('world:changed', { tiles: pv.eligible, reason: 'delivery-zone' });
    return { ...pv, ok: true };
  }
}
