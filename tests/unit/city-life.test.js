import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';

/** Rue, centrale et quartier mixte : de quoi faire pousser des bâtiments. */
function town() {
  const s = flatSession({ width: 40, height: 30, row: 15 });
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 38, y: 15 } });
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 20, y: 5 }, to: { x: 20, y: 25 } });
  expect(s.execute({ type: 'building', defId: 'power_gas', x: 4, y: 16 }).ok).toBe(true);
  expect(s.execute({ type: 'building', defId: 'water_tower', x: 8, y: 16 }).ok).toBe(true);
  return s;
}

describe('Ville vivante (v0.6)', () => {
  it('les grandes surfaces poussent sur des îlots de 2 × 2 ; les commerces se diversifient', () => {
    const s = town();
    s.execute({ type: 'zone', zoneId: 'CH', rect: { x0: 22, y0: 16, x1: 29, y1: 17 } });
    s.execute({ type: 'zone', zoneId: 'C', rect: { x0: 10, y0: 13, x1: 19, y1: 14 } });
    s.execute({ type: 'zone', zoneId: 'R_HIGH', rect: { x0: 21, y0: 5, x1: 30, y1: 14 } });
    s.state.demand.C = 90;
    s.state.demand.R = 90;
    s.run(360);
    const defs = [...s.state.buildings.values()].map((b) => ({ id: b.defId, w: b.w, h: b.h }));
    const malls = defs.filter((d) => d.id.startsWith('mall_'));
    expect(malls.length).toBeGreaterThan(0);
    for (const m of malls) expect([m.w, m.h]).toEqual([2, 2]);
    const commerce = new Set(defs.filter((d) => d.id.startsWith('com_')).map((d) => d.id));
    expect(commerce.size).toBeGreaterThan(1);
    // Grands formats résidentiels quand la place le permet
    expect(defs.some((d) => d.id.startsWith('res_high_2x2'))).toBe(true);
  });

  it('sur-zonage : passer des maisons en commerce démolit les maisons (coût) et change la zone ; annulable', () => {
    const s = town();
    s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: 10, y0: 13, x1: 12, y1: 14 } });
    const house = spawn(s, 'res_low_1', 11, 14, { residents: 4 });
    const pv = s.preview({ type: 'zone', zoneId: 'C', rect: { x0: 10, y0: 14, x1: 12, y1: 14 } });
    expect(pv.ok).toBe(true);
    expect(pv.buildings).toEqual([house.id]);
    expect(pv.cost).toBe(3 * s.catalog.zoneById.get('C').costCents + s.construction.demolitionCost(house));
    expect(s.execute({ type: 'zone', zoneId: 'C', rect: { x0: 10, y0: 14, x1: 12, y1: 14 } }).ok).toBe(true);
    const g = s.state.grid;
    expect(s.state.buildings.has(house.id)).toBe(false);
    expect(g.zone[g.idx(11, 14)]).toBe(s.catalog.zoneById.get('C').code);
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    expect(s.state.buildings.has(house.id)).toBe(true);
    expect(g.zone[g.idx(11, 14)]).toBe(s.catalog.zoneById.get('R_LOW').code);
  });
});
