import { describe, it, expect } from 'vitest';
import { flatSession, spawn, newSession } from '../helpers/session.js';
import { growthChecks } from '../../src/simulation/BuildingSystem.js';
import { isUnlocked } from '../../src/systems/ConstructionService.js';

/** Prépare une case où toutes les conditions d'évolution sont remplies. */
function idealTile(s, b) {
  const g = s.state.grid;
  const i = g.idx(b.x, b.y);
  g.landValue[i] = 95;
  g.coverEducation[i] = 1;
  g.coverHealth[i] = 1;
  g.transitMetro[i] = 1;
  Object.assign(b, { powered: true, watered: true, wasteCollectedRatio: 1, satisfaction: 90 });
  s.state.demand.R = 60;
}

describe('Ères et niveaux d\'habitation', () => {
  it('une nouvelle partie commence à l\'ère 1 avec des conditions affichées pour l\'ère 2', () => {
    const s = newSession();
    const ev = s.sim.progression.evaluate(s.state);
    expect(ev.era).toBe(1);
    expect(ev.next.name).toBe('Ville autonome');
    expect(ev.checks.map((c) => c.key)).toEqual(['population', 'techs', 'satisfaction', 'waste']);
    expect(ev.ready).toBe(false);
    expect(s.sim.progression.monthly(s.state)).toBe(false);
  });

  it('passe à l\'ère suivante quand toutes les conditions sont remplies, sans jamais revenir en arrière', () => {
    const s = newSession();
    const st = s.state;
    Object.assign(st.stats, { population: 3200, satisfaction: 60 });
    st.tech.researched = { ai_waste: 0, predictive_maintenance: 0 };
    st.waste.stats = { collectionRate: 0.9 };
    expect(isUnlocked(st, { era: 2 }).ok).toBe(false);
    expect(s.sim.progression.monthly(st)).toBe(true);
    expect(st.progression.era).toBe(2);
    expect(isUnlocked(st, { era: 2 }).ok).toBe(true);
    expect(isUnlocked(st, { era: 3 }).reason).toMatch(/symbiotique/);
    st.stats.population = 10;
    s.sim.progression.monthly(st);
    expect(st.progression.era).toBe(2);
  });

  it('les conditions d\'évolution listent satisfaction et besoins, et bloquent sans l\'ère requise', () => {
    const s = flatSession();
    s.state.progression.era = 1;
    const b = spawn(s, 'res_low_3', 10, 10, { residents: 7 });
    idealTile(s, b);
    const def = s.catalog.building('res_low_3');
    let checks = growthChecks(s.state, b, def);
    expect(checks.map((c) => c.key)).toEqual(expect.arrayContaining(['occupancy', 'landValue', 'satisfaction', 'waste', 'education', 'health', 'era2']));
    expect(checks.find((c) => c.key === 'era2').ok).toBe(false);
    s.state.progression.era = 2;
    checks = growthChecks(s.state, b, def);
    expect(checks.every((c) => c.ok)).toBe(true);
    b.wasteCollectedRatio = 0.5;
    expect(growthChecks(s.state, b, def).find((c) => c.key === 'waste').ok).toBe(false);
  });

  it('un bâtiment dont toutes les conditions sont remplies évolue jusqu\'au niveau 5', () => {
    const s = flatSession();
    s.state.progression.era = 3;
    const b = spawn(s, 'res_high_3', 10, 10, { residents: 140 });
    const g = s.state.grid;
    g.zone[g.idx(10, 10)] = 2;
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 10, y: 15 } });
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 10, y: 15 }, to: { x: 10, y: 11 } });
    s.sim.attach(s.state);
    const seen = [];
    for (let k = 0; k < 600 && b.defId !== 'res_high_5'; k++) {
      const def = s.catalog.building(b.defId);
      b.residents = def.capacity.residents;
      idealTile(s, b);
      s.sim.buildingSystem.update(s.state, 2);
      s.state.time.tick += 2; // les montées de niveau se font en travaux, sur plusieurs jours
      if (!seen.includes(b.defId)) seen.push(b.defId);
    }
    expect(seen).toEqual(['res_high_3', 'res_high_4', 'res_high_5']);
    expect(s.catalog.building(b.defId).visual.era).toBe(3);
  });

  it('les niveaux futuristes sont plus denses et plus sobres que les précédents', () => {
    const s = flatSession();
    const c = s.catalog;
    expect(c.building('res_high_5').capacity.residents).toBeGreaterThan(c.building('res_high_3').capacity.residents);
    expect(c.building('ind_5').environment.pollution).toBeLessThan(c.building('ind_2').environment.pollution);
    expect(c.building('off_5').capacity.jobs).toBeGreaterThan(c.building('off_3').capacity.jobs);
  });
});
