import { REASONS, canZoneTile } from '../world/PlacementSystem.js';
import { isUnlocked } from './ConstructionService.js';

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
    const eligible = all.filter((i) => (zone ? canZoneTile(state, i) && g.zone[i] !== code : g.zone[i] !== 0 && !g.building[i]));
    const reasons = [];
    if (!eligible.length) reasons.push(zone ? 'noZone' : 'nothing');
    const cost = zone ? eligible.length * zone.costCents : 0;
    if (!reasons.length && !this.economy.canAfford(state, cost)) reasons.push('budget');
    return {
      ok: reasons.length === 0,
      cost,
      tiles: all,
      eligible,
      reasons,
      messages: reasons.map((r) => REASONS[r])
    };
  }

  applyZone(state, params) {
    const pv = this.previewZone(state, params);
    if (!pv.ok) return pv;
    const g = state.grid;
    const zone = params.zoneId ? this.catalog.zoneById.get(params.zoneId) : null;
    const snapshot = this.construction.snapshot(state, pv.eligible);
    const txs = [];
    if (pv.cost > 0) {
      const pay = this.economy.payCapex(state, {
        amount: pv.cost,
        category: 'zoning',
        label: `Zonage ${zone.name} (${pv.eligible.length} cases)`,
        lifeYears: 0
      });
      if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
      txs.push(pay.tx);
    }
    for (const i of pv.eligible) {
      g.zone[i] = zone ? zone.code : 0;
      g.touch(i);
    }
    this.construction.record(state, zone ? `Zonage : ${zone.name}` : 'Dézonage', snapshot, pv.eligible, txs);
    this.bus?.emit('world:changed', { tiles: pv.eligible, reason: 'zone' });
    return { ...pv, ok: true };
  }

  /** Zones de desserte autorisées pour les drones (réglementation municipale, sans coût de travaux). */
  previewDeliveryZone(state, { rect, enabled }) {
    const tech = this.catalog.techById.get('drone_delivery');
    const unlocked = isUnlocked(state, { tech: tech?.id });
    const all = this.#rectTiles(state, rect);
    const g = state.grid;
    const eligible = all.filter((i) => g.terrain[i] !== 1 && !!g.deliveryZone[i] !== enabled);
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
