import { toCents } from '../util/money.js';
import { validateCatalogData, TERRAIN_NAMES } from './Validators.js';
import { applyUpgrades } from './Upgrades.js';

/**
 * Catalogue des bâtiments, routes, zones, technologies et politiques.
 * Les données sont normalisées une fois (centimes, codes de terrain) ; le moteur n'en connaît
 * aucune en dur, ce qui permet d'étendre le jeu en modifiant uniquement les fichiers JSON.
 *
 * @typedef {Object} BuildingDef
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {'growable'|'plop'} kind
 * @property {string} [zone]
 * @property {number} [zoneCode]
 * @property {number} [level]
 * @property {{w:number,h:number}} footprint
 * @property {boolean} rotatable
 * @property {number} costCents
 * @property {number} upkeepCents  entretien mensuel
 * @property {number} lifeYears    durée d'amortissement
 * @property {{terrainCodes:number[], flat:boolean, requiresRoadAccess:boolean, adjacentToTerrainCode:number, unique:boolean}} placement
 * @property {{power:number, water:number, conductsPower:boolean}} networks
 * @property {Object} capacity
 * @property {{pollution:number, noise:number, green:number, heat:number, landValue:number, radius:number}} environment
 * @property {{next?:string, minLandValue:number, requires:string[]}} growth
 * @property {{perMonthCents:number, perUnitCents:number, label:string}} revenue
 * @property {{population?:number, tech?:string}} unlock
 * @property {Object} visual
 */
export class Catalog {
  /**
   * @param {any} buildingsData contenu de buildings.json
   * @param {any} technologiesData contenu de technologies.json
   * @param {any} policiesData contenu de policies.json
   * @param {any} [upgradesData] contenu de upgrades.json (améliorations des équipements)
   */
  constructor(buildingsData, technologiesData, policiesData, upgradesData = { upgrades: [] }) {
    const errors = validateCatalogData(buildingsData, technologiesData, policiesData, upgradesData);
    if (errors.length) {
      const err = new Error(`Catalogue invalide :\n- ${errors.join('\n- ')}`);
      err.details = errors;
      throw err;
    }
    this.currency = buildingsData.currency ?? '€';

    /** Types de routes ; le code stocké dans la grille vaut index + 1. */
    this.roads = buildingsData.roads.map((r, i) => ({
      ...r,
      code: i + 1,
      costCents: toCents(r.cost),
      upkeepCents: toCents(r.upkeep),
      bridgeCostCents: toCents(r.bridgeCost ?? 0),
      bridgeUpkeepCents: toCents(r.bridgeUpkeep ?? r.upkeep * 5),
      unlock: r.unlock ?? {}
    }));
    this.roadById = new Map(this.roads.map((r) => [r.id, r]));

    this.zones = buildingsData.zones.map((z) => ({ ...z, costCents: toCents(z.cost) }));
    this.zoneById = new Map(this.zones.map((z) => [z.id, z]));
    this.zoneByCode = new Map(this.zones.map((z) => [z.code, z]));

    /** @type {Map<string, BuildingDef>} */
    this.buildings = new Map();
    for (const raw of buildingsData.buildings) this.buildings.set(raw.id, normalizeBuilding(raw, this.zoneById));

    /** Bâtiments à croissance spontanée, indexés par zone puis par niveau. */
    this.growablesByZone = new Map();
    for (const def of this.buildings.values()) {
      if (def.kind !== 'growable') continue;
      if (!this.growablesByZone.has(def.zoneCode)) this.growablesByZone.set(def.zoneCode, []);
      this.growablesByZone.get(def.zoneCode).push(def);
    }
    for (const list of this.growablesByZone.values()) list.sort((a, b) => a.level - b.level);

    this.technologies = technologiesData.technologies.map((t) => ({
      ...t,
      costCents: toCents(t.cost),
      upkeepCents: toCents(t.upkeep),
      unlock: t.unlock ?? {},
      effects: t.effects ?? [],
      risks: t.risks ?? [],
      compute: t.compute ?? 0
    }));
    this.techById = new Map(this.technologies.map((t) => [t.id, t]));

    this.policies = policiesData.policies.map((p) => ({
      ...p,
      monthlyCostCents: toCents(p.monthlyCost),
      unlock: p.unlock ?? {},
      effects: p.effects ?? []
    }));
    this.policyById = new Map(this.policies.map((p) => [p.id, p]));

    /** Améliorations des équipements publics. */
    this.upgrades = (upgradesData.upgrades ?? []).map((u) => ({
      ...u,
      costCents: toCents(u.cost),
      upkeepCents: toCents(u.upkeep ?? 0),
      unlock: u.unlock ?? {},
      effects: u.effects ?? {}
    }));
    this.upgradeById = new Map(this.upgrades.map((u) => [u.id, u]));
    this.upgradesByDef = new Map();
    for (const u of this.upgrades) {
      for (const id of u.appliesTo) {
        if (!this.upgradesByDef.has(id)) this.upgradesByDef.set(id, []);
        this.upgradesByDef.get(id).push(u);
      }
    }
    /** Définitions effectives (base + améliorations), mises en cache par combinaison. */
    this.effectiveCache = new Map();
  }

