import { SIM } from './config.js';
import { EconomySystem } from './EconomySystem.js';
import { UtilitySystem } from './UtilitySystem.js';
import { PopulationSystem } from './PopulationSystem.js';
import { BuildingSystem } from './BuildingSystem.js';
import { EnvironmentSystem } from './EnvironmentSystem.js';
import { TrafficSystem } from './TrafficSystem.js';
import { AISystem } from './AISystem.js';
import { RoadNetwork } from '../systems/RoadNetwork.js';
import { TransportService } from '../systems/TransportService.js';
import { EventSystem } from '../systems/EventSystem.js';
import { WasteSystem } from './WasteSystem.js';
import { TransitSystem } from './TransitSystem.js';
import { ProgressionSystem } from './ProgressionSystem.js';
import { RouteService } from '../systems/RouteService.js';
import { WeatherSystem } from './WeatherSystem.js';
import { CrisisSystem } from './CrisisSystem.js';
import { ScenarioSystem } from './ScenarioSystem.js';
import { PoliticsSystem } from './PoliticsSystem.js';
import { ResourceSystem } from './ResourceSystem.js';
import { MarketSystem } from './MarketSystem.js';
import { LineSystem } from './LineSystem.js';
import { MilestoneSystem } from './Milestones.js';
import { CouncilSystem } from './CouncilSystem.js';
import { ControversySystem } from './ControversySystem.js';
import { CivicEventSystem } from './CivicEventSystem.js';
import { CrimeSystem } from './CrimeSystem.js';

/**
 * Orchestrateur de la simulation (indépendant du rendu et de l'interface).
 * `step()` fait avancer le monde d'un tick (un jour). Les sous-systèmes sont actualisés à des
 * fréquences adaptées à leur coût. Le résultat ne dépend que de l'état initial, des actions du joueur
 * et du nombre de ticks — jamais du nombre d'images affichées.
 */
