import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { Catalog } from '../../src/data/Catalog.js';
import { defaultData } from '../../src/data/defaultData.js';

/** Rue sur la ligne 15 et un quartier de maisons habitées au-dessus. */
function town(s, { houses = 12, residents = 60 } = {}) {
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
  s.sim.attach(s.state);
  const list = [];
  for (let k = 0; k < houses; k++) list.push(spawn(s, 'res_high_2', 4 + (k % 12) * 2, 14 - Math.floor(k / 12) * 2, { residents, access: s.state.grid.idx(4 + (k % 12) * 2, 15) }));
  return list;
}

const update = (s, months = 1) => {
  for (let m = 0; m < months * 3; m++) s.sim.waste.update(s.state, 10);
};

describe('Gestion des déchets', () => {
  it('v0.5 : un seul grand centre de tri collecte et traite tout un quartier', () => {
    const s = flatSession();
    town(s, { houses: 24, residents: 120 }); // 288 u/j répartis sur 24 cases de large
    spawn(s, 'recycling', 14, 16, { access: s.state.grid.idx(14, 15), jobsFilled: 40, powered: true });
    update(s, 2);
    const ws = s.state.waste.stats;
    expect(ws.collectionRate).toBeGreaterThan(0.99);
    expect(ws.limitedBy).toBeNull();
    expect(ws.byKind.recycling).toBeCloseTo(ws.generated, 5);
  });

  it('sans installation, rien n\'est collecté : les déchets s\'accumulent et bloquent l\'évolution', () => {
    const s = flatSession();
    const houses = town(s);
    update(s, 2);
    const ws = s.state.waste.stats;
    expect(ws.generated).toBeCloseTo(12 * 60 * 0.1);
    expect(ws.collectionRate).toBe(0);
    expect(ws.limitedBy).toBe('coverage');
    expect(houses[0].garbage).toBeGreaterThan(0.8);
    const f = s.sim.population.satisfactionFactors(s.state, houses[0], s.catalog.building('res_high_2')).factors;
    expect(f.garbage).toBeLessThan(-9);
  });

  it('un centre de collecte et une décharge collectent tout ; la décharge se remplit', () => {
    const s = flatSession();
    const houses = town(s);
    spawn(s, 'waste_depot', 14, 16, { access: s.state.grid.idx(14, 15), jobsFilled: 15, powered: true });
    const lf = spawn(s, 'landfill', 18, 16, { access: s.state.grid.idx(18, 15), jobsFilled: 8 });
    spawn(s, 'waste_depot', 22, 18, { access: s.state.grid.idx(22, 15), jobsFilled: 15, powered: true });
    spawn(s, 'waste_depot', 4, 18, { access: s.state.grid.idx(4, 15), jobsFilled: 15, powered: true });
    update(s, 2);
    const ws = s.state.waste.stats;
    expect(ws.collectionRate).toBeCloseTo(1, 5);
    expect(ws.byKind.landfill).toBeCloseTo(ws.generated, 5);
    expect(lf.landfillUsed).toBeCloseTo(ws.generated * 60, 3);
    expect(houses[0].garbage).toBeLessThan(0.2);
    expect(houses[0].wasteCollectedRatio).toBeCloseTo(1, 5);
  });

  it('une décharge pleine n\'accepte plus rien', () => {
    const s = flatSession();
    town(s);
    spawn(s, 'waste_depot', 14, 16, { access: s.state.grid.idx(14, 15), jobsFilled: 15, powered: true });
    const lf = spawn(s, 'landfill', 18, 16, { access: s.state.grid.idx(18, 15), jobsFilled: 8 });
    lf.landfillUsed = s.catalog.building('landfill').capacity.waste.storage;
    update(s, 1);
    expect(s.state.waste.stats.collectionRate).toBe(0);
    expect(s.state.waste.stats.limitedBy).toBe('processing');
  });

  it('l\'incinérateur et le méthaniseur produisent de l\'électricité ; le recyclage passe en premier et rapporte', () => {
    const s = flatSession();
    town(s, { houses: 24, residents: 600 });
    spawn(s, 'waste_depot', 14, 16, { access: s.state.grid.idx(14, 15), jobsFilled: 15, powered: true });
    const inc = spawn(s, 'incinerator', 10, 16, { access: s.state.grid.idx(10, 15), jobsFilled: 25 });
    const rec = spawn(s, 'recycling', 20, 16, { access: s.state.grid.idx(20, 15), jobsFilled: 40, powered: true });
    update(s, 1);
    const ws = s.state.waste.stats;
    expect(ws.collected).toBeGreaterThan(800);
    expect(rec.wasteProcessed).toBeCloseTo(800, 5); // le recyclage est saturé en premier
    expect(inc.wasteProcessed).toBeCloseTo(ws.collected - 800, 5);
    expect(ws.recycledPerDay).toBeGreaterThan(0);
    s.sim.utilities.update(s.state);
    expect(inc.output).toBeCloseTo(inc.wasteProcessed * 0.3, 5);
    expect(s.state.utilities.power.bySource.waste).toBeGreaterThan(0);
    // une journée comptabilisée génère des recettes de recyclage à la clôture
    s.sim.economy.accrueDaily(s.state);
    const p = s.sim.economy.closeMonth(s.state);
    expect(p.revenue.recycling).toBeGreaterThan(0);
  });

  it('la capacité de collecte limite la collecte ; la technologie de collecte IA l\'augmente de 25 %', () => {
    const s = flatSession();
    town(s, { houses: 6, residents: 2000 }); // 1 200 u/j concentrés près du dépôt : la collecte sature
    spawn(s, 'waste_depot', 8, 16, { access: s.state.grid.idx(8, 15), jobsFilled: 15, powered: true });
    spawn(s, 'incinerator', 12, 16, { access: s.state.grid.idx(12, 15), jobsFilled: 25 }); // 450 + 300 u/j de bennes < 1 200 u/j
    spawn(s, 'landfill', 16, 17, { access: s.state.grid.idx(16, 15), jobsFilled: 8 });
    spawn(s, 'biogas', 20, 16, { access: s.state.grid.idx(20, 15), jobsFilled: 12 }); // traitement 1 250 u/j > collecte 1 050 u/j
    s.state.tech.researched = {};
    s.sim.ai.refreshModifiers(s.state);
    update(s, 1);
    const cap0 = s.state.waste.stats.collectCap;
    expect(s.state.waste.stats.limitedBy).toBe('collection');
    s.state.tech.researched = { ai_waste: 0 };
    s.sim.ai.refreshModifiers(s.state);
    update(s, 1);
    expect(s.state.waste.stats.collectCap / cap0).toBeCloseTo(1.25, 1);
  });

  it('le tri sélectif réduit la production de 15 %', () => {
    const s = flatSession();
    town(s);
    update(s, 1);
    const g0 = s.state.waste.stats.generated;
    s.execute({ type: 'policy', policyId: 'waste_sorting', enabled: true });
    s.sim.ai.refreshModifiers(s.state);
    update(s, 1);
    expect(s.state.waste.stats.generated / g0).toBeCloseTo(0.85, 5);
  });

  it('le catalogue refuse une décharge sans capacité de stockage', () => {
    const b = structuredClone(defaultData.buildings);
    b.buildings.find((x) => x.id === 'landfill').capacity.waste.storage = 0;
    expect(() => new Catalog(b, defaultData.technologies, defaultData.policies)).toThrow(/stockage/);
  });
});
