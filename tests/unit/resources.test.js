import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { RESOURCE_KEYS, NEEDS_PER_1000 } from '../../src/simulation/ResourceSystem.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';

describe('Ressources (v0.7)', () => {
  it('une ville sans production importe tout : surcoût payé chaque mois', () => {
    const s = flatSession({ width: 30, height: 30 });
    s.state.stats.population = 10_000;
    const b = s.sim.resources.balance(s.state);
    for (const k of RESOURCE_KEYS) expect(b.rows[k].balance).toBeLessThan(0);
    expect(b.rows.grain.need).toBeCloseTo(NEEDS_PER_1000.grain * 10, 5);
    expect(b.rows.grain.importCents).toBeGreaterThan(0);
    s.sim.resources.monthly(s.state);
    const tx = s.state.economy.ledger.filter((t) => t.category === 'resourcesImport');
    expect(tx).toHaveLength(1);
    expect(tx[0].amount).toBeLessThan(0);
  });

  it('fermes et puits produisent selon leur personnel ; l\'excédent rapporte des redevances à rendement décroissant', () => {
    const s = flatSession({ width: 30, height: 30 });
    s.state.stats.population = 1000;
    const farms = [];
    for (let x = 4; x < 24; x++) farms.push(spawn(s, 'agri_1', x, 10, { jobsFilled: 7 }));
    for (let x = 4; x < 10; x++) spawn(s, 'agri_pasture', x, 12, { jobsFilled: 7 });
    for (let x = 4; x < 8; x++) spawn(s, 'ext_gas', x, 14, { jobsFilled: 10 });
    const r1 = s.sim.resources.balance(s.state).rows;
    expect(r1.grain.production).toBeCloseTo(20 * 30, 5);
    expect(r1.livestock.production).toBeCloseTo(6 * 40, 5);
    expect(r1.gas.production).toBeCloseTo(4 * 70, 5);
    expect(r1.grain.exportCents).toBeGreaterThan(0);
    // Personnel à moitié : production divisée par deux
    for (const f of farms) f.jobsFilled = 3.5;
    const r2 = s.sim.resources.balance(s.state).rows;
    expect(r2.grain.production).toBeCloseTo(300, 5);
    // Rendements décroissants : deux fois plus d'excédent rapporte moins de deux fois plus
    const ratio = r1.grain.exportCents / r2.grain.exportCents;
    const surplusRatio = r1.grain.balance / r2.grain.balance;
    expect(ratio).toBeLessThan(surplusRatio);
    s.sim.resources.monthly(s.state);
    expect(s.state.economy.ledger.some((t) => t.category === 'resourcesExport' && t.amount > 0)).toBe(true);
    expect(s.state.resources.stats.foodSelf).toBeGreaterThan(0.9);
  });

  it('les centrales à gaz et le chauffage d\'hiver font monter les besoins en gaz', () => {
    const s = flatSession({ width: 30, height: 30 });
    s.state.stats.population = 5000;
    const summer = (() => {
      s.state.time.tick = 6 * 30;
      return s.sim.resources.balance(s.state).rows.gas.need;
    })();
    s.state.time.tick = 0;
    const winter = s.sim.resources.balance(s.state).rows.gas.need;
    expect(winter).toBeGreaterThan(summer * 3);
    const plant = spawn(s, 'power_gas', 10, 10, { output: 1000 });
    expect(plant).toBeTruthy();
    expect(s.sim.resources.balance(s.state).rows.gas.need).toBeCloseTo(winter + 30, 5);
  });

  it('les cours évoluent dans leurs bornes et la sauvegarde conserve l\'état des ressources', () => {
    const s = flatSession({ width: 30, height: 30 });
    s.state.stats.population = 3000;
    for (let k = 0; k < 40; k++) {
      s.state.time.tick += 30;
      s.sim.resources.monthly(s.state);
      for (const r of RESOURCE_KEYS) {
        expect(s.state.resources.index[r]).toBeGreaterThanOrEqual(0.75);
        expect(s.state.resources.index[r]).toBeLessThanOrEqual(1.35);
      }
    }
    const back = deserializeState(serializeState(s.state));
    expect(back.resources).toEqual(s.state.resources);
  });
});