export class Simulation {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, bus?: import('../app/EventBus.js').EventBus}} deps
   */
  constructor({ catalog, bus }) {
    this.catalog = catalog;
    this.bus = bus;
    this.network = new RoadNetwork(catalog);
    this.transport = new TransportService();
    this.economy = new EconomySystem({ catalog, bus });
    this.utilities = new UtilitySystem({ catalog, bus });
    this.population = new PopulationSystem({ catalog, network: this.network, transport: this.transport });
    this.buildingSystem = new BuildingSystem({ catalog, network: this.network, bus });
    this.environment = new EnvironmentSystem({ catalog });
    this.traffic = new TrafficSystem({ catalog, network: this.network, transport: this.transport, bus });
    this.ai = new AISystem({ catalog, economy: this.economy, bus });
    this.events = new EventSystem({ catalog, bus });
    this.waste = new WasteSystem({ catalog, bus });
    this.transit = new TransitSystem({ catalog, network: this.network });
    this.progression = new ProgressionSystem({ bus });
    this.routes = new RouteService({ network: this.network });
    this.weather = new WeatherSystem({ bus });
    this.crises = new CrisisSystem({ catalog, economy: this.economy, bus });
    this.scenario = new ScenarioSystem({ bus });
    this.politics = new PoliticsSystem({ catalog, economy: this.economy, bus });
    this.resources = new ResourceSystem({ catalog, economy: this.economy, bus });
    // v0.8 : marché régional à prix variables, lignes de bus et de tramway
    this.market = new MarketSystem({ bus, economy: this.economy });
    this.economy.market = this.market;
    this.lines = new LineSystem({ catalog, economy: this.economy, bus });
    this.economy.lines = this.lines;
    // v1.0 : statut de la ville (paliers, dotations)
    this.milestones = new MilestoneSystem({ economy: this.economy, catalog, bus });
    // v1.1 : conseil municipal, adjoints et priorités du mandat
    this.council = new CouncilSystem({ economy: this.economy, catalog, bus });
    this.politics.council = this.council;
    // v1.2 : polémiques et journal local, événements populaires
    this.controversies = new ControversySystem({ economy: this.economy, catalog, bus });
    this.civic = new CivicEventSystem({ economy: this.economy, catalog, bus });
    // v1.5 : cambriolages et braquages (tirages déterministes indépendants du générateur de la partie)
    this.crime = new CrimeSystem({ catalog, bus });
    this.politics.controversies = this.controversies;
    /** Temps de calcul par sous-système (ms, moyenne glissante) — affiché dans le panneau de performance. */
    this.timings = {};
  }

  /**
   * Prépare les structures dérivées d'un état (nouvelle partie ou partie chargée), sans modifier
   * la révision du réseau : une partie rechargée reprend exactement le même calcul.
   */
  attach(state) {
    this.network.rebuild(state);
    this.network.computeReach(state);
    this.buildingSystem.refreshAccess(state);
    state.dirty.roads = false;
    state.dirty.roadReach = false;
    if (!state.modifiers || !('roadCapacityMult' in state.modifiers)) this.ai.refreshModifiers(state);
    this.economy.ensurePeriod(state);
    this.market.ensure(state);
    this.environment.waterProximity = null;
  }

  #time(name, fn) {
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    this.timings[name] = this.timings[name] === undefined ? dt : this.timings[name] * 0.9 + dt * 0.1;
  }

  /** Avance d'un tick. */
  step(state) {
    const F = SIM.FREQ;
    const t = state.time.tick;

    if (state.dirty.modifiers) this.ai.refreshModifiers(state);
    if (state.dirty.roads || state.dirty.roadReach) {
      this.#time('network', () => {
        this.network.rebuild(state);
        this.network.computeReach(state);
        this.buildingSystem.refreshAccess(state);
      });
      state.revisions.roads++;
      state.dirty.roads = false;
      state.dirty.roadReach = false;
      this.bus?.emit('network:rebuilt', { revision: state.revisions.roads });
    }
    if (t % F.utilities === 0 || state.dirty.utilities) {
      this.#time('utilities', () => this.utilities.update(state));
      state.dirty.utilities = false;
    }
    if (t % F.services === 0 || state.dirty.environment) this.#time('services', () => this.environment.updateCoverage(state));
    if (t % F.population === 0) this.#time('population', () => this.population.update(state));
    if (t % F.demand === 0) this.population.updateDemand(state);
    if (t % F.growth === 0) this.#time('growth', () => this.buildingSystem.update(state, F.growth));
    if (t % F.environment === 0 || state.dirty.environment) {
      this.#time('environment', () => this.environment.update(state));

      state.dirty.environment = false;
      this.bus?.emit('fields:updated', { fields: ['pollution', 'noise', 'landValue', 'heat', 'green', 'density'] });
    }
    if (t % 30 === 15) {
      // Repousse naturelle des forêts, une fois par mois
      const grown = this.environment.regrowForests(state);
      if (grown.length) this.bus?.emit('world:changed', { tiles: grown, reason: 'forest' });
    }
    if (t % F.logistics === 0) this.#time('logistics', () => this.ai.updateLogistics(state));
    // Décalés dans le cycle de 10 jours pour répartir la charge de calcul
    if (t % F.waste === 3) this.#time('waste', () => this.waste.update(state, F.waste));
    if (t % F.transit === 6 || state.dirty.transit) {
      this.#time('transit', () => {
        this.lines.validate(state);
        this.transit.update(state);
      });
      state.dirty.transit = false;
    }
    this.#time('traffic', () => this.traffic.step(state));
    this.economy.accrueDaily(state);

    state.time.tick++;
    this.events.daily(state);
    this.milestones.daily(state);
    this.weather.daily(state);
    this.crises.daily(state);
    if (!state.meta?.preparing) this.crime.daily(state);
    this.council.daily(state, this.crises);
    this.politics.daily(state);

    if (state.time.tick % SIM.DAYS_PER_MONTH === 0) this.#monthEnd(state);
    this.bus?.emit('sim:tick', { tick: state.time.tick });
  }

  #monthEnd(state) {
    // Les modificateurs sont recalculés avant la clôture (saisonnalité, incidents en cours).
    this.ai.refreshModifiers(state);
    // Ressources (v0.7) : importations et exportations du mois, avant la clôture des comptes
    this.#time('resources', () => this.resources.monthly(state));
    this.council.monthly(state);
    this.civic.monthly(state);
    this.crime.monthly(state);
    const period = this.economy.closeMonth(state);
    // Marché régional (v0.8) : nouveaux cours pour le mois qui commence
    this.market.monthly(state);
    const sum = EconomySystem.summarize(period);
    const s = state.stats;
    state.history.push({
      monthIndex: period.monthIndex,
      population: s.population,
      treasury: state.economy.treasury,
      revenues: sum.revenues,
      opex: sum.opex,
      netResult: sum.netResult,
      unemployment: s.unemploymentRate,
      satisfaction: s.satisfaction,
      congestion: state.traffic.stats?.avgCongestion ?? 0,
      pollution: s.avgPollution,
      arrivals: s.arrivals,
      departures: s.departures,
      demand: { ...state.demand },
      // v1.2 : loyer moyen et part des ménages modestes (polémique « Flambée des loyers »)
      rent: s.avgRent ?? 0,
      low: s.population > 0 ? (s.households?.low ?? 0) / s.population : 0
    });
    if (state.history.length > 240) state.history.shift();
    state.history.at(-1).waste = state.waste.stats?.collectionRate ?? null;
    state.history.at(-1).transit = state.transit.passengersPerDay ?? 0;
    state.history.at(-1).era = state.progression.era;
    s.arrivals = 0;
    s.departures = 0;
    this.progression.monthly(state);
    this.events.monthly(state);
    this.scenario.monthly(state);
    this.#time('politics', () => this.politics.monthly(state));
    this.controversies.monthly(state);
    this.controversies.frontPage(state);
    state.dirty.modifiers = true;
    this.bus?.emit('sim:month', { period, summary: sum });
  }
}
