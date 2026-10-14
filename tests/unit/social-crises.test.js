import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { ruinBuilding, RUIN_REBUILD_DAYS, REPAIR_SHARE } from '../../src/simulation/CrisisSystem.js';
import { toCents } from '../../src/util/money.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';

/** Quartier commerçant et résidentiel le long d'une rue. */
function district({ police = false } = {}) {
  const s = flatSession({ width: 40, height: 40, row: 20 });
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 20 }, to: { x: 36, y: 20 } });
  s.execute({ type: 'building', defId: 'power_gas', x: 33, y: 21 });
  s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: 4, y0: 18, x1: 32, y1: 19 } });
  s.execute({ type: 'zone', zoneId: 'C', rect: { x0: 4, y0: 21, x1: 32, y1: 22 } });
  for (let x = 4; x <= 32; x++) {
    spawn(s, 'res_low_1', x, 19, { residents: 4 });
    spawn(s, 'res_low_1', x, 18, { residents: 4 });
    if (police && x >= 15 && x <= 18) continue;
    spawn(s, 'com_1', x, 21);
    spawn(s, 'com_1', x, 22);
  }
  if (police) {
    s.execute({ type: 'zone', zoneId: null, rect: { x0: 15, y0: 21, x1: 18, y1: 22 } });
    expect(s.execute({ type: 'building', defId: 'police', x: 16, y: 21 }).ok).toBe(true);
  }
  s.run(20);
  return s;
}

describe('Crises sociales et ruines (v0.7)', () => {
  it('manifestation devant la mairie : recevoir une délégation y met fin en deux jours et compte comme une crise bien gérée', () => {
    const s = district();
    const r = s.execute({ type: 'triggerDisaster', kind: 'protest' });
    expect(r.ok).toBe(true);
    const c = s.state.crises.active.find((x) => x.kind === 'protest');
    expect(c.effects.some((e) => e.key === 'roadCapacityMult')).toBe(true);
    expect(s.execute({ type: 'crisisResponse', crisisId: c.id, option: 'dialogue' }).ok).toBe(true);
    s.run(3);
    expect(s.state.crises.active.some((x) => x.kind === 'protest')).toBe(false);
    s.run(30);
    const f = s.state.politics.factors.find((x) => x.id === 'crises');
    expect(f.value).toBeGreaterThan(0);
  });

  it('émeute : sans police, des commerces sont saccagés ; les forces de l\'ordre la contiennent vite', () => {
    const a = district();
    a.execute({ type: 'triggerDisaster', kind: 'riot' });
    const ca = a.state.crises.active.find((x) => x.kind === 'riot');
    expect(ca).toBeTruthy();
    a.run(12);
    const hist = a.state.crises.history.find((x) => x.kind === 'riot');
    expect(hist).toBeTruthy();
    const ruinsA = [...a.state.buildings.values()].filter((b) => b.ruins?.cause === 'riot').length;
    expect(ruinsA).toBeGreaterThan(0);

    const b = district({ police: true });
    b.run(10);
    b.execute({ type: 'triggerDisaster', kind: 'riot' });
    const cb = b.state.crises.active.find((x) => x.kind === 'riot');
    expect(cb.cover).toBeGreaterThan(0.3);
    expect(cb.until - b.state.time.tick).toBeLessThan(ca.until - ca.start + 1);
    b.execute({ type: 'crisisResponse', crisisId: cb.id, option: 'police' });
    b.run(12);
    const ruinsB = [...b.state.buildings.values()].filter((x) => x.ruins?.cause === 'riot').length;
    expect(ruinsB).toBeLessThan(ruinsA);
  });

  it('épidémie : absentéisme (actifs en moins), la vaccination divise durée et effets par deux', () => {
    const s = district();
    s.run(20);
    const before = s.state.stats.workforce;
    s.execute({ type: 'triggerDisaster', kind: 'epidemic' });
    const c = s.state.crises.active.find((x) => x.kind === 'epidemic');
    const absence = c.effects.find((e) => e.key === 'jobs.absence').value;
    expect(absence).toBeGreaterThan(0);
    const left = c.until - s.state.time.tick;
    s.execute({ type: 'crisisResponse', crisisId: c.id, option: 'vaccinate' });
    expect(c.until - s.state.time.tick).toBeLessThanOrEqual(Math.ceil(left / 2) + 1);
    expect(c.effects.find((e) => e.key === 'jobs.absence').value).toBeCloseTo(absence / 2, 3);
    s.run(10);
    expect(s.state.stats.workforce).toBeLessThan(before);
  });

  it('un bâtiment privé en ruines est reconstruit par ses propriétaires', () => {
    const s = district();
    const b = [...s.state.buildings.values()].find((x) => s.catalog.buildingFor(x).id === 'res_low_1');
    ruinBuilding(s.state, b, s.catalog.buildingFor(b), 'fire');
    expect(b.residents).toBe(0);
    s.run(10);
    expect(b.residents).toBe(0);
    expect(b.ruins).toBeTruthy();
    s.run(RUIN_REBUILD_DAYS);
    expect(b.ruins).toBeUndefined();
    expect(b.constructionUntil).toBeGreaterThan(s.state.time.tick - 1);
    s.run(40);
    expect(b.constructionUntil).toBeUndefined();
    // Sauvegarde : l'état de ruine survit au rechargement
    const c = [...s.state.buildings.values()].find((x) => x.id !== b.id && s.catalog.buildingFor(x).id === 'com_1');
    ruinBuilding(s.state, c, s.catalog.buildingFor(c), 'riot');
    const back = deserializeState(serializeState(s.state));
    expect(back.buildings.get(c.id).ruins.cause).toBe('riot');
  });

  it('un équipement public en ruines ne sert plus personne jusqu\'à sa reconstruction (35 % du coût)', () => {
    const s = district({ police: true });
    s.run(10);
    const g = s.state.grid;
    const at = g.idx(17, 19);
    expect(g.coverPolice[at]).toBeGreaterThan(0.3);
    const station = [...s.state.buildings.values()].find((x) => s.catalog.buildingFor(x).id === 'police');
    const def = s.catalog.buildingFor(station);
    ruinBuilding(s.state, station, def, 'fire');
    s.run(10);
    expect(g.coverPolice[at]).toBe(0);
    s.run(60);
    expect(station.ruins).toBeTruthy();
    const before = s.state.economy.treasury;
    const r = s.execute({ type: 'repair', buildingId: station.id });
    expect(r.ok).toBe(true);
    expect(before - s.state.economy.treasury).toBe(toCents(Math.round(def.cost * REPAIR_SHARE)));
    s.run(25);
    expect(g.coverPolice[at]).toBeGreaterThan(0.3);
  });
});
