import { describe, it, expect } from 'vitest';
import { newSession, getCatalog } from '../helpers/session.js';
import { buildStarterTown, placeNear } from '../../src/app/scenarios.js';
import { EconomySystem } from '../../src/simulation/EconomySystem.js';
import { computeModifiers } from '../../src/simulation/Modifiers.js';
import { GameSession } from '../../src/app/GameSession.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { checksum } from '../../src/util/encoding.js';

function grownTown(months = 18) {
  const s = newSession();
  const town = buildStarterTown(s, { size: 'large' });
  s.run(90);
  for (const id of ['police', 'fire', 'school', 'clinic']) placeNear(s, id, town.xEnd - 6, town.row - 2);
  s.run(months * 30 - 90);
  return { s, town };
}

describe('Ville simulée (intégration)', () => {
  const { s, town } = grownTown(18);
  const st = s.state;

  it('la ville croît et respecte les capacités des bâtiments', () => {
    expect(st.stats.population).toBeGreaterThan(600);
    for (const b of st.buildings.values()) {
      const def = s.catalog.building(b.defId);
      expect(b.residents).toBeLessThanOrEqual(def.capacity.residents);
      expect(b.jobsFilled).toBeLessThanOrEqual(def.capacity.jobs);
      expect(b.employed).toBeLessThanOrEqual(b.workforce);
    }
    expect(st.stats.employed).toBeLessThanOrEqual(st.stats.workforce);
    for (const v of Object.values(st.demand)) expect(Math.abs(v)).toBeLessThanOrEqual(100);
  });

  it('aucune valeur non numérique dans les indicateurs', () => {
    const walk = (o, path) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number') expect(Number.isFinite(v), `${path}.${k}`).toBe(true);
        else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) walk(v, `${path}.${k}`);
      }
    };
    walk(st.stats, 'stats');
    walk(st.utilities, 'utilities');
    walk(st.traffic.stats, 'traffic');
  });

  it('la trésorerie se rapproche exactement du journal des transactions', () => {
    const sum = st.economy.ledger.reduce((x, t) => x + t.amount, 0);
    expect(st.economy.ledger.length).toBeLessThan(4000);
    expect(st.economy.treasury).toBe(40_000_000 + sum);
    for (const p of st.economy.periods) {
      expect(p.cashEnd - p.cashStart).toBe(EconomySystem.summarize(p).cashChange);
    }
  });

  it('le trafic est affecté au réseau et la congestion est mesurée', () => {
    const t = st.traffic.stats;
    expect(t.cycle).toBeGreaterThan(3);
    expect(t.vehicleTrips).toBeGreaterThan(100);
    expect(t.topAxes.length).toBeGreaterThan(0);
    expect(t.avgCommute).toBeGreaterThan(0);
    const g = st.grid;
    let flowOnRoads = 0;
    for (let i = 0; i < g.size; i++) {
      if (!g.road[i]) expect(g.traffic[i]).toBe(0);
      else flowOnRoads += g.traffic[i];
    }
    expect(flowOnRoads).toBeGreaterThan(0);
  });

  it('l\'environnement agit sur la valeur foncière (pollution autour de la centrale)', () => {
    const g = st.grid;
    const plant = [...st.buildings.values()].find((b) => b.defId === 'power_gas');
    const near = g.pollution[g.idx(plant.x + 1, plant.y + 1)];
    expect(near).toBeGreaterThan(10);
    expect(st.stats.avgLandValue).toBeGreaterThan(0);
  });

  it('se recharge à tout moment sans diverger', () => {
    for (const ticks of [7, 31]) {
      const copy = new GameSession({ catalog: getCatalog(), state: deserializeState(JSON.parse(JSON.stringify(serializeState(st)))) });
      const clone = new GameSession({ catalog: getCatalog(), state: deserializeState(JSON.parse(JSON.stringify(serializeState(st)))) });
      copy.run(ticks);
      const mid = new GameSession({ catalog: getCatalog(), state: deserializeState(JSON.parse(JSON.stringify(serializeState(copy.state)))) });
      mid.run(50);
      clone.run(ticks + 50);
      const fp = (x) => { const d = serializeState(x); delete d.meta; return checksum(JSON.stringify(d)); };
      expect(fp(mid.state)).toBe(fp(clone.state));
    }
  });

  it('une coupure d\'électricité conduit au délestage puis à l\'abandon', () => {
    const { s: s2 } = grownTown(6);
    const plant = [...s2.state.buildings.values()].find((b) => b.defId === 'power_gas');
    expect(s2.execute({ type: 'demolish', rect: { x0: plant.x, y0: plant.y, x1: plant.x, y1: plant.y } }).ok).toBe(true);
    s2.run(10);
    expect(s2.state.utilities.power.unpoweredBuildings).toBeGreaterThan(10);
    s2.run(90);
    expect(s2.state.stats.abandoned).toBeGreaterThan(5);
  });

  it('élargir un axe saturé en avenue augmente sa capacité', () => {
    const net = s.sim.network;
    const top = st.traffic.stats.topAxes[0];
    const i = st.grid.idx(top.x, top.y);
    const capBefore = net.segment(st, i).capacity;
    st.stats.peakPopulation = Math.max(st.stats.peakPopulation, 500);
    const r = s.execute({ type: 'road', roadId: 'road_avenue', from: { x: top.x, y: top.y }, to: { x: top.x, y: top.y } });
    expect(r.ok).toBe(true);
    s.run(1);
    expect(net.segment(st, i).capacity).toBeGreaterThan(capBefore);
  });
});

