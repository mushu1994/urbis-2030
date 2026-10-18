import { describe, it, expect } from 'vitest';
import { newSession, getCatalog } from '../helpers/session.js';
import { Grid } from '../../src/world/Grid.js';
import { GameState } from '../../src/app/GameState.js';
import { GameSession } from '../../src/app/GameSession.js';
import { TERRAIN } from '../../src/world/Terrain.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { migrate } from '../../src/persistence/SaveMigration.js';

/** Carte 20×9 plate (altitude 1) traversée par une rivière nord-sud de 3 cases (x = 9..11). */
function riverSession() {
  const grid = new Grid(20, 9);
  grid.altitude.fill(1);
  for (let y = 0; y < 9; y++) {
    for (let x = 9; x <= 11; x++) {
      const i = grid.idx(x, y);
      grid.terrain[i] = TERRAIN.WATER;
      grid.altitude[i] = 0;
    }
  }
  const catalog = getCatalog();
  // accès autoroutier à l'ouest
  for (let x = 0; x < 3; x++) grid.road[grid.idx(x, 4)] = catalog.road('road_highway').code;
  const state = new GameState({ grid, seed: 7, name: 'Rivière' });
  state.entries = [grid.idx(0, 4)];
  return new GameSession({ catalog, state });
}

const road = (s, x0, y0, x1, y1, roadId = 'road_street') => ({ type: 'road', roadId, from: { x: x0, y: y0 }, to: { x: x1, y: y1 } });

