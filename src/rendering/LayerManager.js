import { Container, Graphics } from 'pixi.js';
import { screenCorners, heightStep, depthOf } from './IsometricProjection.js';

export const CHUNK = 16;

/**
 * Pile des calques de la scène, du sol vers le ciel :
 * terrain → sol (routes, zones) → couche de données → véhicules → objets (bâtiments, arbres, triés en profondeur)
 * → alertes → sélection et prévisualisation.
 */
export class LayerManager {
  constructor() {
    this.world = new Container();
    this.terrain = new Container();
    this.ground = new Container();
    this.overlay = new Graphics();
    this.vehicles = new Graphics();
    /** Bus et tramways des lignes tracées (v0.8). */
    this.transitVehicles = new Graphics();
    this.objects = new Container();
    this.objects.sortableChildren = true;
    this.alerts = new Graphics();
    /** Tracés des lignes de transport (v0.8). */
    this.routes = new Graphics();
    this.selection = new Graphics();
    this.ghost = new Graphics();
    this.ghost.alpha = 0.62;
    this.world.addChild(this.terrain, this.ground, this.overlay, this.vehicles, this.transitVehicles, this.objects, this.alerts, this.routes, this.ghost, this.selection);
  }

  clear() {
    for (const c of [this.terrain, this.ground, this.objects]) {
      for (const child of c.removeChildren()) child.destroy();
    }
    for (const g of [this.overlay, this.vehicles, this.transitVehicles, this.alerts, this.routes, this.selection, this.ghost]) g.clear();
  }
}

/**
 * Calque découpé en tronçons de CHUNK×CHUNK cases : seuls les tronçons modifiés sont redessinés,
 * et les tronçons hors écran sont masqués.
 */
export class ChunkedLayer {
  /**
   * @param {Container} parent
   * @param {number} width largeur de la grille
   * @param {number} height
   * @param {(g: Graphics, x0:number, y0:number, x1:number, y1:number) => void} drawFn
   */
  constructor(parent, width, height, drawFn) {
    this.parent = parent;
    this.cw = Math.ceil(width / CHUNK);
    this.ch = Math.ceil(height / CHUNK);
    this.width = width;
    this.height = height;
    this.drawFn = drawFn;
    this.chunks = [];
    this.dirty = new Set();
    // Ordre de dessin : diagonales croissantes (ordre du peintre)
    const order = [];
    for (let cy = 0; cy < this.ch; cy++) for (let cx = 0; cx < this.cw; cx++) order.push([cx, cy]);
    // Profondeur d'un tronçon dans l'orientation courante (centre du tronçon)
    const cd = ([cx, cy]) => depthOf(Math.min(width - 1, cx * CHUNK + CHUNK / 2), Math.min(height - 1, cy * CHUNK + CHUNK / 2));
    order.sort((a, b) => cd(a) - cd(b) || a[0] - b[0] || a[1] - b[1]);
    for (const [cx, cy] of order) {
      const g = new Graphics();
      g.label = `chunk-${cx}-${cy}`;
      const x0 = cx * CHUNK;
      const y0 = cy * CHUNK;
      const x1 = Math.min(width, x0 + CHUNK);
      const y1 = Math.min(height, y0 + CHUNK);
      const c = screenCorners(x0, y0, x1 - x0, y1 - y0, 0);
      const hs = heightStep();
      g.__bounds = { x0: c.L.x, x1: c.R.x, y0: c.T.y - 4 * hs - 20, y1: c.B.y + 4 * hs + 8 };
      g.__range = { x0, y0, x1, y1 };
      this.chunks[cy * this.cw + cx] = g;
      parent.addChild(g);
      this.dirty.add(cy * this.cw + cx);
    }
  }

  markTile(x, y) {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    if (cx >= 0 && cy >= 0 && cx < this.cw && cy < this.ch) this.dirty.add(cy * this.cw + cx);
    // Les falaises débordent sur le tronçon voisin (de n'importe quel côté selon l'orientation) : on le redessine
    if (x % CHUNK === 0 && cx > 0) this.dirty.add(cy * this.cw + cx - 1);
    if (y % CHUNK === 0 && cy > 0) this.dirty.add((cy - 1) * this.cw + cx);
    if (x % CHUNK === CHUNK - 1 && cx + 1 < this.cw) this.dirty.add(cy * this.cw + cx + 1);
    if (y % CHUNK === CHUNK - 1 && cy + 1 < this.ch) this.dirty.add((cy + 1) * this.cw + cx);
  }

  markAll() {
    for (let k = 0; k < this.chunks.length; k++) this.dirty.add(k);
  }

  /** Redessine au plus `max` tronçons modifiés. */
  flush(max = Infinity) {
    let n = 0;
    for (const k of [...this.dirty]) {
      if (n >= max) break;
      const g = this.chunks[k];
      g.clear();
      const r = g.__range;
      this.drawFn(g, r.x0, r.y0, r.x1, r.y1);
      this.dirty.delete(k);
      n++;
    }
    return n;
  }

  cull(rect) {
    for (const g of this.chunks) {
      const b = g.__bounds;
      g.visible = !(b.x1 < rect.x0 || b.x0 > rect.x1 || b.y1 < rect.y0 || b.y0 > rect.y1);
    }
  }
}