describe('Technologies et logistique', () => {
  it('les véhicules autonomes ont des effets positifs et négatifs, modulés par le calcul et les incidents', () => {
    const s = newSession();
    const st = s.state;
    st.tech.researched.ai_traffic_lights = 0;
    st.tech.researched.autonomous_vehicles = 0;
    const m = computeModifiers(st, s.catalog);
    expect(m.compute.demand).toBe(50);
    expect(m.compute.ratio).toBeCloseTo(30 / 50);
    expect(m.roadCapacityMult).toBeGreaterThan(1);
    expect(m.tripGenerationMult).toBeCloseTo(1.18); // effet secondaire non modulé
    expect(m.emptyTripShare).toBeCloseTo(0.12);
    st.tech.outages.autonomous_vehicles = st.time.tick + 5;
    const m2 = computeModifiers(st, s.catalog);
    expect(m2.tripGenerationMult).toBeCloseTo(1.18);
    expect(m2.roadCapacityMult).toBeLessThan(m.roadCapacityMult);
  });

  it('déployer une technologie est un investissement soumis aux conditions de déblocage', () => {
    const s = newSession();
    expect(s.execute({ type: 'research', techId: 'predictive_maintenance' }).ok).toBe(false);
    s.state.stats.peakPopulation = 700;
    const t0 = s.state.economy.treasury;
    expect(s.execute({ type: 'research', techId: 'predictive_maintenance' }).ok).toBe(true);
    expect(t0 - s.state.economy.treasury).toBe(6_000_000);
    expect(s.state.economy.ledger.at(-1).kind).toBe('capex');
  });

  it('plateformes et micro-hubs réduisent les livraisons routières de façon mesurable', () => {
    const { s, town } = grownTown(8);
    s.run(10);
    const before = structuredClone(s.state.logistics.stats);
    s.state.stats.peakPopulation = Math.max(s.state.stats.peakPopulation, 600);
    s.state.economy.treasury += 50_000_000;
    expect(placeNear(s, 'warehouse', town.xEnd - 10, town.row + 3).ok).toBe(true);
    for (let k = 0; k < 3; k++) placeNear(s, 'micro_hub', town.xEnd - 4 - k * 6, town.row - 3);
    s.run(30);
    const after = s.state.logistics.stats;
    expect(after.outsideShare).toBeLessThanOrEqual(before.outsideShare);
    expect(after.supplierCapacity).toBeGreaterThan(before.supplierCapacity);
    expect(after.servedBy.cargo).toBeGreaterThan(0);
    expect(after.roadTripsAvoided).toBeGreaterThan(0);
    expect(after.avgDelayHours).toBeLessThan(before.avgDelayHours);
  });
});