  /** Améliorations proposées pour un type de bâtiment (ordre du fichier). */
  upgradesFor(defId) {
    return this.upgradesByDef.get(defId) ?? [];
  }

  /**
   * Définition effective d'un bâtiment posé : la définition de base si aucune amélioration n'est installée,
   * sinon une définition dérivée (mise en cache, jamais modifiée).
   */
  buildingFor(b) {
    const ups = b.upgrades;
    if (!ups || ups.length === 0) return this.building(b.defId);
    const key = `${b.defId}|${ups.join(',')}`;
    let def = this.effectiveCache.get(key);
    if (!def) {
      def = applyUpgrades(this.building(b.defId), ups.map((id) => this.upgradeById.get(id)).filter(Boolean));
      if (this.effectiveCache.size > 2000) this.effectiveCache.clear();
      this.effectiveCache.set(key, def);
    }
    return def;
  }

  /** @returns {BuildingDef} */
  building(id) {
    const d = this.buildings.get(id);
    if (!d) throw new Error(`Bâtiment inconnu : ${id}`);
    return d;
  }

  road(id) {
    const r = this.roadById.get(id);
    if (!r) throw new Error(`Route inconnue : ${id}`);
    return r;
  }

  roadByCode(code) {
    return this.roads[code - 1];
  }

  /** Premier niveau constructible pour un code de zone. */
  firstGrowable(zoneCode) {
    return this.growablesByZone.get(zoneCode)?.[0];
  }

  /** Bâtiments que le joueur peut poser, par catégorie (ordre du fichier). */
  plopsByCategory() {
    const out = new Map();
    for (const def of this.buildings.values()) {
      if (def.kind !== 'plop') continue;
      if (!out.has(def.category)) out.set(def.category, []);
      out.get(def.category).push(def);
    }
    return out;
  }
}

function normalizeBuilding(raw, zoneById) {
  const terrainCodes = (raw.placement?.terrain ?? ['grass', 'sand', 'forest']).map((t) => TERRAIN_NAMES.indexOf(t));
  const adj = raw.placement?.adjacentToTerrain;
  const cap = raw.capacity ?? {};
  return {
    ...raw,
    zoneCode: raw.zone ? zoneById.get(raw.zone).code : 0,
    level: raw.level ?? 0,
    rotatable: !!raw.rotatable,
    costCents: toCents(raw.cost ?? 0),
    upkeepCents: toCents(raw.upkeep ?? 0),
    lifeYears: raw.lifeYears ?? 30,
    placement: {
      terrainCodes,
      flat: raw.placement?.flat ?? true,
      autoLevel: !!raw.placement?.autoLevel,
      requiresRoadAccess: raw.placement?.requiresRoadAccess ?? true,
      adjacentToTerrainCode: adj ? TERRAIN_NAMES.indexOf(adj) : -1,
      unique: !!raw.placement?.unique
    },
    networks: {
      power: raw.networks?.power ?? 0,
      water: raw.networks?.water ?? 0,
      conductsPower: raw.networks?.conductsPower ?? true
    },
    capacity: {
      residents: cap.residents ?? 0,
      incomeClass: cap.incomeClass ?? 'mid',
      jobs: cap.jobs ?? 0,
      qualification: cap.qualification ?? 0.4,
      sales: cap.sales ?? 0,
      goods: cap.goods ?? 0,
      powerOutput: cap.powerOutput ?? 0,
      powerStorage: cap.powerStorage ?? 0,
      powerDischarge: cap.powerDischarge ?? 0,
      powerSource: cap.powerSource ?? null,
      waterOutput: cap.waterOutput ?? 0,
      sewageTreatment: cap.sewageTreatment ?? 0,
      compute: cap.compute ?? 0,
      service: cap.service ?? null,
      logistics: cap.logistics ?? null,
      waste: cap.waste ?? null,
      transit: cap.transit ?? null
    },
    cityEffects: raw.cityEffects ?? [],
    risk: raw.risk ?? null,
    environment: {
      pollution: raw.environment?.pollution ?? 0,
      noise: raw.environment?.noise ?? 0,
      green: raw.environment?.green ?? 0,
      heat: raw.environment?.heat ?? 0,
      landValue: raw.environment?.landValue ?? 0,
      radius: raw.environment?.radius ?? 3
    },
    growth: {
      next: raw.growth?.next,
      minLandValue: raw.growth?.minLandValue ?? 0,
      minSatisfaction: raw.growth?.minSatisfaction ?? 0,
      requires: raw.growth?.requires ?? []
    },
    revenue: {
      perMonthCents: toCents(raw.revenue?.perMonth ?? 0),
      perUnitCents: toCents(raw.revenue?.perUnit ?? 0),
      label: raw.revenue?.label ?? '',
      category: raw.revenue?.category ?? 'facilities'
    },
    unlock: raw.unlock ?? {}
  };
}
