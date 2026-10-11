import { toCents } from '../util/money.js';
import { TERRAIN, CLEARING_COST_EUROS } from '../world/Terrain.js';
import { REASONS, checkBuildingPlacement, checkRoadTile, roadPath, planBridges } from '../world/PlacementSystem.js';
import { createBuilding, removeBuilding } from './BuildingFactory.js';
import { accountForCategory } from '../simulation/EconomySystem.js';

/** Noms des ères de progression (voir ProgressionSystem). */
export const ERA_NAMES = { 1: 'Ville connectée', 2: 'Ville autonome', 3: 'Ville symbiotique' };

/**
 * Conditions de déblocage (population atteinte, technologie recherchée, ère atteinte).
 * @returns {{ok:boolean, reason?:string}}
 */
export function isUnlocked(state, unlock) {
  if (!unlock) return { ok: true };
  if (unlock.population && (state.stats.peakPopulation ?? 0) < unlock.population) {
    return { ok: false, reason: `Débloqué à ${unlock.population.toLocaleString('fr-FR')} habitants` };
  }
  if (unlock.tech && !state.tech.researched[unlock.tech]) {
    return { ok: false, reason: 'Technologie requise' };
  }
  if (unlock.era && (state.progression?.era ?? 1) < unlock.era) {
    return { ok: false, reason: `Débloqué à l'ère « ${ERA_NAMES[unlock.era]} »` };
  }
  return { ok: true };
}

/**
 * Service de construction : toute modification du monde décidée par le joueur passe par ici.
 * Chaque action dispose d'une prévisualisation (coût, validité, explication) et d'une exécution atomique.
 */
