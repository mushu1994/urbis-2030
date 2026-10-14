import { Grid } from '../world/Grid.js';
import { Rng } from '../util/rng.js';
import { generateFullWorld, copyRegion, placeEntry } from '../world/WorldGenerator.js';
import { defaultLand, PARCEL, MAX_WORLD } from '../world/Land.js';
import { SIM } from '../simulation/config.js';
import { toCents } from '../util/money.js';
import { defaultWeather } from '../simulation/WeatherSystem.js';
import { defaultCrises, defaultOptions } from '../simulation/CrisisSystem.js';
import { defaultPolitics } from '../simulation/PoliticsSystem.js';
import { defaultResources } from '../simulation/ResourceSystem.js';

/**
 * @typedef {Object} Building
 * @property {number} id
 * @property {string} defId
 * @property {number} x  coin nord de l'emprise
 * @property {number} y
 * @property {number} w  emprise effective (après rotation)
 * @property {number} h
 * @property {number} rot 0 ou 1
 * @property {'player'|'growth'} origin
 * @property {number} builtTick
 * @property {number} residents
 * @property {number} workforce
 * @property {number} employed
 * @property {number} qualification 0..1
 * @property {number} jobsFilled
 * @property {number} satisfaction 0..100
 * @property {number} rent loyer mensuel moyen
 * @property {boolean} powered
 * @property {boolean} watered
 * @property {number} access indice de la case de route desservant le bâtiment (-1 si aucune)
 * @property {boolean} abandoned
 * @property {Object<string, number>} counters compteurs de jours (déclin, évolution)
 * @property {number} commute temps de trajet moyen (minutes)
 * @property {number} assetId immobilisation comptable associée (0 si privé)
 */

/**
 * État complet d'une partie. Ne contient que des données (pas de logique de règles ni d'objets graphiques),
 * ce qui permet de le sérialiser, de le tester et de le rejouer de façon déterministe.
 */
export class GameState {
  /**
   * @param {{grid: Grid, seed:number, name:string}} p
   */
  constructor({ grid, seed, name }) {
    this.meta = { name, seed, createdAt: Date.now() };
    this.grid = grid;
    /** @type {Map<number, Building>} */
    this.buildings = new Map();
    this.nextBuildingId = 1;
    /** Cases d'entrée sur le réseau régional. */
    this.entries = [];
    this.time = { tick: 0 };
    /** Révisions des réseaux (invalident les calculs incrémentaux). */
    this.revisions = { roads: 0 };
    this.rng = new Rng(seed);

    this.economy = {
      treasury: toCents(SIM.START_TREASURY_EUROS),
      /** Trésorerie d'ouverture : permet de vérifier que la trésorerie égale le cumul du journal. */
      opening: toCents(SIM.START_TREASURY_EUROS),
      nextTxId: 1,
      ledger: [],
      taxes: { ...SIM.START_TAXES },
      tariffs: { ...SIM.START_TARIFFS },
      /** Bases fiscales cumulées sur le mois en cours (somme des valeurs journalières). */
      accrual: emptyAccrual(),
      current: null,
      periods: [],
      assets: [],
      nextAssetId: 1,
      loans: [],
      nextLoanId: 1,
      monthsNegative: 0
    };

    this.tech = { researched: {}, outages: {} };
    this.policies = { active: {} };
    this.events = { active: [], history: [] };

    this.demand = { R: 60, C: 20, O: 10, I: 40 };
    this.stats = emptyStats();
    this.history = [];

    /** État incrémental de l'affectation du trafic (sauvegardé pour la reprise exacte). */
    this.traffic = { cursor: 0, origins: [], acc: null, cycle: 0, stats: {} };
    this.logistics = { stats: {} };
    this.transit = { stats: {}, passengersPerDay: 0 };
    this.waste = { stats: {} };
    /** Ère de progression (1 : connectée, 2 : autonome, 3 : symbiotique). */
    this.progression = { era: 1, eraSince: 0 };
    /** Échanges avec la région : vente des excédents, achat en cas de pénurie (prix prohibitif). */
    this.trade = defaultTrade();
    this.utilities = { power: {}, water: {}, batteryCharge: 0 };
    /** Météo du jour (tirée de façon déterministe). */
    this.weather = defaultWeather();
    /** Catastrophes et crises en cours et passées. */
    this.crises = defaultCrises();
    /** Scénario en cours (null en partie libre). */
    this.scenario = null;
    /** Options de partie qui influencent la simulation (fréquence des catastrophes). */
    this.options = defaultOptions('normal');
    /** Territoire de la commune : parcelles achetées (v0.6). */
    this.land = defaultLand(grid.width, grid.height);
    /** Vie politique : popularité, mandat, campagne, élections (v0.7). */
    this.politics = defaultPolitics(this);
    /** Ressources : cours, chocs et bilan du dernier mois (v0.7). */
    this.resources = defaultResources();

    /** Modificateurs effectifs (dérivés des technologies, politiques et événements ; recalculés). */
    this.modifiers = {};
    /** Indicateurs de recalcul (non sauvegardés). */
    this.dirty = { roads: true, utilities: true, environment: true, modifiers: true, roadReach: true };
  }

