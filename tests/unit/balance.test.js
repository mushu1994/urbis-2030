import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { siteValueOf } from '../../src/simulation/BuildingSystem.js';
import { METRICS as SCENARIO_METRICS } from '../../src/simulation/ScenarioSystem.js';

/** Rue sur la ligne 15 depuis l'autoroute. */
function street(s) {
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
  s.sim.attach(s.state);
}

describe('Équilibrage v0.6', () => {
  it('l\'attractivité industrielle ne s\'effondre pas sous la pollution des usines', () => {
    const s = flatSession();
    street(s);
    s.execute({ type: 'zone', zoneId: 'I', rect: { x0: 6, y0: 16, x1: 12, y1: 18 } });
    for (let x = 6; x <= 12; x++) spawn(s, 'ind_2', x, 16, { jobsFilled: 40, powered: true, access: s.state.grid.idx(x, 15) });
    s.run(25);
    const g = s.state.grid;
    const i = g.idx(9, 17);
    const def = s.catalog.building('ind_2');
    // La valeur foncière résidentielle s'effondre, l'attractivité industrielle reste au-dessus du palier
    expect(g.landValue[i]).toBeLessThan(siteValueOf(g, i, def));
    expect(siteValueOf(g, i, def)).toBeGreaterThanOrEqual(def.growth.minLandValue);
  });

  it('un équipement saturé perd en efficacité et l\'affiche (capacité d\'habitants servis)', () => {
    const s = flatSession();
    street(s);
    const school = spawn(s, 'school', 10, 16, { jobsFilled: 30, powered: true, access: s.state.grid.idx(10, 15) });
    const cap = s.catalog.building('school').capacity.service.capacity;
    for (let k = 0; k < 10; k++) spawn(s, 'res_high_2', 4 + k * 2, 13, { residents: 300 });
    s.sim.environment.updateCoverage(s.state);
    const cover1 = s.state.grid.coverEducation[s.state.grid.idx(11, 13)];
    expect(school.serviceLoad).toBeLessThan(1);
    for (let k = 0; k < 10; k++) spawn(s, 'res_high_2', 4 + k * 2, 11, { residents: 1200 });
    s.sim.environment.updateCoverage(s.state);
    expect(school.serviceLoad).toBeGreaterThan(1);
    expect(s.state.grid.coverEducation[s.state.grid.idx(11, 13)]).toBeLessThan(cover1);
    expect(cap).toBeGreaterThan(0);
  });

  it('grosses installations d\'eau : une usine vaut une quinzaine de pompes, améliorations de fin de partie', () => {
    const s = flatSession();
    const plant = s.catalog.building('water_plant');
    const pump = s.catalog.building('water_pump');
    expect(plant.capacity.waterOutput / pump.capacity.waterOutput).toBeGreaterThanOrEqual(13);
    expect(s.catalog.building('sewage_big').capacity.sewageTreatment).toBeGreaterThanOrEqual(14000);
    const up = s.catalog.upgradeById.get('pump_deep');
    expect(up.appliesTo).toContain('water_plant');
    expect(up.effects.waterOutput).toBe(2);
  });

  it('construction et démolition plus chères ; résultat du défi lissé sur 12 mois', () => {
    const s = flatSession();
    expect(s.catalog.road('road_street').costCents).toBe(6000);
    street(s);
    const r = s.execute({ type: 'building', defId: 'park_small', x: 8, y: 16 });
    expect(s.sim.construction?.demolitionCost?.(r.building) ?? s.construction.demolitionCost(r.building)).toBe(Math.round(s.catalog.building('park_small').costCents * 0.25));
    const m = SCENARIO_METRICS.netResult12;
    s.state.economy.periods = [];
    expect(m.read(s.state)).toBe(0);
  });
});
