import { describe, it, expect } from 'vitest';
import {
  gridToScreen, screenToGrid, gridToWorld, worldToGridFloat, screenToWorld, worldToScreen, pickTile, screenToTile, TILE_W, TILE_H, HEIGHT_STEP
} from '../../src/rendering/IsometricProjection.js';
import { Camera } from '../../src/rendering/Camera.js';

describe('Projection isométrique', () => {
  it('convertit grille → écran → grille pour toutes les cases (aller-retour au centre)', () => {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const p = gridToScreen(x, y, TILE_W, TILE_H);
        // centre de la case = sommet nord + demi-hauteur
        expect(screenToGrid(p.x, p.y + TILE_H / 2, TILE_W, TILE_H)).toEqual({ x, y });
      }
    }
  });

  it('respecte les bords des cases (sommets et arêtes)', () => {
    const eps = 0.01;
    const top = gridToScreen(5, 7);
    // juste sous le sommet nord : case (5, 7)
    expect(screenToGrid(top.x, top.y + eps)).toEqual({ x: 5, y: 7 });
    // juste au-dessus du sommet nord : case (4, 6)
    expect(screenToGrid(top.x, top.y - eps)).toEqual({ x: 4, y: 6 });
    // près du sommet est, à l'intérieur
    const right = gridToScreen(6, 7);
    expect(screenToGrid(right.x - 2, right.y + 0.5)).toEqual({ x: 5, y: 7 });
    // juste à droite du sommet est : case voisine (6, 7)
    expect(screenToGrid(right.x + 2, right.y + 3)).toEqual({ x: 6, y: 7 });
    // près du sommet sud, à l'intérieur / à l'extérieur
    const bottom = gridToScreen(6, 8);
    expect(screenToGrid(bottom.x, bottom.y - eps)).toEqual({ x: 5, y: 7 });
    expect(screenToGrid(bottom.x, bottom.y + eps)).toEqual({ x: 6, y: 8 });
  });

  it('gère les coordonnées négatives (hors carte) sans erreur d\'arrondi', () => {
    expect(screenToGrid(-TILE_W, 0)).toEqual({ x: -1, y: 1 });
    const p = gridToScreen(-3, 2);
    expect(screenToGrid(p.x, p.y + TILE_H / 2)).toEqual({ x: -3, y: 2 });
  });

  it('tient compte de l\'altitude', () => {
    const w = gridToWorld(10, 4, 2);
    const f = worldToGridFloat(w.x, w.y + TILE_H / 2, 2);
    expect(Math.floor(f.x)).toBe(10);
    expect(Math.floor(f.y)).toBe(4);
    expect(gridToWorld(10, 4, 2).y).toBe(gridToWorld(10, 4, 0).y - 2 * HEIGHT_STEP);
  });

  it('intègre caméra et zoom dans les deux sens', () => {
    const cam = { x: 120, y: -40, zoom: 1.7 };
    const view = { width: 1280, height: 720 };
    for (const [wx, wy] of [[0, 0], [300.5, 77.25], [-512, 900]]) {
      const s = worldToScreen(wx, wy, cam, view);
      const back = screenToWorld(s.x, s.y, cam, view);
      expect(back.x).toBeCloseTo(wx, 9);
      expect(back.y).toBeCloseTo(wy, 9);
    }
    // le centre de l'écran correspond à la position de la caméra
    expect(screenToWorld(640, 360, cam, view)).toEqual({ x: 120, y: -40 });
  });

  it('pointe la bonne case sur un relief (une colline masque la case derrière)', () => {
    const grid = { width: 8, height: 8, altitude: new Uint8Array(64) };
    grid.altitude[3 * 8 + 3] = 2; // colline en (3, 3)
    const c = gridToWorld(3.5, 3.5, 2);
    expect(pickTile(grid, c.x, c.y)).toEqual({ x: 3, y: 3 });
    const flat = gridToWorld(5.5, 2.5, 0);
    expect(pickTile(grid, flat.x, flat.y)).toEqual({ x: 5, y: 2 });
    expect(pickTile(grid, -5000, 0)).toBeNull();
  });

  it('pointe une case à l\'écran avec une caméra zoomée', () => {
    const grid = { width: 32, height: 32, altitude: new Uint8Array(1024) };
    const cam = new Camera();
    cam.setWorldSize(32, 32);
    cam.centerOnTile(10, 12);
    cam.zoomAt(2, 400, 300, { width: 800, height: 600 });
    // le zoom au centre de la vue conserve la case centrale
    expect(screenToTile(grid, 400, 300, cam, { width: 800, height: 600 })).toEqual({ x: 10, y: 12 });
  });
});

describe('Sélection après déplacement et zoom de la caméra', () => {
  it('chaque case reste pointée correctement après plusieurs déplacements et zooms', () => {
    const grid = { width: 40, height: 40, altitude: new Uint8Array(1600) };
    const view = { width: 1024, height: 700 };
    const cam = new Camera();
    cam.setWorldSize(40, 40);
    cam.centerOnTile(12, 20);
    cam.pan(137, -58);
    cam.zoomAt(1.8, 300, 220, view);
    cam.pan(-41, 77);
    cam.zoomAt(0.62, 800, 600, view);
    let checked = 0;
    for (let y = 0; y < 40; y += 3) {
      for (let x = 0; x < 40; x += 3) {
        const w = gridToWorld(x + 0.5, y + 0.5, 0);
        const sp = worldToScreen(w.x, w.y, cam, view);
        if (sp.x < 0 || sp.y < 0 || sp.x > view.width || sp.y > view.height) continue;
        expect(screenToTile(grid, sp.x, sp.y, cam, view)).toEqual({ x, y });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});