  /**
   * Crée une nouvelle partie avec un terrain généré.
   * @param {{catalog: import('../data/Catalog.js').Catalog, seed?:number, width?:number, height?:number, name?:string}} p
   */
  static createNew({ catalog, seed = 2030, width = 64, height = 64, name = 'Nouvelle ville', mapParams = null }) {
    // v0.7 : le monde complet (256 × 256) est généré d'emblée ; la carte de départ en est découpée et les parcelles
    // achetées ensuite en recopient les cases, sans couture de relief ni d'eau.
    const grid = new Grid(width, height);
    const land = defaultLand(width, height);
    const core = { x: land.box.x0 * PARCEL, y: land.box.y0 * PARCEL, width, height };
    const world = generateFullWorld(Grid, { seed, params: mapParams ?? {}, core, size: MAX_WORLD });
    copyRegion(world, grid, core.x, core.y);
    const entries = placeEntry(grid, catalog.road('road_highway').code);
    const s = new GameState({ grid, seed, name });
    s.entries = entries;
    s.meta.worldGen = 2;
    s.meta.worldCore = core;
    if (mapParams) s.meta.mapParams = { ...mapParams };
    return s;
  }

  /** Bâtiment occupant la case (x, y), ou undefined. */
  buildingAt(x, y) {
    const id = this.grid.building[this.grid.idx(x, y)];
    return id ? this.buildings.get(id) : undefined;
  }
}

/** Réglages d'échanges régionaux par défaut : tout est désactivé. */
export function defaultTrade() {
  return {
    power: { sell: false, buy: false },
    water: { sell: false, buy: false },
    waste: { buy: false },
    stats: {}
  };
}

export function emptyAccrual() {
  return {
    days: 0,
    taxR: 0,
    taxC: 0,
    taxO: 0,
    taxI: 0,
    property: 0,
    water: 0,
    power: 0,
    logisticsUnits: 0,
    transit: 0,
    transitOps: 0,
    recycling: 0
  };
}

export function emptyStats() {
  return {
    population: 0,
    households: { low: 0, mid: 0, high: 0 },
    ages: { young: 0, adult: 0, senior: 0 },
    workforce: 0,
    employed: 0,
    unemployed: 0,
    unemploymentRate: 0,
    commutersOut: 0,
    commutersIn: 0,
    jobs: 0,
    jobsFilled: 0,
    jobsByBracket: { low: 0, mid: 0, high: 0 },
    workersByBracket: { low: 0, mid: 0, high: 0 },
    unemployedByBracket: { low: 0, mid: 0, high: 0 },
    housingCapacity: 0,
    housingVacancy: 0,
    satisfaction: 50,
    satisfactionByIncome: { low: 50, mid: 50, high: 50 },
    avgRent: 0,
    consumption: 0,
    salesCapacity: 0,
    salesRatio: 0,
    goodsProduced: 0,
    goodsNeeded: 0,
    arrivals: 0,
    departures: 0,
    buildingsByZone: {},
    abandoned: 0,
    avgLandValue: 0,
    avgPollution: 0,
    avgHeat: 0
  };
}
