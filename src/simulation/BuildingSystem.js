import { SIM } from './config.js';
import { ROAD_REACH } from '../world/Grid.js';
import { createBuilding, removeBuilding, changeBuildingDef } from '../systems/BuildingFactory.js';
import { constructionDaysFor, isUnderConstruction } from './Construction.js';
import { findAccess } from '../world/PlacementSystem.js';
import { hash2 } from '../util/rng.js';
import { districtGrowthFactor } from './Districts.js';

/** Tirage pondéré (champ « weight » des données, 10 par défaut) à partir d'un nombre de 0 à 1. */
function pickWeighted(list, u) {
  if (!list.length) return null;
  const total = list.reduce((s, d) => s + (d.weight ?? 10), 0);
  let x = u * total;
  for (const d of list) {
    x -= d.weight ?? 10;
    if (x < 0) return d;
  }
  return list[list.length - 1];
}

function footprintTilesOf(g, b) {
  const out = [];
  for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) out.push(g.idx(b.x + dx, b.y + dy));
  return out;
}

/** Secteur de demande de chaque code de zone (agriculture et extraction relèvent de l'industrie). */
export const ZONE_KEYS = { 1: 'R', 2: 'R', 3: 'C', 4: 'O', 5: 'I', 6: 'I', 7: 'I', 8: 'I', 9: 'C' };
const ZONE_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Part des apparitions qui tentent un grand format (2 × 1, 2 × 2) quand la place le permet. */
const LARGE_CHANCE = 0.35;

/** Critère d'implantation propre à chaque secteur (v0.6). */
const SITE_LABELS = {
  R: 'Valeur foncière',
  C: 'Attractivité commerciale',
  O: 'Attractivité tertiaire',
  I: 'Attractivité industrielle',
  IA: 'Attractivité agricole',
  IX: 'Attractivité industrielle',
  IF: 'Attractivité industrielle',
  CH: 'Attractivité commerciale'
};

/** Valeur d'implantation d'une case pour un bâtiment : valeur foncière (logement) ou attractivité économique. */
export function siteValueOf(g, i, def) {
  if (!def.zoneCode || def.zoneCode <= 2) return g.landValue[i];
  const v = g.siteValue?.[i];
  return v === undefined ? g.landValue[i] : v;
}

/** Libellés des conditions d'évolution (affichés dans l'inspecteur). */
const REQUIREMENT_LABELS = {
  power: 'Électricité',
  water: 'Eau courante',
  waste: 'Déchets collectés',
  education: 'Couverture éducative',
  health: 'Couverture santé',
  transit: 'Desserte en transports en commun',
  era2: 'Ère « Ville autonome »',
  era3: 'Ère « Ville symbiotique »'
};

/**
 * Conditions pour passer au niveau suivant (satisfaction et besoins).
 * Utilisé par la simulation et par l'inspecteur, qui affiche la liste au joueur.
 * @returns {{key:string, label:string, ok:boolean, detail?:string}[]}
 */
export function growthChecks(state, b, def) {
  if (!def.growth.next) return [];
  const g = state.grid;
  const i = g.idx(b.x, b.y);
  const zoneKey = ZONE_KEYS[def.zoneCode];
  const occupancy = def.capacity.residents ? b.residents / def.capacity.residents : b.jobsFilled / Math.max(1, def.capacity.jobs);
  const sat = def.capacity.residents ? b.satisfaction : state.stats.satisfaction;
  const minSat = Math.max(def.capacity.residents ? 52 : 0, def.growth.minSatisfaction ?? 0);
  const era = state.progression?.era ?? 1;
  const site = siteValueOf(g, i, def);
  const checks = [
    { key: 'occupancy', label: def.capacity.residents ? 'Logements occupés à 85 %' : 'Emplois pourvus à 85 %', ok: occupancy >= 0.85, detail: `${Math.round(occupancy * 100)} %` },
    { key: 'landValue', label: `${SITE_LABELS[zoneKey === 'R' ? 'R' : def.zone] ?? 'Valeur foncière'} ≥ ${def.growth.minLandValue}`, ok: site >= def.growth.minLandValue, detail: `${Math.round(site)}` },
    { key: 'demand', label: 'Demande du secteur', ok: state.demand[zoneKey] > 5, detail: `${Math.round(state.demand[zoneKey])}` }
  ];
  if (minSat > 0) {
    checks.push({ key: 'satisfaction', label: `${def.capacity.residents ? 'Satisfaction des habitants' : 'Satisfaction de la ville'} ≥ ${minSat}`, ok: sat >= minSat, detail: `${Math.round(sat)}` });
  }
  for (const r of def.growth.requires) {
    let ok = true;
    let detail;
    switch (r) {
      case 'power':
        ok = !!b.powered;
        break;
      case 'water':
        ok = !!b.watered;
        break;
      case 'waste':
        ok = (b.wasteCollectedRatio ?? 0) >= 0.85;
        detail = `${Math.round((b.wasteCollectedRatio ?? 0) * 100)} %`;
        break;
      case 'education':
        ok = g.coverEducation[i] >= 0.4;
        detail = `${Math.round(g.coverEducation[i] * 100)} %`;
        break;
      case 'health':
        ok = g.coverHealth[i] >= 0.4;
        detail = `${Math.round(g.coverHealth[i] * 100)} %`;
        break;
      case 'transit': {
        const t = Math.max(g.transitBus[i], g.transitMetro[i], g.transitRail[i]);
        ok = t >= 0.3;
        detail = `${Math.round(t * 100)} %`;
        break;
      }
      case 'era2':
        ok = era >= 2;
        break;
      case 'era3':
        ok = era >= 3;
        break;
      default:
        ok = false;
    }
    checks.push({ key: r, label: REQUIREMENT_LABELS[r] ?? r, ok, detail });
  }
  return checks;
}

