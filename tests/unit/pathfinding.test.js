import { describe, it, expect } from 'vitest';
import { getCatalog } from '../helpers/session.js';
import { Grid } from '../../src/world/Grid.js';
import { GameState } from '../../src/app/GameState.js';
import { RoadNetwork } from '../../src/systems/RoadNetwork.js';
import { Pathfinder } from '../../src/systems/Pathfinding.js';
import { Rng } from '../../src/util/rng.js';

function stateWithRoads(w, h, roads) {
  const grid = new Grid(w, h);
  for (const [x, y] of roads) grid.road[grid.idx(x, y)] = 1;
  const s = new GameState({ grid, seed: 1, name: 't' });
  s.entries = [];
  return s;
}

describe('Réseau routier et recherche de chemin', () => {
  it('construit le graphe, ses composantes et ses segments', () => {
    const s = stateWithRoads(10, 10, [[1, 1], [2, 1], [3, 1], [7, 7], [7, 8]]);
    const net = new RoadNetwork(getCatalog());
    net.rebuild(s);
    expect(net.n).toBe(5);
    expect(net.componentSize.sort()).toEqual([2, 3]);
    s.modifiers = { roadCapacityMult: 1 };
    const seg = net.segment(s, s.grid.idx(2, 1));
    expect(seg.neighbors.length).toBe(2);
    expect(seg.capacity).toBe(650);
    expect(seg.speedKmh).toBe(30);
  });

  it('A* trouve le même coût optimal que Dijkstra sur un réseau aléatoire', () => {
    const rng = new Rng(42);
    const roads = [];
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) if (rng.chance(0.7)) roads.push([x, y]);
    const s = stateWithRoads(30, 30, roads);
    const net = new RoadNetwork(getCatalog());
    net.rebuild(s);
    const cost = new Float64Array(net.n).map(() => 1 + rng.next() * 3);
    const pf = new Pathfinder(net);
    pf.setGridWidth(30);
    let compared = 0;
    for (let k = 0; k < 40; k++) {
      const a = rng.int(0, net.n - 1);
      const b = rng.int(0, net.n - 1);
      const dist = pf.dijkstra([a], cost)[b];
      const res = pf.aStar(a, b, cost, 1);
      if (!Number.isFinite(dist)) {
        expect(res).toBeNull();
        continue;
      }
      expect(res.cost).toBeCloseTo(dist, 9);
      expect(res.path[0]).toBe(a);
      expect(res.path.at(-1)).toBe(b);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('ne relie pas deux routes séparées par une falaise', () => {
    const s = stateWithRoads(5, 1, [[0, 0], [1, 0], [2, 0]]);
    s.grid.altitude[2] = 2;
    const net = new RoadNetwork(getCatalog());
    net.rebuild(s);
    expect(net.componentSize.length).toBe(2);
  });

  it('calcule la portée routière des parcelles (3 cases)', () => {
    const s = stateWithRoads(10, 1, [[0, 0]]);
    new RoadNetwork(getCatalog()).computeReach(s);
    expect(Array.from(s.grid.roadDist.slice(0, 5))).toEqual([0, 1, 2, 3, 255]);
  });
});

import { RouteService } from '../../src/systems/RouteService.js';
import { flatSession } from '../helpers/session.js';

describe('Itinéraires ponctuels', () => {
  it('trouve un itinéraire valide, le met en cache et invalide le cache quand le réseau change', () => {
    const s = flatSession();
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 20, y: 15 }, to: { x: 20, y: 5 } });
    s.run(1);
    const g = s.state.grid;
    const routes = s.sim.routes;
    const r = routes.route(s.state, g.idx(5, 15), g.idx(20, 5));
    expect(r.ok).toBe(true);
    expect(r.cached).toBe(false);
    expect(r.tiles[0]).toBe(g.idx(5, 15));
    expect(r.tiles.at(-1)).toBe(g.idx(20, 5));
    // itinéraire continu : chaque case touche la suivante
    for (let k = 1; k < r.tiles.length; k++) {
      const a = r.tiles[k - 1];
      const b = r.tiles[k];
      expect(Math.abs(g.xOf(a) - g.xOf(b)) + Math.abs(g.yOf(a) - g.yOf(b))).toBe(1);
    }
    expect(r.minutes).toBeGreaterThan(0);
    expect(routes.route(s.state, g.idx(5, 15), g.idx(20, 5)).cached).toBe(true);
    // couper la route invalide le cache et rend le trajet impossible, avec une raison explicite
    s.execute({ type: 'demolish', rect: { x0: 20, y0: 10, x1: 20, y1: 10 } });
    s.run(1);
    const cut = routes.route(s.state, g.idx(5, 15), g.idx(20, 5));
    expect(cut.ok).toBe(false);
    expect(cut.cached).toBe(false);
    expect(cut.reason).toMatch(/pas reliés par la route/);
  });

  it('signale explicitement un point hors du réseau et calcule le trajet vers l\'autoroute', () => {
    const s = flatSession();
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 12, y: 15 } });
    s.run(1);
    const g = s.state.grid;
    expect(s.sim.routes.route(s.state, g.idx(5, 5), g.idx(10, 15)).reason).toMatch(/pas sur une route/);
    const hw = s.sim.routes.routeToHighway(s.state, g.idx(12, 15));
    expect(hw.ok).toBe(true);
    expect(hw.tiles.at(-1)).toBe(s.state.entries[0]);
    expect(new RouteService({ network: s.sim.network })).toBeTruthy();
  });
});