describe('Ponts', () => {
  it('franchit la rivière en ligne droite, au coût d\'un pont, avec un tablier à hauteur des berges', () => {
    const s = riverSession();
    const pv = s.preview(road(s, 3, 4, 15, 4));
    expect(pv.ok).toBe(true);
    const water = pv.tiles.filter((t) => t.bridge);
    expect(water.map((t) => t.x)).toEqual([9, 10, 11]);
    const cat = getCatalog().road('road_street');
    expect(pv.cost).toBe(10 * cat.costCents + 3 * cat.bridgeCostCents);
    const before = s.state.economy.treasury;
    expect(s.execute(road(s, 3, 4, 15, 4)).ok).toBe(true);
    expect(before - s.state.economy.treasury).toBe(pv.cost);
    const g = s.state.grid;
    for (const x of [9, 10, 11]) expect(g.surfaceAlt(g.idx(x, 4))).toBe(1);
    expect(g.terrain[g.idx(10, 4)]).toBe(TERRAIN.WATER); // l'eau reste de l'eau sous le pont
  });

  it('relie les deux rives : la rive est est reliée à l\'autoroute et reçoit l\'électricité', () => {
    const s = riverSession();
    s.execute(road(s, 3, 4, 15, 4));
    s.run(1);
    const net = s.sim.network;
    expect(net.isConnectedToOutside(s.state.grid.idx(15, 4))).toBe(true);
    const seg = net.segment(s.state, s.state.grid.idx(10, 4));
    expect(seg.bridge).toBe(true);
    expect(seg.name).toMatch(/Pont/);
    expect(seg.neighbors.length).toBe(2);
    // centrale à l'ouest, consommateur à l'est : le courant traverse le pont
    s.state.stats.peakPopulation = 1000;
    expect(s.execute({ type: 'building', defId: 'power_wind', x: 5, y: 3 }).ok).toBe(true);
    expect(s.execute({ type: 'building', defId: 'clinic', x: 14, y: 5 }).ok).toBe(true);
    s.run(6);
    const clinic = [...s.state.buildings.values()].find((b) => b.defId === 'clinic');
    expect(clinic.powered).toBe(true);
  });

  it('refuse un pont en L, un pont qui ne touche pas l\'autre rive et une voie non franchissable', () => {
    const s = riverSession();
    // tracé en L dont le coude tombe sur l'eau
    const bent = s.preview({ type: 'road', roadId: 'road_street', from: { x: 7, y: 2 }, to: { x: 10, y: 6 } });
    expect(bent.ok).toBe(false);
    expect(bent.messages.join()).toMatch(/rectiligne|rives/);
    // tracé qui s'arrête au milieu de la rivière
    const half = s.preview(road(s, 5, 4, 10, 4));
    expect(half.ok).toBe(false);
    expect(half.messages.join()).toMatch(/deux rives/);
    // rien n'a été construit ni payé
    expect(s.state.grid.road.reduce((a, v) => a + (v ? 1 : 0), 0)).toBe(3);
  });

  it('refuse un pont trop long', () => {
    const grid = new Grid(30, 3);
    grid.altitude.fill(1);
    for (let x = 2; x < 28; x++) {
      grid.terrain[grid.idx(x, 1)] = TERRAIN.WATER;
      grid.altitude[grid.idx(x, 1)] = 0;
    }
    const state = new GameState({ grid, seed: 1, name: 'Lac' });
    const s = new GameSession({ catalog: getCatalog(), state });
    const pv = s.preview(road(s, 1, 1, 28, 1));
    expect(pv.ok).toBe(false);
    expect(pv.messages.join()).toMatch(/trop long/);
  });

  it('un pont ne dessert pas les parcelles des berges', () => {
    const s = riverSession();
    s.execute(road(s, 8, 4, 12, 4)); // court pont entre deux berges, sans route le long des rives
    s.run(1);
    const g = s.state.grid;
    // la case de berge au nord du pont (8,3) n'est desservie que par la rue de berge (8,4), pas par le tablier
    expect(g.nearestRoad[g.idx(8, 3)]).toBe(g.idx(8, 4));
    expect(g.roadDist[g.idx(9, 2)]).toBe(255);
  });

  it('démolition et annulation du pont', () => {
    const s = riverSession();
    const t0 = s.state.economy.treasury;
    s.execute(road(s, 3, 4, 15, 4));
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    const g = s.state.grid;
    expect(g.bridge[g.idx(10, 4)]).toBe(0);
    expect(g.road[g.idx(10, 4)]).toBe(0);
    expect(s.state.economy.treasury).toBe(t0);
    s.execute(road(s, 3, 4, 15, 4));
    expect(s.execute({ type: 'demolish', rect: { x0: 10, y0: 4, x1: 10, y1: 4 } }).ok).toBe(true);
    expect(g.bridge[g.idx(10, 4)]).toBe(0);
    s.run(1);
    expect(s.sim.network.isConnectedToOutside(g.idx(15, 4))).toBe(false); // route interrompue détectée
  });

  it('l\'entretien d\'un pont est plus élevé que celui d\'une rue', () => {
    const s = riverSession();
    s.execute(road(s, 3, 4, 15, 4));
    s.sim.economy.closeMonth(s.state);
    const cat = getCatalog().road('road_street');
    const expected = Math.round(10 * cat.upkeepCents + 3 * cat.bridgeUpkeepCents); // les 3 cases d'autoroute sont gratuites
    expect(s.state.economy.periods.at(-1).opex.roads).toBe(expected);
  });

  it('les ponts sont conservés par la sauvegarde ; une partie v2 est migrée sans pont', () => {
    const s = riverSession();
    s.execute(road(s, 3, 4, 15, 4));
    const back = deserializeState(JSON.parse(JSON.stringify(serializeState(s.state))));
    expect(back.grid.bridge[back.grid.idx(10, 4)]).toBe(2);
    const v2 = serializeState(newSession().state);
    v2.formatVersion = 2;
    delete v2.world.layers.bridge;
    const { data, applied } = migrate(v2);
    expect(applied).toEqual([2, 3, 4, 5]);
    expect(deserializeState(v2).grid.bridge.every((v) => v === 0)).toBe(true);
    expect(data.economy.tariffs.transit).toBeGreaterThan(0);
  });
});
