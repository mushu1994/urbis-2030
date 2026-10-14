import { describe, it, expect } from 'vitest';
import { flatSession, spawn, getCatalog } from '../helpers/session.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { expandSave } from '../../src/persistence/WorldExpansion.js';
import { GameSession } from '../../src/app/GameSession.js';
import { defaultLand, isOwned, parcelPrice, parcelMap } from '../../src/world/Land.js';
import { EconomySystem } from '../../src/simulation/EconomySystem.js';
import { checkInvariants } from '../../src/debug/Invariants.js';
import { generateWorld } from '../../src/world/WorldGenerator.js';
import { Grid } from '../../src/world/Grid.js';
import { TERRAIN } from '../../src/world/Terrain.js';

function grow(s, gx, gy) {
  const r = s.execute({ type: 'buyParcel', gx, gy });
  expect(r.ok).toBe(true);
  const { data, offset } = expandSave(serializeState(s.state), { catalog: s.catalog, box: r.box });
  return { s2: new GameSession({ catalog: getCatalog(), state: deserializeState(data) }), offset, r };
}

describe('Territoire et extensions (v0.6)', () => {
  it('une carte de 64 × 64 occupe les 2 × 2 parcelles du centre du monde possible (8 × 8)', () => {
    const land = defaultLand(64, 64);
    expect(land.box).toEqual({ x0: 3, y0: 3, x1: 4, y1: 4 });
    expect(land.owned).toHaveLength(4);
    expect(defaultLand(96, 96).box).toEqual({ x0: 2, y0: 2, x1: 4, y1: 4 });
  });

  it('achète une parcelle à l\'est puis à l\'ouest : la carte grandit, tout est décalé, l\'autoroute prolongée', () => {
    const s = flatSession({ width: 64, height: 64, row: 30 });
    s.state.land = defaultLand(64, 64);
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 30 }, to: { x: 20, y: 30 } });
    const park = s.execute({ type: 'building', defId: 'park_small', x: 10, y: 31 }).building;
    const treasury = s.state.economy.treasury;
    const price = parcelPrice(s.state, EconomySystem.summarize);
    expect(price).toBeGreaterThanOrEqual(150_000_000);
    // Parcelle non voisine : refusée
    expect(s.preview({ type: 'buyParcel', gx: 7, gy: 3 }).ok).toBe(false);
    const east = grow(s, 5, 3);
    expect(east.offset).toEqual({ dx: 0, dy: 0 });
    let st = east.s2.state;
    expect([st.grid.width, st.grid.height]).toEqual([96, 64]);
    expect(st.economy.treasury).toBe(treasury - price);
    expect(st.buildings.get(park.id).x).toBe(10);
    expect(st.land.purchases).toBe(1);
    // Le prix augmente de 30 %
    expect(parcelPrice(st, EconomySystem.summarize)).toBe(Math.round((price * 1.3) / 10000) * 10000);
    const west = grow(east.s2, 2, 3);
    expect(west.offset).toEqual({ dx: 32, dy: 0 });
    st = west.s2.state;
    expect([st.grid.width, st.grid.height]).toEqual([128, 64]);
    expect(st.buildings.get(park.id).x).toBe(42);
    const e = st.entries[0];
    expect(st.grid.xOf(e)).toBe(0);
    const hw = getCatalog().road('road_highway').code;
    for (let x = 0; x < 35; x++) expect(st.grid.road[st.grid.idx(x, 30)]).not.toBe(0);
    expect(st.grid.road[st.grid.idx(0, 30)]).toBe(hw);
    // La partie agrandie se simule et reste cohérente
    west.s2.run(40);
    expect(checkInvariants(st, getCatalog()).filter((m) => !/trésorerie/i.test(m))).toEqual([]);
    expect(st.stats.regionConnected).toBe(true);
  });

  it('une parcelle d\'un territoire en « L » reste verrouillée tant qu\'elle n\'est pas achetée', () => {
    const s = flatSession({ width: 64, height: 64, row: 30 });
    s.state.land = defaultLand(64, 64);
    const a = grow(s, 5, 3).s2;
    const b = grow(a, 5, 4).s2; // carte 96 × 64 → toujours 96 × 64 (déjà dans le rectangle ? non : y1 = 4)
    const st = b.state;
    expect([st.grid.width, st.grid.height]).toEqual([96, 64]);
    const c = grow(b, 3, 5).s2.state; // agrandit vers le sud : la parcelle (5, 5) est dans la grille mais pas achetée
    expect([c.grid.width, c.grid.height]).toEqual([96, 96]);
    expect(isOwned(c, 80, 80)).toBe(false);
    expect(isOwned(c, 10, 80)).toBe(true);
    expect(parcelMap(c).find((p) => p.gx === 5 && p.gy === 5).status).toBe('available');
  });

  it('éditeur de carte : plus d\'eau, plus de roche, plus de forêt quand on pousse les curseurs', () => {
    const count = (params) => {
      const g = new Grid(64, 64);
      generateWorld(g, { seed: 7, highwayRoadCode: 9, params });
      const n = [0, 0, 0, 0, 0];
      for (let i = 0; i < g.size; i++) n[g.terrain[i]]++;
      let alt = 0;
      for (let i = 0; i < g.size; i++) alt += g.altitude[i];
      return { water: n[TERRAIN.WATER], forest: n[TERRAIN.FOREST], rock: n[TERRAIN.ROCK], alt };
    };
    const base = count({});
    expect(count({ water: 85 }).water).toBeGreaterThan(base.water);
    expect(count({ water: 10 }).water).toBeLessThan(base.water);
    expect(count({ forest: 90 }).forest).toBeGreaterThan(base.forest);
    expect(count({ rock: 95, relief: 80 }).rock).toBeGreaterThan(base.rock);
    expect(count({ relief: 10 }).alt).toBeLessThan(base.alt);
  });
});

describe('Industrie forestière et repousse des forêts (v0.6)', () => {
  it('la zone forestière exige une forêt à 2 cases au plus ; les scieries forment une filière', () => {
    const s = flatSession();
    const g = s.state.grid;
    g.terrain[g.idx(20, 20)] = TERRAIN.FOREST;
    const far = s.preview({ type: 'zone', zoneId: 'IF', rect: { x0: 5, y0: 25, x1: 6, y1: 25 } });
    expect(far.ok).toBe(false);
    expect(far.messages.join()).toMatch(/forêt/);
    expect(s.preview({ type: 'zone', zoneId: 'IF', rect: { x0: 18, y0: 21, x1: 22, y1: 21 } }).eligible.length).toBe(5);
    expect(s.catalog.firstGrowable(8).id).toBe('wood_1');
    expect(s.catalog.building('wood_2').growth.next).toBe('wood_3');
  });

  it('une prairie libre entourée de forêt se boise peu à peu ; une parcelle zonée jamais', () => {
    const s = flatSession();
    const g = s.state.grid;
    for (let y = 2; y < 12; y++) for (let x = 2; x < 12; x++) if ((x + y) % 2 === 0) g.terrain[g.idx(x, y)] = TERRAIN.FOREST;
    g.zone[g.idx(5, 4)] = 1;
    const count = () => { let n = 0; for (let i = 0; i < g.size; i++) if (g.terrain[i] === TERRAIN.FOREST) n++; return n; };
    const before = count();
    for (let m = 0; m < 24; m++) {
      s.state.time.tick += 30;
      s.sim.environment.regrowForests(s.state);
    }
    expect(count()).toBeGreaterThan(before);
    expect(g.terrain[g.idx(5, 4)]).toBe(TERRAIN.GRASS);
  });
});
