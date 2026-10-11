import { describe, it, expect } from 'vitest';
import { newSession } from '../helpers/session.js';
import { buildStarterTown, placeNear } from '../../src/app/scenarios.js';
import { checkInvariants } from '../../src/debug/Invariants.js';
import { Rng } from '../../src/util/rng.js';

describe('Cohérence de l\'état sur une longue partie', () => {
  it('reste cohérent après des centaines de constructions, démolitions et annulations aléatoires', () => {
    const s = newSession();
    const town = buildStarterTown(s, { size: 'large' });
    s.state.stats.peakPopulation = 5000;
    // Dotation de test injectée hors journal : on l'ajoute aussi à la trésorerie d'ouverture.
    s.state.economy.treasury += 50_000_000;
    s.state.economy.opening += 50_000_000;
    const rng = new Rng(99);
    const plops = ['park_small', 'bus_stop', 'clinic', 'police_post', 'library', 'plaza', 'statue', 'playground', 'school'];
    let ops = 0;
    for (let k = 0; k < 300; k++) {
      const x = rng.int(2, 60);
      const y = rng.int(2, 60);
      const r = rng.next();
      let res;
      if (r < 0.35) res = s.execute({ type: 'building', defId: plops[rng.int(0, plops.length - 1)], x, y });
      else if (r < 0.55) res = s.execute({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + rng.int(-6, 6), y: y + rng.int(-6, 6) } });
      else if (r < 0.75) res = s.execute({ type: 'demolish', rect: { x0: x, y0: y, x1: x + rng.int(0, 2), y1: y + rng.int(0, 2) } });
      else if (r < 0.85) res = s.execute({ type: 'zone', zoneId: ['R_LOW', 'C', 'I', 'O', 'R_HIGH'][rng.int(0, 4)], rect: { x0: x, y0: y, x1: x + 3, y1: y + 3 } });
      else res = s.execute({ type: 'undo' });
      if (res?.ok) ops++;
      if (k % 25 === 0) s.run(10);
    }
    placeNear(s, 'bus_depot', town.xEnd - 6, town.row + 2);
    s.run(120);
    expect(ops).toBeGreaterThan(80);
    const errs = checkInvariants(s.state, s.catalog);
    if (errs.length) console.log("INVARIANTS", errs);
    expect(errs).toEqual([]);
  });

  it('détecte une incohérence volontaire', () => {
    const s = newSession();
    buildStarterTown(s);
    const b = [...s.state.buildings.values()][0];
    s.state.grid.building[s.state.grid.idx(b.x, b.y)] = 0;
    s.state.economy.treasury += 1;
    const errors = checkInvariants(s.state, s.catalog);
    expect(errors.some((e) => e.includes('cases au lieu'))).toBe(true);
    expect(errors.some((e) => e.includes('journal'))).toBe(true);
  });
});
