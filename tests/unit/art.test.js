import { describe, it, expect } from 'vitest';
import { Graphics } from 'pixi.js';
import { getCatalog } from '../helpers/session.js';
import { drawBuilding } from '../../src/rendering/art/BuildingArt.js';
import { drawBridgeTile, drawRoadTile } from '../../src/rendering/art/GroundArt.js';

describe('Dessin procédural', () => {
  it('dessine chaque bâtiment du catalogue (actif, abandonné, à l\'arrêt) sans erreur', () => {
    const cat = getCatalog();
    let n = 0;
    for (const def of cat.buildings.values()) {
      for (const state of [{}, { abandoned: true }, { disabledUntil: 99, landfillUsed: 1e9, residents: 5 }]) {
        const g = new Graphics();
        expect(() => drawBuilding(g, def, { id: 7, x: 3, y: 4, w: def.footprint.w, h: def.footprint.h, ...state }, 1), def.id).not.toThrow();
        expect(g.bounds.width, def.id).toBeGreaterThan(0);
        g.destroy();
        n++;
      }
    }
    expect(n).toBe(cat.buildings.size * 3);
  });

  it('dessine un pont et une route dans toutes les orientations', () => {
    const road = getCatalog().road('road_street');
    for (const conn of [0, 1, 2, 4, 5, 8, 10, 15]) {
      const g = new Graphics();
      expect(() => drawBridgeTile(g, 2, 2, 1, conn, road.visual)).not.toThrow();
      expect(() => drawRoadTile(g, 2, 2, 1, conn, road.visual)).not.toThrow();
      g.destroy();
    }
  });
});