export class ConstructionService {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, economy: import('../simulation/EconomySystem.js').EconomySystem,
   *          history: import('./ActionHistory.js').ActionHistory, bus?: import('../app/EventBus.js').EventBus}} deps
   */
  constructor({ catalog, economy, history, bus }) {
    this.catalog = catalog;
    this.economy = economy;
    this.history = history;
    this.bus = bus;
    this.highwayCode = catalog.road('road_highway').code;
  }

  // ───────────────────────────── Routes ─────────────────────────────

  /**
   * @param {{roadId:string, from:{x:number,y:number}, to:{x:number,y:number}, verticalFirst?:boolean}} p
   */
  previewRoad(state, { roadId, from, to, verticalFirst = false }) {
    const road = this.catalog.road(roadId);
    const g = state.grid;
    const tiles = [];
    const reasons = new Set();
    let cost = 0;
    const unlock = isUnlocked(state, road.unlock);
    if (!road.buildable) reasons.add('highway');
    if (!unlock.ok) reasons.add('locked');
    const pts = [];
    for (const p of roadPath(from.x, from.y, to.x, to.y, verticalFirst)) {
      if (!g.inBounds(p.x, p.y)) reasons.add('bounds');
      else pts.push({ x: p.x, y: p.y, i: g.idx(p.x, p.y) });
    }
    // Franchissements d'eau : ponts rectilignes entre deux rives
    const bridges = planBridges(state, pts);
    const hasWater = pts.some((p) => g.terrain[p.i] === TERRAIN.WATER);
    if (hasWater && !road.bridgeCostCents) reasons.add('noBridge');
    else for (const r of bridges.reasons) reasons.add(r);
    let prevAlt = -1;
    for (const p of pts) {
      const i = p.i;
      let r;
      let deck;
      if (g.terrain[i] === TERRAIN.WATER) {
        deck = bridges.deck.get(i);
        if (deck === undefined || !road.bridgeCostCents) r = { status: 'invalid', reason: 'water' };
        else if (g.road[i] === road.code) r = { status: 'same' };
        else if (g.road[i]) r = { status: 'upgrade' };
        else r = { status: 'new' };
        if (r.status === 'new' || r.status === 'upgrade') cost += road.bridgeCostCents;
      } else {
        r = checkRoadTile(state, i, road.code, prevAlt);
        if (r.status === 'upgrade' && g.road[i] === this.highwayCode) r = { status: 'invalid', reason: 'highway' };
        if (r.status === 'invalid') reasons.add(r.reason);
        if (r.status === 'new' || r.status === 'upgrade') {
          cost += road.costCents;
          if (g.terrain[i] === TERRAIN.FOREST) cost += toCents(CLEARING_COST_EUROS);
        }
      }
      tiles.push({ i, x: p.x, y: p.y, status: r.status, reason: r.reason, bridge: deck !== undefined, deck });
      prevAlt = deck ?? g.altitude[i];
    }
    if (tiles.length && tiles.every((t) => t.status === 'same')) reasons.add('nothing');
    if (reasons.size === 0 && !this.economy.canAfford(state, cost)) reasons.add('budget');
    return { ok: reasons.size === 0, cost, tiles, reasons: [...reasons], messages: [...reasons].map((r) => REASONS[r] ?? unlock.reason) };
  }

  buildRoad(state, params) {
    const pv = this.previewRoad(state, params);
    if (!pv.ok) return pv;
    const road = this.catalog.road(params.roadId);
    const g = state.grid;
    const changed = pv.tiles.filter((t) => t.status !== 'same').map((t) => t.i);
    const snapshot = this.#snapshotTiles(state, changed);
    const nBridge = pv.tiles.filter((t) => t.bridge && t.status !== 'same').length;
    const pay = this.economy.payCapex(state, {
      amount: pv.cost,
      category: 'roads',
      label: `${road.name} (${changed.length} case${changed.length > 1 ? 's' : ''}${nBridge ? `, dont ${nBridge} en pont` : ''})`,
      lifeYears: 30
    });
    if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
    for (const t of pv.tiles) {
      if (t.status === 'same') continue;
      const i = t.i;
      g.road[i] = road.code;
      g.zone[i] = 0;
      g.bridge[i] = t.bridge ? t.deck + 1 : 0;
      if (g.terrain[i] === TERRAIN.FOREST) g.terrain[i] = TERRAIN.GRASS;
      g.touch(i);
    }
    this.#afterNetworkChange(state);
    const bridgeTiles = pv.tiles.filter((t) => t.bridge && t.status !== 'same').length;
    const label = bridgeTiles ? `Construire : ${road.name} et pont (${bridgeTiles} cases sur l'eau)` : `Construire : ${road.name}`;
    this.#record(state, label, snapshot, changed, [pay.tx], { assetsAdded: pay.assetId ? [pay.assetId] : [] });
    this.bus?.emit('world:changed', { tiles: changed, reason: 'road' });
    return { ...pv, ok: true };
  }

  // ───────────────────────────── Bâtiments ─────────────────────────────

  previewBuilding(state, { defId, x, y, rot = 0 }) {
    const def = this.catalog.building(defId);
    if (def.kind !== 'plop') return { ok: false, cost: 0, reasons: ['locked'], messages: ['Ce bâtiment se développe seul sur une zone'] };
    const check = checkBuildingPlacement(state, def, x, y, def.rotatable ? rot : 0);
    const reasons = [...check.reasons];
    const unlock = isUnlocked(state, def.unlock);
    if (!unlock.ok) reasons.push('locked');
    const cost = def.costCents + check.forestTiles.length * toCents(CLEARING_COST_EUROS);
    if (reasons.length === 0 && !this.economy.canAfford(state, cost)) reasons.push('budget');
    return {
      ok: reasons.length === 0,
      cost,
      upkeep: def.upkeepCents,
      tiles: check.tiles,
      w: check.w,
      h: check.h,
      reasons,
      messages: reasons.map((r) => (r === 'locked' ? unlock.reason : REASONS[r]))
    };
  }

  placeBuilding(state, params) {
    const pv = this.previewBuilding(state, params);
    if (!pv.ok) return pv;
    const def = this.catalog.building(params.defId);
    const rot = def.rotatable ? params.rot ?? 0 : 0;
    const snapshot = this.#snapshotTiles(state, pv.tiles);
    const pay = this.economy.payCapex(state, {
      amount: pv.cost,
      category: accountForCategory(def.category),
      label: `Construction : ${def.name}`,
      lifeYears: def.lifeYears
    });
    if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
    const b = createBuilding(state, def, params.x, params.y, rot, 'player');
    b.assetId = pay.assetId;
    const asset = state.economy.assets.find((a) => a.id === pay.assetId);
    if (asset) asset.ref = b.id;
    this.#record(state, `Construire : ${def.name}`, snapshot, pv.tiles, [pay.tx], {
      buildingsAdded: [b.id],
      assetsAdded: pay.assetId ? [pay.assetId] : []
    });
    this.bus?.emit('building:added', { building: b });
    this.bus?.emit('world:changed', { tiles: pv.tiles, reason: 'building' });
    return { ...pv, ok: true, building: b };
  }

  // ───────────────────────────── Améliorations ─────────────────────────────

  /**
   * Prévisualise l'installation d'une amélioration sur un équipement.
   * @param {{buildingId:number, upgradeId:string}} params
   */
  previewUpgrade(state, { buildingId, upgradeId }) {
    const b = state.buildings.get(buildingId);
    const up = this.catalog.upgradeById.get(upgradeId);
    const fail = (message) => ({ ok: false, cost: up?.costCents ?? 0, reasons: ['upgrade'], messages: [message] });
    if (!b) return fail('Bâtiment introuvable');
    if (!up || !up.appliesTo.includes(b.defId)) return fail('Amélioration non disponible pour ce bâtiment');
    if (b.upgrades?.includes(upgradeId)) return fail('Amélioration déjà installée');
    if (b.abandoned) return fail('Bâtiment abandonné');
    const u = isUnlocked(state, up.unlock);
    if (!u.ok) return fail(u.reason);
    if (!this.economy.canAfford(state, up.costCents)) return { ok: false, cost: up.costCents, reasons: ['budget'], messages: [REASONS.budget] };
    return { ok: true, cost: up.costCents, upkeep: up.upkeepCents, reasons: [], messages: [] };
  }

  /** Installe une amélioration : investissement amorti, entretien mensuel ajouté, effet immédiat. */
  applyUpgrade(state, params) {
    const pv = this.previewUpgrade(state, params);
    if (!pv.ok) return pv;
    const b = state.buildings.get(params.buildingId);
    const def = this.catalog.building(b.defId);
    const up = this.catalog.upgradeById.get(params.upgradeId);
    const pay = this.economy.payCapex(state, {
      amount: up.costCents,
      category: accountForCategory(def.category),
      label: `Amélioration : ${up.name} (${def.name})`,
      ref: b.id,
      lifeYears: Math.min(def.lifeYears, 20)
    });
    if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
    b.upgrades = [...(b.upgrades ?? []), up.id];
    if (pay.assetId) b.upgradeAssets = [...(b.upgradeAssets ?? []), pay.assetId];
    const tiles = footprintTiles(state, b);
    this.#record(state, `Améliorer : ${up.name}`, [], tiles, [pay.tx], {
      assetsAdded: pay.assetId ? [pay.assetId] : [],
      upgradesAdded: [{ buildingId: b.id, upgradeId: up.id, assetId: pay.assetId }]
    });
    state.dirty.utilities = true;
    state.dirty.environment = true;
    state.dirty.modifiers = true;
    this.bus?.emit('building:changed', { building: b });
    return { ...pv, ok: true, building: b, upgrade: up };
  }

  // ───────────────────────────── Démolition ─────────────────────────────

  /** Coût de démolition d'un bâtiment (frais de chantier, charge de fonctionnement). */
  demolitionCost(b) {
    const def = this.catalog.building(b.defId);
    if (def.kind === 'plop') return Math.round(def.costCents * 0.1);
    return toCents(80 * def.level * b.w * b.h);
  }

  /** @param {{x0:number,y0:number,x1:number,y1:number}} rect */
  previewDemolish(state, rect) {
    const g = state.grid;
    const { tiles, buildings, roads, forests } = this.#collectDemolition(state, rect);
    const reasons = [];
    let cost = 0;
    for (const b of buildings) cost += this.demolitionCost(b);
    cost += forests.length * toCents(CLEARING_COST_EUROS);
    if (roads.some((i) => g.road[i] === this.highwayCode)) reasons.push('highway');
    if (!buildings.length && !roads.length && !forests.length) reasons.push('nothing');
    if (!reasons.length && !this.economy.canAfford(state, cost)) reasons.push('budget');
    return {
      ok: reasons.length === 0,
      cost,
      tiles,
      buildings: buildings.map((b) => b.id),
      roads,
      forests,
      reasons,
      messages: reasons.map((r) => REASONS[r])
    };
  }

  demolish(state, rect) {
    const pv = this.previewDemolish(state, rect);
    if (!pv.ok) return pv;
    const g = state.grid;
    const buildings = pv.buildings.map((id) => state.buildings.get(id));
    const touched = new Set([...pv.roads, ...pv.forests]);
    for (const b of buildings) for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) touched.add(g.idx(b.x + dx, b.y + dy));
    const tiles = [...touched];
    const snapshot = this.#snapshotTiles(state, tiles);
    const removedBuildings = buildings.map((b) => structuredClone(b));
    const removedAssets = [];
    let writeOffs = 0;

    const txs = [];
    if (pv.cost > 0) {
      txs.push(this.economy.payOpex(state, { amount: pv.cost, category: 'demolition', label: `Démolition (${buildings.length} bât., ${pv.roads.length} routes)` }));
    }
    for (const b of buildings) {
      for (const assetId of [b.assetId, ...(b.upgradeAssets ?? [])]) {
        if (!assetId) continue;
        const asset = state.economy.assets.find((a) => a.id === assetId);
        if (asset) removedAssets.push({ ...asset });
        writeOffs += this.economy.disposeAsset(state, assetId);
      }
      state.stats.departures += b.residents;
      removeBuilding(state, b);
      this.bus?.emit('building:removed', { building: b });
    }
    for (const i of pv.roads) {
      g.road[i] = 0;
      g.bridge[i] = 0;
      g.touch(i);
    }
    for (const i of pv.forests) {
      g.terrain[i] = TERRAIN.GRASS;
      g.touch(i);
    }
    if (pv.roads.length) this.#afterNetworkChange(state);
    this.#record(state, 'Démolition', snapshot, tiles, txs, { removedBuildings, removedAssets, writeOffs });
    this.bus?.emit('world:changed', { tiles, reason: 'demolish' });
    return { ...pv, ok: true };
  }

  #collectDemolition(state, { x0, y0, x1, y1 }) {
    const g = state.grid;
    const tiles = [];
    const ids = new Set();
    const roads = [];
    const forests = [];
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (!g.inBounds(x, y)) continue;
        const i = g.idx(x, y);
        tiles.push(i);
        if (g.building[i]) ids.add(g.building[i]);
        else if (g.road[i]) roads.push(i);
        else if (g.terrain[i] === TERRAIN.FOREST) forests.push(i);
      }
    }
    const buildings = [...ids].map((id) => state.buildings.get(id)).filter(Boolean);
    return { tiles, buildings, roads, forests };
  }

  // ───────────────────────────── Annulation ─────────────────────────────

  canUndo(state) {
    return this.history.canUndo(state);
  }

  undo(state) {
    const check = this.history.canUndo(state);
    if (!check.ok) return check;
    const e = this.history.pop();
    const g = state.grid;
    for (const id of e.buildingsAdded ?? []) {
      const b = state.buildings.get(id);
      if (b) {
        removeBuilding(state, b);
        this.bus?.emit('building:removed', { building: b });
      }
    }
    for (const t of e.snapshot) {
      g.terrain[t.i] = t.terrain;
      g.zone[t.i] = t.zone;
      g.road[t.i] = t.road;
      g.building[t.i] = t.building;
      g.deliveryZone[t.i] = t.deliveryZone;
      g.bridge[t.i] = t.bridgeDeck;
      g.touch(t.i);
    }
    for (const u of e.upgradesAdded ?? []) {
      const b = state.buildings.get(u.buildingId);
      if (!b) continue;
      b.upgrades = (b.upgrades ?? []).filter((id) => id !== u.upgradeId);
      b.upgradeAssets = (b.upgradeAssets ?? []).filter((id) => id !== u.assetId);
      state.dirty.utilities = true;
      state.dirty.environment = true;
      state.dirty.modifiers = true;
      this.bus?.emit('building:changed', { building: b });
    }
    for (const b of e.removedBuildings ?? []) {
      state.buildings.set(b.id, structuredClone(b));
      this.bus?.emit('building:added', { building: state.buildings.get(b.id) });
    }
    for (const tx of e.txs) this.economy.reverse(state, tx, `Annulation — ${tx.label}`);
    for (const id of e.assetsAdded ?? []) this.economy.removeAsset(state, id);
    for (const a of e.removedAssets ?? []) state.economy.assets.push({ ...a });
    if (e.writeOffs) {
      const p = this.economy.ensurePeriod(state);
      if (p.monthIndex === e.monthIndex) p.writeOffs = Math.max(0, p.writeOffs - e.writeOffs);
    }
    this.#afterNetworkChange(state);
    this.bus?.emit('world:changed', { tiles: e.snapshot.map((t) => t.i), reason: 'undo' });
    return { ok: true, label: e.label };
  }

  // ───────────────────────────── Interne ─────────────────────────────

  #snapshotTiles(state, tiles) {
    const g = state.grid;
    return tiles.map((i) => ({
      i,
      terrain: g.terrain[i],
      zone: g.zone[i],
      road: g.road[i],
      building: g.building[i],
      deliveryZone: g.deliveryZone[i],
      bridgeDeck: g.bridge[i]
    }));
  }

  /** Enregistre une action annulable. Utilisé aussi par le service de zonage. */
  record(state, label, snapshot, tiles, txs, extra = {}) {
    this.#record(state, label, snapshot, tiles, txs, extra);
  }

  snapshot(state, tiles) {
    return this.#snapshotTiles(state, tiles);
  }

  #record(state, label, snapshot, tiles, txs, extra) {
    this.history.push({
      label,
      tick: state.time.tick,
      monthIndex: this.economy.ensurePeriod(state).monthIndex,
      snapshot,
      txs: txs.filter(Boolean),
      versionsAfter: tiles.map((i) => ({ i, v: state.grid.tileVersion[i] })),
      ...extra
    });
  }

  #afterNetworkChange(state) {
    state.dirty.roads = true;
    state.dirty.roadReach = true;
    state.dirty.utilities = true;
    state.dirty.environment = true;
    this.bus?.emit('network:changed', { kind: 'road' });
  }
}

/** Cases occupées par un bâtiment. */
function footprintTiles(state, b) {
  const g = state.grid;
  const out = [];
  for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) out.push(g.idx(b.x + dx, b.y + dy));
  return out;
}
