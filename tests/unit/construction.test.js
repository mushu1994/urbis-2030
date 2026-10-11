import { describe, it, expect } from 'vitest';
import { newSession } from '../helpers/session.js';
import { TERRAIN } from '../../src/world/Terrain.js';

/** Trouve une case d'eau et une rangée de terrain plat libre. */
function landRow(s, len = 6) {
  const g = s.state.grid;
  for (let y = 5; y < g.height - 5; y++) {
    for (let x = 5; x < g.width - len - 5; x++) {
      let ok = true;
      for (let k = 0; k < len + 3; k++) {
        for (let r = 0; r < 3; r++) {
          const i = g.idx(x + k, y + r);
          if (g.terrain[i] !== TERRAIN.GRASS || g.altitude[i] !== g.altitude[g.idx(x, y)] || g.road[i]) ok = false;
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('pas de terrain plat');
}

describe('Construction et zonage', () => {
  it('prévisualise le coût d\'une route sans modifier le monde', () => {
    const s = newSession();
    const { x, y } = landRow(s);
    const before = s.state.economy.treasury;
    const pv = s.preview({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 4, y } });
    expect(pv.ok).toBe(true);
    expect(pv.cost).toBe(5 * 4000);
    expect(s.state.grid.road[s.state.grid.idx(x, y)]).toBe(0);
    expect(s.state.economy.treasury).toBe(before);
  });

  it('construit une route, la paie et l\'enregistre comme investissement', () => {
    const s = newSession();
    const { x, y } = landRow(s);
    const before = s.state.economy.treasury;
    const r = s.execute({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 4, y } });
    expect(r.ok).toBe(true);
    expect(s.state.economy.treasury).toBe(before - 20000);
    expect(s.state.economy.ledger.at(-1).kind).toBe('capex');
    // re-tracer la même route n'a aucun effet
    expect(s.preview({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 4, y } }).reasons).toContain('nothing');
  });

  it('refuse une route posée seule sur l\'eau (un pont doit relier deux rives)', () => {
    const s = newSession();
    const g = s.state.grid;
    const i = g.terrain.indexOf(TERRAIN.WATER);
    const pv = s.preview({ type: 'road', roadId: 'road_street', from: { x: g.xOf(i), y: g.yOf(i) }, to: { x: g.xOf(i), y: g.yOf(i) } });
    expect(pv.ok).toBe(false);
    expect(pv.messages.join()).toMatch(/deux rives/);
  });

  it('refuse un bâtiment sans accès routier, puis l\'accepte quand une route le dessert', () => {
    const s = newSession();
    const { x, y } = landRow(s, 8);
    let pv = s.preview({ type: 'building', defId: 'clinic', x: x + 2, y: y + 1 });
    expect(pv.ok).toBe(false);
    expect(pv.reasons).toContain('noRoad');
    s.execute({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 6, y } });
    pv = s.preview({ type: 'building', defId: 'clinic', x: x + 2, y: y + 1 });
    expect(pv.ok).toBe(true);
    const r = s.execute({ type: 'building', defId: 'clinic', x: x + 2, y: y + 1 });
    expect(r.ok).toBe(true);
    // emprise occupée
    expect(s.preview({ type: 'building', defId: 'clinic', x: x + 2, y: y + 1 }).reasons).toContain('occupied');
  });

  it('ne construit rien et ne débite rien si le budget est insuffisant', () => {
    const s = newSession();
    const { x, y } = landRow(s);
    s.execute({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 6, y } });
    s.state.economy.treasury = 100;
    const snapshot = s.state.grid.building.slice();
    const r = s.execute({ type: 'building', defId: 'clinic', x: x + 2, y: y + 1 });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('budget');
    expect(s.state.economy.treasury).toBe(100);
    expect(s.state.grid.building).toEqual(snapshot);
  });

  it('respecte les conditions de déblocage', () => {
    const s = newSession();
    const pv = s.preview({ type: 'building', defId: 'hospital', x: 10, y: 10 });
    expect(pv.reasons).toContain('locked');
    expect(pv.messages.join()).toMatch(/2 500 habitants|2 500 habitants|2 500/);
  });

  it('annule une construction : cases restaurées et dépense contre-passée', () => {
    const s = newSession();
    const { x, y } = landRow(s, 8);
    const t0 = s.state.economy.treasury;
    s.execute({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 6, y } });
    s.execute({ type: 'building', defId: 'clinic', x: x + 2, y: y + 1 });
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    expect(s.state.grid.building[s.state.grid.idx(x + 2, y + 1)]).toBe(0);
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    expect(s.state.grid.road[s.state.grid.idx(x, y)]).toBe(0);
    expect(s.state.economy.treasury).toBe(t0);
    expect(s.state.economy.assets).toHaveLength(0);
  });

  it('démolit en libérant toute l\'emprise et en passant la valeur nette en charge', () => {
    const s = newSession();
    const { x, y } = landRow(s, 8);
    s.execute({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 7, y } });
    const r = s.execute({ type: 'building', defId: 'power_solar', x: x + 2, y: y + 1 });
    expect(r.ok).toBe(true);
    const id = r.building.id;
    const d = s.execute({ type: 'demolish', rect: { x0: x + 3, y0: y + 2, x1: x + 3, y1: y + 2 } });
    expect(d.ok).toBe(true);
    expect(s.state.buildings.has(id)).toBe(false);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) expect(s.state.grid.building[s.state.grid.idx(x + 2 + dx, y + 1 + dy)]).toBe(0);
    expect(s.state.economy.current.writeOffs).toBe(3_000_000);
  });

  it('zone uniquement les cases éligibles et facture à la case', () => {
    const s = newSession();
    const { x, y } = landRow(s, 8);
    s.execute({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 7, y } });
    const pv = s.preview({ type: 'zone', zoneId: 'R_LOW', rect: { x0: x, y0: y, x1: x + 3, y1: y + 1 } });
    expect(pv.eligible.length).toBe(4); // la ligne de route est exclue
    expect(pv.cost).toBe(4 * 1000);
    expect(s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: x, y0: y, x1: x + 3, y1: y + 1 } }).ok).toBe(true);
    expect(s.state.grid.zone[s.state.grid.idx(x, y + 1)]).toBe(1);
  });
});
