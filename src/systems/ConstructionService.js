import { toCents } from '../util/money.js';
import { TERRAIN, CLEARING_COST_EUROS, ROCK_CLEARING_COST_EUROS, MAX_ALTITUDE } from '../world/Terrain.js';
import { REASONS, checkBuildingPlacement, checkRoadTile, roadPath, planBridges, footprintOf, findAccess, siteWorksCents, prepareSite } from '../world/PlacementSystem.js';
import { createBuilding, removeBuilding, markNetworksDirty } from './BuildingFactory.js';
import { isOwnedIndex, fullyOwned, landOf, parcelMap, parcelPrice, parcelKey } from '../world/Land.js';
import { EconomySystem } from '../simulation/EconomySystem.js';
import { accountForCategory } from '../simulation/EconomySystem.js';
import { milestoneOf, milestoneLabel, featureUnlocked } from '../simulation/Milestones.js';

/** Voie ferrée (v0.6) : coûts en euros par case, entretien mensuel, déblocage. */
export const RAIL = { cost: 250, bridgeCost: 2500, upkeep: 1.5, bridgeUpkeep: 8, unlock: { milestone: 2 } };

/** Coût de démolition d'une case de route (centimes). */
export const ROAD_DEMOLITION_CENTS = 1000;

/**
 * Terrassement : opérations et coûts par case (euros). La roche coûte le double à creuser ou remblayer.
 * - raise / lower : élever ou abaisser d'un niveau ;
 * - level : aplanir à l'altitude de la case de départ (coût par niveau déplacé) ;
 * - clear : défricher une forêt ; plant : planter une forêt.
 */
export const TERRAFORM = {
  raise: { label: 'Élever le terrain', euros: 600 },
  lower: { label: 'Abaisser le terrain', euros: 600 },
  level: { label: 'Aplanir le terrain', euros: 600 },
  clear: { label: 'Défricher et dérocher', euros: CLEARING_COST_EUROS },
  plant: { label: 'Planter une forêt', euros: 40 }
};

/** Déplacement d'un équipement : 15 % de son coût de construction (gratuit dans les 30 jours qui suivent la pose). */
export const MOVE_COST_SHARE = 0.15;
export const MOVE_FREE_DAYS = 30;

/** Noms des ères de progression (voir ProgressionSystem). */
export const ERA_NAMES = { 1: 'Ville connectée', 2: 'Ville autonome', 3: 'Ville symbiotique' };

/**
 * Conditions de déblocage (statut de la ville, population atteinte, technologie recherchée, ère atteinte).
 * Pendant la préparation d'un scénario ou du bourg existant (`meta.preparing`), l'ancienne équipe
 * municipale a pu construire ce que le statut actuel ne permet pas encore : le palier n'est pas exigé.
 * @returns {{ok:boolean, reason?:string}}
 */
