import { describe, it, expect } from 'vitest';
import { flatSession, spawn, newSession } from '../helpers/session.js';
import { TERRAIN } from '../../src/world/Terrain.js';
import { ROAD_DEMOLITION_CENTS } from '../../src/systems/ConstructionService.js';

describe('Outils v0.4 : démolition des routes, dézonage, déplacement, terrassement', () => {
  it('démolit seulement les routes d\'un rectangle et ignore l\'accès autoroutier', () => {
    const s = flatSession();
    const g = s.state.grid;
    expect(s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 10, y: 15 } }).ok).toBe(true);
    const park = s.execute({ type: 'building', defId: 'park_small', x: 6, y: 14 });
    expect(park.ok).toBe(true);
    const pv = s.preview({ type: 'demolish', rect: { x0: 0, y0: 14, x1: 8, y1: 15 }, filter: 'roads' });
    expect(pv.ok).toBe(true);
    expect(pv.buildings).toEqual([]);
    expect(pv.roads.length).toBe(6); // x = 3..8 ; l'autoroute (x = 0..2) est ignorée
    expect(pv.cost).toBe(6 * ROAD_DEMOLITION_CENTS);
    expect(s.execute({ type: 'demolish', rect: { x0: 0, y0: 14, x1: 8, y1: 15 }, filter: 'roads' }).ok).toBe(true);
    expect(g.road[g.idx(5, 15)]).toBe(0);
    expect(g.road[g.idx(1, 15)]).not.toBe(0);
    expect(s.state.buildings.get(park.building.id)).toBeTruthy();
    // Rien d'autre que l'autoroute : refus explicite
    expect(s.preview({ type: 'demolish', rect: { x0: 0, y0: 15, x1: 2, y1: 15 } }).reasons).toContain('highway');
  });

  it('dézoner une parcelle bâtie démolit le logement, et l\'annulation le rétablit', () => {
    const s = flatSession();
    const g = s.state.grid;
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 12, y: 15 } });
    expect(s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: 5, y0: 13, x1: 9, y1: 14 } }).ok).toBe(true);
    const house = spawn(s, 'res_low_1', 6, 14, { residents: 4 });
    const pv = s.preview({ type: 'zone', zoneId: null, rect: { x0: 6, y0: 14, x1: 6, y1: 14 } });
    expect(pv.ok).toBe(true);
    expect(pv.buildings).toEqual([house.id]);
    expect(pv.residents).toBe(4);
    expect(s.execute({ type: 'zone', zoneId: null, rect: { x0: 6, y0: 14, x1: 6, y1: 14 } }).ok).toBe(true);
    expect(s.state.buildings.has(house.id)).toBe(false);
    expect(g.zone[g.idx(6, 14)]).toBe(0);
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    expect(s.state.buildings.has(house.id)).toBe(true);
    expect(g.building[g.idx(6, 14)]).toBe(house.id);
    expect(g.zone[g.idx(6, 14)]).not.toBe(0);
  });

  it('déplace un équipement (gratuit juste après la pose) et annule le déplacement', () => {
    const s = flatSession();
    const g = s.state.grid;
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    const r = s.execute({ type: 'building', defId: 'park_small', x: 6, y: 14 });
    const id = r.building.id;
    const treasury = s.state.economy.treasury;
    const pv = s.preview({ type: 'move', buildingId: id, x: 14, y: 16 });
    expect(pv.ok).toBe(true);
    expect(pv.cost).toBe(0);
    expect(s.execute({ type: 'move', buildingId: id, x: 14, y: 16 }).ok).toBe(true);
    const b = s.state.buildings.get(id);
    expect([b.x, b.y]).toEqual([14, 16]);
    expect(g.building[g.idx(6, 14)]).toBe(0);
    expect(g.building[g.idx(14, 16)]).toBe(id);
    expect(s.state.economy.treasury).toBe(treasury);
    // Sur une route : refusé
    expect(s.preview({ type: 'move', buildingId: id, x: 10, y: 15 }).ok).toBe(false);
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    expect([b.x, b.y]).toEqual([6, 14]);
    expect(g.building[g.idx(6, 14)]).toBe(id);
    expect(g.building[g.idx(14, 16)]).toBe(0);
  });

  it('le déplacement coûte 15 % du prix après 30 jours ; les bâtiments de zone ne se déplacent pas', () => {
    const s = flatSession();
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    const r = s.execute({ type: 'building', defId: 'park_small', x: 6, y: 14 });
    s.state.time.tick += 40;
    const def = s.catalog.building('park_small');
    expect(s.preview({ type: 'move', buildingId: r.building.id, x: 14, y: 16 }).cost).toBe(Math.round(def.costCents * 0.15));
    const house = spawn(s, 'res_low_1', 10, 14);
    expect(s.preview({ type: 'move', buildingId: house.id, x: 12, y: 16 }).ok).toBe(false);
  });

  it('élève, abaisse et aplanit le terrain avec un coût, puis annule', () => {
    const s = flatSession();
    const g = s.state.grid;
    const i = g.idx(20, 5);
    const treasury = s.state.economy.treasury;
    expect(s.execute({ type: 'terraform', op: 'raise', rect: { x0: 20, y0: 5, x1: 21, y1: 6 } }).ok).toBe(true);
    expect(g.altitude[i]).toBe(2);
    expect(s.state.economy.treasury).toBe(treasury - 4 * 60000);
    expect(s.execute({ type: 'terraform', op: 'raise', rect: { x0: 20, y0: 5, x1: 20, y1: 5 } }).ok).toBe(true);
    expect(g.altitude[i]).toBe(3);
    // Aplanir à l'altitude de la case de départ (21,6 = 2)
    const lv = s.preview({ type: 'terraform', op: 'level', rect: { x0: 21, y0: 6, x1: 20, y1: 5 } });
    expect(lv.eligible).toEqual([i]);
    expect(s.execute({ type: 'terraform', op: 'level', rect: { x0: 21, y0: 6, x1: 20, y1: 5 } }).ok).toBe(true);
    expect(g.altitude[i]).toBe(2);
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    expect(g.altitude[i]).toBe(3);
    // On ne creuse pas sous le niveau du sol
    const low = s.preview({ type: 'terraform', op: 'lower', rect: { x0: 25, y0: 25, x1: 25, y1: 25 } });
    expect(low.ok).toBe(false);
    expect(low.messages.join()).toMatch(/sous le niveau du sol/);
  });

  it('plante et défriche une forêt ; ignore les cases bâties, routes et zones', () => {
    const s = flatSession();
    const g = s.state.grid;
    s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: 10, y0: 3, x1: 10, y1: 3 } });
    const pv = s.preview({ type: 'terraform', op: 'plant', rect: { x0: 8, y0: 3, x1: 10, y1: 3 } });
    expect(pv.eligible.length).toBe(2);
    expect(pv.cost).toBe(2 * 4000);
    expect(s.execute({ type: 'terraform', op: 'plant', rect: { x0: 8, y0: 3, x1: 10, y1: 3 } }).ok).toBe(true);
    expect(g.terrain[g.idx(8, 3)]).toBe(TERRAIN.FOREST);
    expect(g.terrain[g.idx(10, 3)]).toBe(TERRAIN.GRASS);
    expect(s.execute({ type: 'terraform', op: 'clear', rect: { x0: 8, y0: 3, x1: 8, y1: 3 } }).ok).toBe(true);
    expect(g.terrain[g.idx(8, 3)]).toBe(TERRAIN.GRASS);
  });

  it('élève une case sur une carte générée', () => {
    const a = newSession();
    const g = a.state.grid;
    let k = 0;
    while (g.terrain[k] === TERRAIN.WATER || g.building[k] || g.road[k] || g.altitude[k] >= 4) k++;
    const x = g.xOf(k);
    const y = g.yOf(k);
    const before = g.altitude[k];
    expect(a.execute({ type: 'terraform', op: 'raise', rect: { x0: x, y0: y, x1: x, y1: y } }).ok).toBe(true);
    expect(g.altitude[k]).toBe(before + 1);
  });
});

describe('Note de la dette (v0.4)', () => {
  it('note provisoire sans historique, se dégrade avec un fort endettement', () => {
    const s = flatSession();
    const eco = s.sim.economy;
    const r0 = eco.creditRating(s.state);
    expect(r0.provisional).toBe(true);
    expect(r0.grade).toBe('A');
    // Trois mois de recettes modestes et une dette lourde
    s.state.economy.treasury = 1_000_000;
    s.run(90);
    const max = eco.maxLoanEuros(s.state);
    expect(max).toBeGreaterThan(0);
    expect(s.execute({ type: 'loan', amountEuros: max, months: 120 }).ok).toBe(true);
    expect(eco.maxLoanEuros(s.state)).toBe(0);
    const r1 = eco.creditRating(s.state);
    expect(r1.provisional).toBe(false);
    expect(['BB', 'B', 'CCC', 'D']).toContain(r1.grade);
    expect(eco.loanRate(s.state)).toBeGreaterThan(0.032);
    expect(r1.factors.find((f) => f.label.startsWith('Capacité')).penalty).toBeGreaterThan(0);
  });
});
