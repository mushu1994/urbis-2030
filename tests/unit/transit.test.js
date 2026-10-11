import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { fareElasticity, OPERATING_COST, REGIONAL_TRIP_RATE } from '../../src/simulation/TransitSystem.js';
import { trainHead } from '../../src/rendering/TrainRenderer.js';

/** Rue sur la ligne 15, maisons au nord, emplois au sud. */
function corridor(s) {
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
  s.sim.attach(s.state);
  const g = s.state.grid;
  const homes = [];
  for (let x = 4; x <= 24; x += 2) homes.push(spawn(s, 'res_high_2', x, 14, { residents: 60, employed: 30, workforce: 32, access: g.idx(x, 15) }));
  for (let x = 5; x <= 23; x += 2) spawn(s, 'off_2', x, 16, { jobsFilled: 30, access: g.idx(x, 15) });
  s.state.stats.employed = 330;
  s.state.stats.commutersOut = 60;
  s.state.stats.population = homes.length * 60;
  return homes;
}

describe('Transports en commun', () => {
  it('un dépôt sans électricité ne fait pas rouler de bus', () => {
    const s = flatSession();
    corridor(s);
    spawn(s, 'bus_depot', 26, 16, { access: s.state.grid.idx(26, 15), jobsFilled: 20, powered: false });
    spawn(s, 'bus_stop', 10, 12, { access: s.state.grid.idx(10, 15) });
    s.sim.transit.update(s.state);
    expect(s.state.transit.stats.capacity.bus).toBe(0);
  });

  it('un arrêt sans dépôt de bus relié par la route ne dessert rien', () => {
    const s = flatSession();
    const homes = corridor(s);
    spawn(s, 'bus_stop', 10, 13, { access: s.state.grid.idx(10, 15) });
    s.sim.transit.update(s.state);
    expect(s.state.transit.stats.activeStops).toBe(0);
    expect(homes[3].transit.bus).toBe(0);
  });

  it('avec un dépôt, les arrêts desservent leur rayon et des voyageurs prennent le bus', () => {
    const s = flatSession();
    const homes = corridor(s);
    spawn(s, 'bus_depot', 26, 16, { access: s.state.grid.idx(26, 15), jobsFilled: 20, powered: true });
    spawn(s, 'bus_stop', 10, 12, { access: s.state.grid.idx(10, 15) });
    spawn(s, 'bus_stop', 18, 12, { access: s.state.grid.idx(18, 15) });
    s.sim.transit.update(s.state);
    const ts = s.state.transit.stats;
    expect(ts.activeStops).toBe(2);
    expect(ts.passengers.bus).toBeGreaterThan(0);
    expect(ts.passengers.bus).toBeLessThanOrEqual(ts.capacity.bus + 1e-6);
    const near = homes.find((b) => b.x === 10);
    expect(near.transit.bus).toBeGreaterThan(0.05);
    expect(s.state.grid.transitBus[s.state.grid.idx(10, 14)]).toBeGreaterThan(0.9);
  });

  it('la capacité des dépôts limite la fréquentation', () => {
    const s = flatSession();
    corridor(s);
    spawn(s, 'bus_depot', 26, 16, { access: s.state.grid.idx(26, 15), jobsFilled: 0, powered: true });
    for (const x of [6, 10, 14, 18, 22]) spawn(s, 'bus_stop', x, 12, { access: s.state.grid.idx(x, 15) });
    s.state.modifiers['transit.busCapacityMult'] = 0.01;
    s.sim.transit.update(s.state);
    const ts = s.state.transit.stats;
    expect(ts.demand.bus).toBeGreaterThan(ts.capacity.bus);
    expect(ts.passengers.bus).toBeCloseTo(ts.capacity.bus, 6);
  });

  it('le métro exige au moins deux stations alimentées', () => {
    const s = flatSession();
    const homes = corridor(s);
    const a = spawn(s, 'metro_station', 8, 12, { access: s.state.grid.idx(8, 15), powered: true, jobsFilled: 6 });
    s.sim.transit.update(s.state);
    expect(s.state.transit.stats.capacity.metro).toBe(0);
    expect(a.transitActive).toBe(false);
    spawn(s, 'metro_station', 20, 12, { access: s.state.grid.idx(20, 15), powered: true, jobsFilled: 6 });
    s.sim.transit.update(s.state);
    expect(s.state.transit.stats.capacity.metro).toBe(12000);
    expect(homes.find((b) => b.x === 8).transit.metro).toBeGreaterThan(0.1);
  });

  it('la billetterie rapporte, l\'exploitation coûte ; la gratuité supprime les recettes et augmente la fréquentation', () => {
    const s = flatSession();
    corridor(s);
    spawn(s, 'bus_depot', 26, 16, { access: s.state.grid.idx(26, 15), jobsFilled: 20, powered: true });
    for (const x of [6, 12, 18]) spawn(s, 'bus_stop', x, 12, { access: s.state.grid.idx(x, 15) });
    s.sim.transit.update(s.state);
    const pax = s.state.transit.stats.passengers.bus;
    s.sim.economy.accrueDaily(s.state);
    let p = s.sim.economy.closeMonth(s.state);
    expect(p.revenue.transit).toBe(Math.round(pax * 1.2 * 100));
    expect(p.opex.transport).toBeGreaterThanOrEqual(Math.round(pax * OPERATING_COST.bus * 100));
    s.execute({ type: 'policy', policyId: 'free_transit', enabled: true });
    s.sim.ai.refreshModifiers(s.state);
    s.sim.transit.update(s.state);
    expect(s.state.transit.stats.passengers.bus).toBeGreaterThan(pax);
    s.sim.economy.accrueDaily(s.state);
    p = s.sim.economy.closeMonth(s.state);
    expect(p.revenue.transit ?? 0).toBe(0);
  });

  it('la fréquentation baisse quand le billet est cher', () => {
    expect(fareElasticity(0)).toBeGreaterThan(fareElasticity(1.2));
    expect(fareElasticity(1.2)).toBeGreaterThan(fareElasticity(3));
    expect(fareElasticity(10)).toBe(0.4);
  });

  it('les voyageurs du train laissent leur voiture : moins de trafic à l\'entrée de la ville', () => {
    const run = (withTrain) => {
      const s = flatSession();
      corridor(s);
      if (withTrain) spawn(s, 'train_station', 10, 16, { access: s.state.grid.idx(10, 15), powered: true, jobsFilled: 20 });
      s.state.stats.commutersOut = 200;
      s.sim.transit.update(s.state);
      s.state.dirty.roads = true;
      for (let k = 0; k < 4; k++) s.sim.traffic.step(s.state);
      return s.state.grid.traffic[s.state.grid.idx(1, 15)];
    };
    expect(run(true)).toBeLessThan(run(false));
  });

  it('une gare transporte des voyageurs même quand tous les habitants travaillent en ville (régression)', () => {
    const s = flatSession();
    const homes = corridor(s);
    s.state.stats.commutersOut = 0; // plein emploi local : aucune navette sortante
    s.state.stats.commutersIn = 0;
    const gare = spawn(s, 'train_station', 10, 16, { access: s.state.grid.idx(10, 15), powered: true, jobsFilled: 20 });
    s.sim.transit.update(s.state);
    const ts = s.state.transit.stats;
    expect(gare.transitActive).toBe(true);
    expect(ts.passengers.rail).toBeGreaterThan(0);
    expect(gare.transitPassengers).toBeCloseTo(ts.passengers.rail, 6);
    const near = homes.find((b) => b.x === 10);
    expect(near.transit.regional).toBeGreaterThan(0.1);
    // ordre de grandeur : déplacements régionaux des habitants desservis
    expect(ts.passengers.rail).toBeLessThanOrEqual(homes.length * 60 * REGIONAL_TRIP_RATE);
  });

  it('les navetteurs venus de la région arrivent en train quand leur emploi est près de la gare', () => {
    const s = flatSession();
    corridor(s);
    s.state.stats.commutersOut = 0;
    spawn(s, 'train_station', 12, 16, { access: s.state.grid.idx(12, 15), powered: true, jobsFilled: 20 });
    s.state.stats.commutersIn = 0;
    s.sim.transit.update(s.state);
    const without = s.state.transit.stats.passengers.rail;
    s.state.stats.commutersIn = 150;
    s.sim.transit.update(s.state);
    expect(s.state.transit.stats.railInbound).toBeGreaterThan(0);
    expect(s.state.transit.stats.passengers.rail).toBeGreaterThan(without);
  });

  it('avec deux gares, le train assure aussi des trajets internes qui retirent des voitures', () => {
    const s = flatSession();
    const homes = corridor(s);
    s.state.stats.commutersOut = 0;
    spawn(s, 'train_station', 6, 16, { access: s.state.grid.idx(6, 15), powered: true, jobsFilled: 20 });
    s.sim.transit.update(s.state);
    expect(homes.find((b) => b.x === 6).transit.rail).toBe(0);
    spawn(s, 'train_station', 18, 16, { access: s.state.grid.idx(18, 15), powered: true, jobsFilled: 20 });
    s.sim.transit.update(s.state);
    expect(homes.find((b) => b.x === 6).transit.rail).toBeGreaterThan(0.05);
  });

  it('une gare non alimentée ne transporte personne', () => {
    const s = flatSession();
    corridor(s);
    const gare = spawn(s, 'train_station', 10, 16, { access: s.state.grid.idx(10, 15), powered: false, jobsFilled: 20 });
    s.sim.transit.update(s.state);
    expect(gare.transitActive).toBe(false);
    expect(s.state.transit.stats.passengers.rail).toBe(0);
  });

  it('animation des rames : arrivée, arrêt à quai, départ, voie libre', () => {
    expect(trainHead(0)).toBeLessThan(0);
    expect(trainHead(0.45)).toBeCloseTo(0.9, 6);
    expect(trainHead(0.89)).toBeGreaterThan(1.5);
    expect(trainHead(0.95)).toBeNull();
    // mouvement continu : pas de saut entre les phases
    expect(trainHead(0.2999)).toBeCloseTo(trainHead(0.3), 2);
    expect(trainHead(0.6001)).toBeCloseTo(trainHead(0.6), 2);
  });
});