export function isUnlocked(state, unlock) {
  if (!unlock) return { ok: true };
  if (unlock.milestone && !state.meta?.preparing && milestoneOf(state).rank < unlock.milestone) {
    return { ok: false, reason: `Débloqué au statut « ${milestoneLabel(unlock.milestone)} »` };
  }
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
        if (!fullyOwned(state) && !isOwnedIndex(state, i)) r = { status: 'invalid', reason: 'notOwned' };
        else if (deck === undefined || !road.bridgeCostCents) r = { status: 'invalid', reason: 'water' };
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

  // ───────────────────────────── Voies ferrées ─────────────────────────────

  /**
   * Tracé d'une voie ferrée (comme une route) : sur la terre, pente d'un niveau au plus, ponts rectilignes sur l'eau ;
   * elle peut croiser une route (passage à niveau) mais pas un bâtiment.
   * @param {{from:{x:number,y:number}, to:{x:number,y:number}, verticalFirst?:boolean}} p
   */
  previewRail(state, { from, to, verticalFirst = false }) {
    const g = state.grid;
    const reasons = new Set();
    const unlock = isUnlocked(state, RAIL.unlock);
    if (!unlock.ok) reasons.add('locked');
    const pts = [];
    for (const p of roadPath(from.x, from.y, to.x, to.y, verticalFirst)) {
      if (!g.inBounds(p.x, p.y)) reasons.add('bounds');
      else pts.push({ x: p.x, y: p.y, i: g.idx(p.x, p.y) });
    }
    const bridges = planBridges(state, pts);
    for (const r of bridges.reasons) reasons.add(r);
    const tiles = [];
    let cost = 0;
    let prevAlt = -1;
    const checkOwned = !fullyOwned(state);
    for (const p of pts) {
      const i = p.i;
      const water = g.terrain[i] === TERRAIN.WATER;
      const deck = water ? bridges.deck.get(i) : undefined;
      let status = g.rail[i] ? 'same' : 'new';
      let reason;
      if (checkOwned && !isOwnedIndex(state, i)) [status, reason] = ['invalid', 'notOwned'];
      else if (g.building[i]) [status, reason] = ['invalid', 'occupied'];
      else if (water && deck === undefined) [status, reason] = ['invalid', 'water'];
      else if (!water && prevAlt >= 0 && Math.abs(g.altitude[i] - prevAlt) > 1) [status, reason] = ['invalid', 'steep'];
      if (reason) reasons.add(reason);
      if (status === 'new') cost += toCents(water ? RAIL.bridgeCost : RAIL.cost);
      tiles.push({ i, x: p.x, y: p.y, status, reason, bridge: deck !== undefined, deck });
      prevAlt = deck ?? (g.bridge[i] ? g.bridge[i] - 1 : g.altitude[i]);
    }
    if (tiles.length && tiles.every((t) => t.status === 'same')) reasons.add('nothing');
    if (!reasons.size && !this.economy.canAfford(state, cost)) reasons.add('budget');
    return { ok: reasons.size === 0, cost, tiles, reasons: [...reasons], messages: [...reasons].map((r) => (r === 'locked' ? unlock.reason : REASONS[r])) };
  }

  buildRail(state, params) {
    const pv = this.previewRail(state, params);
    if (!pv.ok) return pv;
    const g = state.grid;
    const changed = pv.tiles.filter((t) => t.status === 'new').map((t) => t.i);
    const snapshot = this.#snapshotTiles(state, changed);
    const pay = this.economy.payCapex(state, { amount: pv.cost, category: 'roads', label: `Voie ferrée (${changed.length} case${changed.length > 1 ? 's' : ''})`, lifeYears: 40 });
    if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
    for (const t of pv.tiles) {
      if (t.status !== 'new') continue;
      g.rail[t.i] = 1;
      if (t.bridge && !g.bridge[t.i]) g.bridge[t.i] = t.deck + 1;
      g.zone[t.i] = 0;
      if (g.terrain[t.i] === TERRAIN.FOREST) g.terrain[t.i] = TERRAIN.GRASS;
      g.touch(t.i);
    }
    state.revisions.rail = (state.revisions.rail ?? 0) + 1;
    state.dirty.utilities = true;
    this.#record(state, 'Construire : voie ferrée', snapshot, changed, [pay.tx], { assetsAdded: pay.assetId ? [pay.assetId] : [] });
    this.bus?.emit('world:changed', { tiles: changed, reason: 'rail' });
    this.bus?.emit('network:changed', { kind: 'rail' });
    return { ...pv, ok: true };
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
    // Autoroute de sortie (v0.6) : une case posée au bord de la carte devient un nouvel accès régional
    if (road.exit) {
      for (const i of changed) {
        const x = g.xOf(i);
        const y = g.yOf(i);
        const border = x === 0 || y === 0 || x === g.width - 1 || y === g.height - 1;
        if (border && !state.entries.includes(i)) {
          state.entries = [...state.entries, i];
          this.bus?.emit('notify', { level: 'success', message: 'Nouvel accès autoroutier ouvert : la ville a une seconde sortie vers la région.', x, y });
        }
      }
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
    const works = siteWorksCents(check);
    const cost = def.costCents + works;
    if (reasons.length === 0 && !this.economy.canAfford(state, cost)) reasons.push('budget');
    return {
      ok: reasons.length === 0,
      cost,
      works,
      check,
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
    prepareSite(state, pv.check);
    const b = createBuilding(state, def, params.x, params.y, rot, 'player');
    b.assetId = pay.assetId;
    const asset = state.economy.assets.find((a) => a.id === pay.assetId);
    if (asset) asset.ref = b.id;
    this.#record(state, `Construire : ${def.name}`, snapshot, pv.tiles, [pay.tx], {
      buildingsAdded: [b.id],
      assetsAdded: pay.assetId ? [pay.assetId] : []
    });
    this.bus?.emit('building:added', { building: b });
    // Nivellement : les falaises dessinées par les cases voisines changent aussi
    this.bus?.emit('world:changed', { tiles: pv.check.level ? withNeighbors(state, pv.tiles) : pv.tiles, reason: 'building' });
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
    // v0.6 : démolir coûte nettement plus cher (un quart du prix d'un équipement)
    if (def.kind === 'plop') return Math.round(def.costCents * 0.25);
    return toCents(150 * def.level * b.w * b.h);
  }

  /**
   * @param {{x0:number,y0:number,x1:number,y1:number}} rect
   * @param {'all'|'roads'|'buildings'} [filter] « roads » : routes seules ; « buildings » : bâtiments seuls
   */
  previewDemolish(state, rect, filter = 'all') {
    const g = state.grid;
    const all = this.#collectDemolition(state, rect);
    const tiles = all.tiles;
    const buildings = filter === 'roads' ? [] : all.buildings;
    const forests = filter === 'all' ? all.forests : [];
    // L'accès autoroutier est simplement ignoré (il n'empêche plus de démolir le reste du rectangle)
    const highway = all.roads.filter((i) => g.road[i] === this.highwayCode);
    const roads = filter === 'buildings' ? [] : all.roads.filter((i) => g.road[i] !== this.highwayCode);
    const rails = filter === 'buildings' ? [] : all.rails;
    const reasons = [];
    let cost = 0;
    for (const b of buildings) cost += this.demolitionCost(b);
    cost += forests.length * toCents(CLEARING_COST_EUROS);
    // Routes : petit coût de chantier (gratuit auparavant), ponts plus chers
    for (const i of roads) cost += g.bridge[i] ? ROAD_DEMOLITION_CENTS * 4 : ROAD_DEMOLITION_CENTS;
    for (const i of rails) cost += g.bridge[i] ? ROAD_DEMOLITION_CENTS * 4 : ROAD_DEMOLITION_CENTS;
    if (!buildings.length && !roads.length && !rails.length && !forests.length) reasons.push(highway.length && filter !== 'buildings' ? 'highway' : 'nothing');
    if (!reasons.length && !this.economy.canAfford(state, cost)) reasons.push('budget');
    return {
      ok: reasons.length === 0,
      cost,
      tiles,
      buildings: buildings.map((b) => b.id),
      roads,
      rails,
      forests,
      reasons,
      messages: reasons.map((r) => REASONS[r])
    };
  }

  demolish(state, rect, filter = 'all') {
    const pv = this.previewDemolish(state, rect, filter);
    if (!pv.ok) return pv;
    const g = state.grid;
    const buildings = pv.buildings.map((id) => state.buildings.get(id));
    const touched = new Set([...pv.roads, ...pv.rails, ...pv.forests]);
    for (const b of buildings) for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) touched.add(g.idx(b.x + dx, b.y + dy));
    const tiles = [...touched];
    const snapshot = this.#snapshotTiles(state, tiles);
    const txs = [];
    if (pv.cost > 0) {
      txs.push(this.economy.payOpex(state, { amount: pv.cost, category: 'demolition', label: `Démolition (${buildings.length} bât., ${pv.roads.length} routes)` }));
    }
    const { removedBuildings, removedAssets, writeOffs } = this.removeBuildings(state, buildings);
    for (const i of pv.roads) {
      g.road[i] = 0;
      if (g.tram) g.tram[i] = 0; // les rails de tramway disparaissent avec la chaussée (v0.8)
      if (!g.rail[i] || pv.rails.includes(i)) g.bridge[i] = 0;
      g.touch(i);
    }
    for (const i of pv.rails) {
      g.rail[i] = 0;
      if (!g.road[i]) g.bridge[i] = 0;
      g.touch(i);
    }
    if (pv.rails.length) state.revisions.rail = (state.revisions.rail ?? 0) + 1;
    for (const i of pv.forests) {
      g.terrain[i] = TERRAIN.GRASS;
      g.touch(i);
    }
    if (pv.roads.length) this.#afterNetworkChange(state);
    this.#record(state, 'Démolition', snapshot, tiles, txs, { removedBuildings, removedAssets, writeOffs });
    this.bus?.emit('world:changed', { tiles, reason: 'demolish' });
    return { ...pv, ok: true };
  }

  /**
   * Retire des bâtiments (actifs mis au rebut, habitants partis) et renvoie de quoi annuler l'opération.
   * Utilisé par la démolition et par le dézonage.
   */
  removeBuildings(state, buildings) {
    const removedBuildings = buildings.map((b) => structuredClone(b));
    const removedAssets = [];
    let writeOffs = 0;
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
    return { removedBuildings, removedAssets, writeOffs };
  }

  #collectDemolition(state, { x0, y0, x1, y1 }) {
    const g = state.grid;
    const tiles = [];
    const ids = new Set();
    const roads = [];
    const rails = [];
    const forests = [];
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (!g.inBounds(x, y)) continue;
        const i = g.idx(x, y);
        tiles.push(i);
        if (g.building[i]) ids.add(g.building[i]);
        else if (g.road[i] || g.rail[i]) {
          if (g.road[i]) roads.push(i);
          if (g.rail[i]) rails.push(i);
        } else if (g.terrain[i] === TERRAIN.FOREST) forests.push(i);
      }
    }
    const buildings = [...ids].map((id) => state.buildings.get(id)).filter(Boolean);
    return { tiles, buildings, roads, rails, forests };
  }

  // ───────────────────────────── Déplacement ─────────────────────────────

  /** Coût du déplacement d'un équipement (centimes). */
  moveCost(state, b) {
    const def = this.catalog.building(b.defId);
    if (state.time.tick - (b.builtTick ?? 0) <= MOVE_FREE_DAYS) return 0;
    return Math.round(def.costCents * MOVE_COST_SHARE);
  }

  /**
   * Prévisualise le déplacement d'un équipement (le bâtiment garde ses améliorations, son actif et son historique).
   * @param {{buildingId:number, x:number, y:number, rot?:number}} p
   */
  previewMove(state, { buildingId, x, y, rot = 0 }) {
    const b = state.buildings.get(buildingId);
    const fail = (msg) => ({ ok: false, cost: 0, reasons: ['move'], messages: [msg] });
    if (!b) return fail('Bâtiment introuvable');
    const def = this.catalog.building(b.defId);
    if (def.kind !== 'plop') return fail('Seuls les équipements construits par la ville peuvent être déplacés');
    if (b.burning) return fail('Bâtiment en feu');
    const r = def.rotatable ? rot : 0;
    if (b.x === x && b.y === y && (b.rot ?? 0) === r) return fail('Choisissez un nouvel emplacement');
    // L'emprise actuelle est libérée le temps de la vérification
    const g = state.grid;
    const own = footprintTiles(state, b);
    for (const i of own) g.building[i] = 0;
    let check;
    try {
      check = checkBuildingPlacement(state, def, x, y, r);
    } finally {
      for (const i of own) g.building[i] = b.id;
    }
    const reasons = check.reasons.filter((k) => k !== 'unique');
    const cost = this.moveCost(state, b) + siteWorksCents(check);
    if (!reasons.length && !this.economy.canAfford(state, cost)) reasons.push('budget');
    return { ok: reasons.length === 0, cost, check, tiles: check.tiles, w: check.w, h: check.h, reasons, messages: reasons.map((k) => REASONS[k]) };
  }

  moveBuilding(state, params) {
    const pv = this.previewMove(state, params);
    if (!pv.ok) return pv;
    const b = state.buildings.get(params.buildingId);
    const def = this.catalog.building(b.defId);
    const g = state.grid;
    const rot = def.rotatable ? params.rot ?? 0 : 0;
    const from = footprintTiles(state, b);
    const tiles = [...new Set([...from, ...pv.tiles])];
    const snapshot = this.#snapshotTiles(state, tiles);
    const txs = [];
    if (pv.cost > 0) {
      const pay = this.economy.payCapex(state, { amount: pv.cost, category: accountForCategory(def.category), label: `Déplacement : ${def.name}`, lifeYears: 0 });
      if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
      txs.push(pay.tx);
    }
    const before = { x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot ?? 0, access: b.access };
    for (const i of from) {
      g.building[i] = 0;
      g.touch(i);
    }
    const { w, h } = footprintOf(def, rot);
    prepareSite(state, pv.check);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const i = g.idx(params.x + dx, params.y + dy);
        g.building[i] = b.id;
        if (g.terrain[i] === TERRAIN.FOREST) g.terrain[i] = TERRAIN.GRASS;
        g.touch(i);
      }
    }
    Object.assign(b, { x: params.x, y: params.y, w, h, rot, access: findAccess(state, params.x, params.y, w, h) });
    markNetworksDirty(state);
    state.dirty.roadReach = true;
    this.#record(state, `Déplacer : ${def.name}`, snapshot, tiles, txs, { moved: { id: b.id, before } });
    this.bus?.emit('building:changed', { building: b, moved: before });
    this.bus?.emit('world:changed', { tiles, reason: 'move' });
    return { ...pv, ok: true, building: b };
  }

  // ───────────────────────────── Terrassement ─────────────────────────────

  /**
   * @param {{op:'raise'|'lower'|'level'|'clear'|'plant', rect:{x0:number,y0:number,x1:number,y1:number}}} p
   * Pour « level », l'altitude cible est celle de la case (x0, y0) (début du glisser).
   */
  previewTerraform(state, { op, rect }) {
    const spec = TERRAFORM[op];
    const g = state.grid;
    if (!spec) return { ok: false, cost: 0, eligible: [], reasons: ['nothing'], messages: ['Opération inconnue'] };
    const target = g.inBounds(rect.x0, rect.y0) ? g.altitude[g.idx(rect.x0, rect.y0)] : 1;
    const eligible = [];
    const skipped = new Set();
    const checkOwned = !fullyOwned(state);
    let cost = 0;
    for (let y = Math.min(rect.y0, rect.y1); y <= Math.max(rect.y0, rect.y1); y++) {
      for (let x = Math.min(rect.x0, rect.x1); x <= Math.max(rect.x0, rect.x1); x++) {
        if (!g.inBounds(x, y)) continue;
        const i = g.idx(x, y);
        if (checkOwned && !isOwnedIndex(state, i)) {
          skipped.add('notOwned');
          continue;
        }
        const terr = g.terrain[i];
        const factor = terr === TERRAIN.ROCK ? 2 : 1;
        if (terr === TERRAIN.WATER) {
          skipped.add('water');
          continue;
        }
        if (op === 'clear') {
          if ((terr !== TERRAIN.FOREST && terr !== TERRAIN.ROCK) || g.building[i] || g.road[i]) continue;
          eligible.push(i);
          cost += toCents(terr === TERRAIN.ROCK ? ROCK_CLEARING_COST_EUROS : spec.euros);
          continue;
        }
        if (op === 'plant') {
          if (terr === TERRAIN.FOREST || terr === TERRAIN.ROCK || g.building[i] || g.road[i]) continue;
          if (g.zone[i]) {
            skipped.add('zoned');
            continue;
          }
          eligible.push(i);
          cost += toCents(spec.euros);
          continue;
        }
        if (g.building[i] || g.road[i] || g.rail[i]) {
          skipped.add('occupied');
          continue;
        }
        const alt = g.altitude[i];
        const next = op === 'raise' ? alt + 1 : op === 'lower' ? alt - 1 : target;
        if (next === alt) continue;
        if (next > MAX_ALTITUDE) {
          skipped.add('max');
          continue;
        }
        if (next < 1) {
          skipped.add('min');
          continue;
        }
        eligible.push(i);
        cost += toCents(spec.euros) * Math.abs(next - alt) * factor;
      }
    }
    const reasons = [];
    if (!eligible.length) reasons.push('nothing');
    else if (!this.economy.canAfford(state, cost)) reasons.push('budget');
    const NOTES = {
      water: 'l\'eau n\'est pas modifiable',
      occupied: 'cases bâties ou routes ignorées',
      zoned: 'cases zonées ignorées (retirez le zonage pour planter)',
      max: 'altitude maximale atteinte',
      min: 'impossible de creuser sous le niveau du sol',
      notOwned: 'parcelles non achetées ignorées'
    };
    return {
      ok: reasons.length === 0,
      cost,
      tiles: eligible,
      eligible,
      target,
      notes: [...skipped].map((k) => NOTES[k]),
      reasons,
      messages: reasons.length ? [reasons[0] === 'budget' ? REASONS.budget : [...skipped].map((k) => NOTES[k]).join(' · ') || REASONS.nothing] : []
    };
  }

  terraform(state, params) {
    const pv = this.previewTerraform(state, params);
    if (!pv.ok) return pv;
    const g = state.grid;
    const spec = TERRAFORM[params.op];
    // Les falaises sont dessinées par la case voisine : elle est signalée au rendu
    const around = new Set(pv.eligible);
    for (const i of pv.eligible) {
      const x = g.xOf(i);
      const y = g.yOf(i);
      if (x > 0) around.add(i - 1);
      if (y > 0) around.add(i - g.width);
      if (x < g.width - 1) around.add(i + 1);
      if (y < g.height - 1) around.add(i + g.width);
    }
    const snapshot = this.#snapshotTiles(state, pv.eligible);
    const pay = this.economy.payCapex(state, { amount: pv.cost, category: 'terraforming', label: `${spec.label} (${pv.eligible.length} case${pv.eligible.length > 1 ? 's' : ''})`, lifeYears: 0 });
    if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
    for (const i of pv.eligible) {
      if (params.op === 'raise') g.altitude[i]++;
      else if (params.op === 'lower') g.altitude[i]--;
      else if (params.op === 'level') g.altitude[i] = pv.target;
      else if (params.op === 'clear') g.terrain[i] = TERRAIN.GRASS;
      else if (params.op === 'plant') g.terrain[i] = TERRAIN.FOREST;
      g.touch(i);
    }
    state.dirty.environment = true;
    state.dirty.roadReach = true;
    this.#record(state, spec.label, snapshot, pv.eligible, [pay.tx]);
    this.bus?.emit('world:changed', { tiles: [...around], reason: 'terraform' });
    return { ...pv, ok: true };
  }

  // ───────────────────────────── Territoire ─────────────────────────────

  /** Prévisualise l'achat d'une parcelle (32 × 32) voisine du territoire. */
  previewParcel(state, { gx, gy }) {
    const cell = parcelMap(state).find((c) => c.gx === gx && c.gy === gy);
    const cost = parcelPrice(state, EconomySystem.summarize);
    const fail = (m) => ({ ok: false, cost, reasons: ['land'], messages: [m] });
    if (!cell) return fail('Hors du territoire possible (256 × 256 cases au plus)');
    if (cell.status === 'owned') return fail('Parcelle déjà achetée');
    if (cell.status !== 'available') return fail('Achetez d\'abord une parcelle voisine');
    const feature = featureUnlocked(state, 'territory');
    if (!feature.ok) return fail(feature.reason);
    if ((state.crises?.active ?? []).length) return fail('Impossible pendant une crise');
    if (!this.economy.canAfford(state, cost)) return { ok: false, cost, reasons: ['budget'], messages: [REASONS.budget] };
    const box = landOf(state).box;
    const next = { x0: Math.min(box.x0, gx), y0: Math.min(box.y0, gy), x1: Math.max(box.x1, gx), y1: Math.max(box.y1, gy) };
    const grows = next.x0 !== box.x0 || next.y0 !== box.y0 || next.x1 !== box.x1 || next.y1 !== box.y1;
    return { ok: true, cost, box: next, grows, reasons: [], messages: [] };
  }

  /** Achète une parcelle : paiement et inscription au territoire. L'agrandissement de la grille suit (GameApp). */
  buyParcel(state, params) {
    const pv = this.previewParcel(state, params);
    if (!pv.ok) return pv;
    const pay = this.economy.payCapex(state, { amount: pv.cost, category: 'land', label: `Extension du territoire (parcelle ${params.gx + 1}-${params.gy + 1})`, lifeYears: 0 });
    if (!pay.ok) return { ...pv, ok: false, reasons: ['budget'], messages: [REASONS.budget] };
    const land = landOf(state);
    land.owned = [...land.owned, parcelKey(params.gx, params.gy)];
    land.purchases += 1;
    land.spent = (land.spent ?? 0) + pv.cost;
    // Parcelle comprise dans la grille actuelle (territoire en « L ») : elle se déverrouille tout de suite
    this.bus?.emit('land:changed', { grows: pv.grows });
    return { ...pv, ok: true };
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
    if (e.moved) {
      const b = state.buildings.get(e.moved.id);
      if (b) {
        Object.assign(b, e.moved.before);
        markNetworksDirty(state);
        this.bus?.emit('building:changed', { building: b });
      }
    }
    for (const t of e.snapshot) {
      if (t.altitude !== undefined) g.altitude[t.i] = t.altitude;
      g.terrain[t.i] = t.terrain;
      g.zone[t.i] = t.zone;
      g.road[t.i] = t.road;
      if (t.rail !== undefined) g.rail[t.i] = t.rail;
      if (t.tram !== undefined && g.tram) g.tram[t.i] = t.tram;
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
      altitude: g.altitude[i],
      terrain: g.terrain[i],
      zone: g.zone[i],
      road: g.road[i],
      rail: g.rail[i],
      tram: g.tram?.[i] ?? 0,
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
    // Un accès supprimé (démolition, annulation) disparaît de la liste ; l'accès d'origine reste toujours
    const g = state.grid;
    if (state.entries.some((i) => !g.road[i])) state.entries = state.entries.filter((i, k) => k === 0 || g.road[i]);
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

/** Cases et leurs voisines directes (redessin des falaises après un nivellement). */
function withNeighbors(state, tiles) {
  const g = state.grid;
  const out = new Set(tiles);
  for (const i of tiles) {
    const x = g.xOf(i);
    const y = g.yOf(i);
    if (x > 0) out.add(i - 1);
    if (y > 0) out.add(i - g.width);
    if (x < g.width - 1) out.add(i + 1);
    if (y < g.height - 1) out.add(i + g.width);
  }
  return [...out];
}
