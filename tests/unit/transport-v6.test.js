import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { linkedRailTiles, touchesRail } from '../../src/simulation/TransitSystem.js';
import { railPathToEdge } from '../../src/rendering/TrainRenderer.js';
import { waterPathToEdge } from '../../src/rendering/AirSeaRenderer.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { TERRAIN } from '../../src/world/Terrain.js';

describe('Transports v0.6', () => {
  it('voie ferrée : pose, passage à niveau, refus sur un bâtiment, démolition et annulation', () => {
    const s = flatSession();
    const g = s.state.grid;
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    const pv = s.preview({ type: 'rail', from: { x: 10, y: 0 }, to: { x: 10, y: 29 } });
    expect(pv.ok).toBe(true);
    expect(pv.cost).toBe(30 * 25000);
    expect(s.execute({ type: 'rail', from: { x: 10, y: 0 }, to: { x: 10, y: 29 } }).ok).toBe(true);
    expect(g.rail[g.idx(10, 15)]).toBe(1);
    expect(g.road[g.idx(10, 15)]).not.toBe(0); // passage à niveau : la route reste
    s.execute({ type: 'building', defId: 'park_small', x: 14, y: 16 });
    expect(s.preview({ type: 'rail', from: { x: 14, y: 16 }, to: { x: 14, y: 20 } }).ok).toBe(false);
    // Un équipement ne se pose pas sur les rails
    expect(s.preview({ type: 'building', defId: 'park_small', x: 10, y: 20 }).ok).toBe(false);
    expect(s.execute({ type: 'demolish', rect: { x0: 10, y0: 20, x1: 10, y1: 21 }, filter: 'roads' }).ok).toBe(true);
    expect(g.rail[g.idx(10, 20)]).toBe(0);
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    expect(g.rail[g.idx(10, 20)]).toBe(1);
    // La couche est sauvegardée, et une ancienne sauvegarde sans rails se charge
    const data = serializeState(s.state);
    expect(deserializeState(structuredClone(data)).grid.rail[g.idx(10, 5)]).toBe(1);
    delete data.world.layers.rail;
    expect(deserializeState(data).grid.rail[g.idx(10, 5)]).toBe(0);
  });

  it('une gare reliée aux rails jusqu\'au bord de la carte gagne 50 % de capacité ; le train a un trajet', () => {
    const s = flatSession();
    const g = s.state.grid;
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 24, y: 15 } });
    const st = s.execute({ type: 'building', defId: 'train_station', x: 12, y: 16 });
    expect(st.ok).toBe(true);
    const b = st.building;
    Object.assign(b, { jobsFilled: 20, powered: true });
    s.sim.transit.update(s.state);
    const cap0 = s.state.transit.stats.capacity.rail;
    expect(b.railLinked).toBe(false);
    s.execute({ type: 'rail', from: { x: 12 + b.w, y: 16 }, to: { x: 29, y: 16 } });
    expect(touchesRail(g, b, linkedRailTiles(g))).toBe(true);
    s.sim.transit.update(s.state);
    expect(b.railLinked).toBe(true);
    expect(s.state.transit.stats.capacity.rail).toBeCloseTo(cap0 * 1.5, 5);
    const path = railPathToEdge(g, b);
    expect(g.xOf(path[0])).toBe(29);
    expect(path.length).toBeGreaterThan(5);
  });

  it('autoroute de sortie : atteindre le bord ouvre un second accès régional', () => {
    const s = flatSession();
    const g = s.state.grid;
    s.state.stats.peakPopulation = 20000;
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    expect(s.state.entries).toHaveLength(1);
    expect(s.execute({ type: 'road', roadId: 'road_motorway', from: { x: 20, y: 15 }, to: { x: 29, y: 15 } }).ok).toBe(true);
    expect(s.state.entries).toHaveLength(2);
    expect(s.state.entries[1]).toBe(g.idx(29, 15));
    s.sim.attach(s.state);
    s.run(6);
    expect(s.sim.network.entryNodes.length).toBe(2);
    // Démolir la sortie retire l'accès, jamais l'accès d'origine
    s.execute({ type: 'demolish', rect: { x0: 29, y0: 15, x1: 29, y1: 15 } });
    expect(s.state.entries).toHaveLength(1);
    expect(s.catalog.road('road_boulevard').capacity).toBeGreaterThan(s.catalog.road('road_avenue').capacity);
  });

  it('navire : chemin sur l\'eau du port jusqu\'au bord de la carte', () => {
    const s = flatSession();
    const g = s.state.grid;
    for (let y = 0; y < g.height; y++) for (let x = 22; x < g.width; x++) g.terrain[g.idx(x, y)] = TERRAIN.WATER;
    const port = spawn(s, 'seaport', 19, 10);
    const path = waterPathToEdge(g, port);
    expect(path.length).toBeGreaterThan(2);
    const end = path[0];
    expect([g.xOf(end) === 0, g.yOf(end) === 0, g.xOf(end) === g.width - 1, g.yOf(end) === g.height - 1].some(Boolean)).toBe(true);
  });
});