/**
 * Cycle de vie des bâtiments privés sur les zones :
 * apparition (selon la demande, la valeur foncière, l'accès routier et électrique),
 * évolution de niveau, déclin, abandon et effondrement.
 */
export class BuildingSystem {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, network: import('../systems/RoadNetwork.js').RoadNetwork, bus?: any}} deps
   */
  constructor({ catalog, network, bus }) {
    this.catalog = catalog;
    this.network = network;
    this.bus = bus;
  }

  /** Recalcule l'accès routier de chaque bâtiment (après une modification du réseau). */
  refreshAccess(state) {
    for (const b of state.buildings.values()) b.access = BuildingSystem.accessOf(state, b);
  }

  /** Route desservant un bâtiment : route contiguë, sinon (petits bâtiments) route proche via une allée privée. */
  static accessOf(state, b) {
    const g = state.grid;
    let access = findAccess(state, b.x, b.y, b.w, b.h);
    if (access < 0 && b.w === 1 && b.h === 1) {
      const i = g.idx(b.x, b.y);
      if (g.roadDist[i] <= ROAD_REACH) access = g.nearestRoad[i];
    }
    return access;
  }

  /** Parcelle zonée, libre, desservie, alimentée et reliée au réseau régional. */
  #canGrowOn(state, i) {
    const g = state.grid;
    if (!g.zone[i] || g.building[i] || g.road[i]) return false;
    if (g.roadDist[i] > ROAD_REACH) return false;
    const r = g.nearestRoad[i];
    if (r < 0 || !g.powered[r]) return false;
    return this.network.isConnectedToOutside(r);
  }

  update(state, dt) {
    this.#spawn(state);
    this.#evolve(state, dt);
  }

  #spawn(state) {
    const g = state.grid;
    const mods = state.modifiers;
    const candidates = Object.fromEntries(ZONE_CODES.map((c) => [c, []]));
    for (let i = 0; i < g.size; i++) {
      const z = g.zone[i];
      if (z && this.#canGrowOn(state, i)) candidates[z].push(i);
    }
    for (const code of ZONE_CODES) {
      const list = candidates[code];
      if (!list.length) continue;
      const demand = state.demand[ZONE_KEYS[code]];
      if (demand <= 3) continue;
      const starts = this.catalog.growableStarts(code);
      if (!starts.length) continue;
      const small = starts.filter((d) => d.footprint.w === 1 && d.footprint.h === 1);
      const large = starts.filter((d) => d.footprint.w * d.footprint.h > 1);
      let growth = mods['growth.all'] ?? 1;
      if (code <= 2) growth *= mods['growth.R'] ?? 1;
      const attempts = Math.min(list.length, 1 + Math.floor(demand / 6));
      for (let a = 0; a < attempts; a++) {
        const k = state.rng.int(0, list.length - 1);
        const i = list[k];
        if (g.building[i]) continue;
        const lvFactor = 0.55 + (code <= 2 ? g.landValue[i] : g.siteValue[i]) / 110;
        // Fiscalité du quartier (v0.8) : un quartier moins taxé attire les constructions de son secteur
        const local = districtGrowthFactor(state, g.xOf(i), g.yOf(i), ZONE_KEYS[code]);
        if (!state.rng.chance((demand / 100) * 0.9 * lvFactor * growth * local)) continue;
        // Format et variante (v0.6) : tirages par hachage, pour ne pas perturber le générateur de la partie
        const t = state.time.tick;
        let def = null;
        let rot = 0;
        if (large.length && (!small.length || hash2(i, t, 91) < LARGE_CHANCE)) {
          const order = [...large].sort((a, z) => hash2(i, t + a.footprint.w * 7 + a.footprint.h, 13) - hash2(i, t + z.footprint.w * 7 + z.footprint.h, 13));
          for (const d of order) {
            for (const r of d.footprint.w === d.footprint.h ? [0] : [0, 1]) {
              if (this.#fits(state, i, d, r, code)) {
                def = d;
                rot = r;
                break;
              }
            }
            if (def) break;
          }
        }
        if (!def) def = pickWeighted(small, hash2(i, t, 57));
        if (!def) continue;
        const b = createBuilding(state, def, g.xOf(i), g.yOf(i), rot, 'growth');
        b.access = BuildingSystem.accessOf(state, b);
        // Chantier : le bâtiment n'est livré qu'après son délai de construction
        b.constructionStart = state.time.tick;
        b.constructionUntil = state.time.tick + constructionDaysFor(def);
        this.bus?.emit('building:added', { building: b });
        this.bus?.emit('world:changed', { tiles: footprintTilesOf(g, b), reason: 'growth' });
      }
    }
  }

  /** L'emprise d'un grand format tient-elle sur des cases zonées libres de la même zone ? */
  #fits(state, i, def, rot, code) {
    const g = state.grid;
    const w = rot % 2 === 0 ? def.footprint.w : def.footprint.h;
    const h = rot % 2 === 0 ? def.footprint.h : def.footprint.w;
    const x0 = g.xOf(i);
    const y0 = g.yOf(i);
    if (!g.inBounds(x0 + w - 1, y0 + h - 1)) return false;
    let alt = -1;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const j = g.idx(x0 + dx, y0 + dy);
        if (g.zone[j] !== code || g.building[j] || g.road[j]) return false;
        if (alt < 0) alt = g.altitude[j];
        else if (g.altitude[j] !== alt) return false;
      }
    }
    // Un grand format doit toucher une route (pas d'allée privée comme pour une maison)
    return findAccess(state, x0, y0, w, h) >= 0;
  }

  #evolve(state, dt) {
    const g = state.grid;
    const cat = this.catalog;
    const mods = state.modifiers;
    const toRemove = [];
    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      if (def.kind !== 'growable') continue;
      const c = b.counters;
      const i = g.idx(b.x, b.y);
      const zoneKey = ZONE_KEYS[def.zoneCode];

      // Ruines (v0.7) : rien n'évolue tant que les propriétaires n'ont pas lancé la reconstruction
      if (b.ruins) continue;
      // Chantier en cours : rien n'évolue ; à la livraison, le bâtiment (ou son nouveau niveau) entre en service
      if (b.constructionUntil !== undefined) {
        if (isUnderConstruction(state, b) && g.zone[i] === def.zoneCode) continue;
        this.#deliver(state, b);
        continue;
      }
      const needsPower = true;
      const needsWater = def.level >= 2;

      // Dézonage par le joueur : le bâtiment est abandonné.
      if (g.zone[i] !== def.zoneCode && !b.abandoned) {
        this.#abandon(state, b, 'zonage retiré');
        continue;
      }

      const noRoad = b.access < 0 || !this.network.isConnectedToOutside(b.access);
      c.noRoad = noRoad ? (c.noRoad ?? 0) + dt : 0;
      c.noPower = needsPower && !b.powered ? (c.noPower ?? 0) + dt : 0;
      c.noWater = needsWater && !b.watered ? (c.noWater ?? 0) + dt : 0;

      let unhappy = false;
      if (def.capacity.residents) unhappy = b.satisfaction < 22;
      else if (def.category === 'commerce') unhappy = state.stats.salesRatio < 0.35 && state.stats.population > 200;
      else if (def.capacity.jobs) unhappy = b.jobsFilled / def.capacity.jobs < 0.15 && state.stats.workforce > 100;
      c.unhappy = unhappy ? (c.unhappy ?? 0) + dt : 0;

      if (b.abandoned) {
        c.abandoned = (c.abandoned ?? 0) + dt;
        const recovered = !noRoad && b.powered && state.demand[zoneKey] > 15 && g.zone[i] === def.zoneCode;
        if (recovered && state.rng.chance(0.05)) {
          b.abandoned = false;
          b.counters = {};
          this.bus?.emit('building:changed', { building: b });
        } else if (c.abandoned >= SIM.COLLAPSE_ABANDONED_DAYS) {
          toRemove.push(b);
        }
        continue;
      }

      if (c.noRoad >= SIM.ABANDON_NO_ROAD_DAYS) {
        this.#abandon(state, b, 'plus d\'accès routier');
        continue;
      }
      if (c.noPower >= SIM.ABANDON_NO_POWER_DAYS) {
        this.#abandon(state, b, 'privé d\'électricité');
        continue;
      }
      if (c.unhappy >= SIM.ABANDON_UNHAPPY_DAYS || c.noWater >= SIM.ABANDON_NO_POWER_DAYS) {
        const lower = this.#levelDef(def, def.level - 1);
        if (lower) {
          changeBuildingDef(state, b, lower);
          this.bus?.emit('building:changed', { building: b });
          this.bus?.emit('notify', { level: 'warning', message: `Déclin : ${def.name} redevient ${lower.name}`, x: b.x, y: b.y, key: 'decline' });
        } else {
          this.#abandon(state, b, 'quartier en déclin');
        }
        continue;
      }

      // Évolution de niveau : toutes les conditions doivent être remplies pendant UPGRADE_STABLE_DAYS
      if (def.growth.next) {
        const next = cat.building(def.growth.next);
        const ok = growthChecks(state, b, def).every((x) => x.ok);
        c.upgrade = ok ? (c.upgrade ?? 0) + dt : 0;
        let growth = mods['growth.all'] ?? 1;
        if (def.capacity.residents) growth *= mods['growth.R'] ?? 1;
        if (ZONE_KEYS[def.zoneCode]) growth *= districtGrowthFactor(state, b.x, b.y, ZONE_KEYS[def.zoneCode]);
        if (c.upgrade >= SIM.UPGRADE_STABLE_DAYS && state.rng.chance(0.25 * growth)) {
          // Travaux de montée de niveau : 1,25 fois le délai du niveau précédent
          b.upgradeTo = next.id;
          b.constructionStart = state.time.tick;
          b.constructionUntil = state.time.tick + constructionDaysFor(next);
          c.upgrade = 0;
          this.bus?.emit('building:changed', { building: b });
        }
      }
    }
    for (const b of toRemove) {
      removeBuilding(state, b);
      this.bus?.emit('building:removed', { building: b });
      this.bus?.emit('world:changed', { tiles: [g.idx(b.x, b.y)], reason: 'collapse' });
    }
  }

  /** Fin de chantier : construction neuve livrée ou nouveau niveau atteint. */
  #deliver(state, b) {
    const next = b.upgradeTo ? this.catalog.buildings.get(b.upgradeTo) : null;
    delete b.constructionUntil;
    delete b.constructionStart;
    delete b.upgradeTo;
    b.deliveredTick = state.time.tick;
    b.counters = {};
    if (next) {
      changeBuildingDef(state, b, next);
      if (next.level >= 3) this.bus?.emit('notify', { level: 'success', message: `Nouveau : ${next.name} (niveau ${next.level})`, x: b.x, y: b.y, key: `upgrade${next.level}` });
    }
    // Les réseaux sont recalculés tout de suite : pas de fausse alerte « sans électricité » à la livraison
    state.dirty.utilities = true;
    this.bus?.emit('building:changed', { building: b });
  }

  #levelDef(def, level) {
    if (level < 1) return null;
    const list = this.catalog.growablesByZone.get(def.zoneCode) ?? [];
    // Même filière d'abord (le bâtiment dont celui-ci est l'évolution), sinon même format et même niveau
    const same = (d) => d.footprint.w === def.footprint.w && d.footprint.h === def.footprint.h;
    return list.find((d) => d.level === level && d.growth.next === def.id) ?? list.find((d) => d.level === level && same(d)) ?? null;
  }

  #abandon(state, b, why) {
    b.abandoned = true;
    state.stats.departures += b.residents;
    b.residents = 0;
    b.employed = 0;
    b.workforce = 0;
    b.jobsFilled = 0;
    b.counters = { abandoned: 0 };
    state.dirty.utilities = true;
    this.bus?.emit('building:changed', { building: b });
    this.bus?.emit('notify', { level: 'warning', message: `Bâtiment abandonné (${why})`, x: b.x, y: b.y, key: 'abandon' });
  }
}
